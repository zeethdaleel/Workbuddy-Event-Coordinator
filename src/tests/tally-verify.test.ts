import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { SqlitePersistence } from "../adapters/sqlite/sqlite-persistence.js";
import { TallyClient } from "../adapters/tally/tally-client.js";
import { createLocalMcpApplication } from "../adapters/mcp/server.js";
import { RegistrationService } from "../core/registration-service.js";

const TEST_KEY = "tly-test-secret-key-xyz";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(handler: (request: CapturedRequest) => Response | Promise<Response>): { fetchImpl: typeof fetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (url: unknown, init?: { method?: string; headers?: unknown; body?: unknown }) => {
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const record: CapturedRequest = {
      url: String(url),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
      body: init?.body === undefined ? undefined : String(init.body)
    };
    requests.push(record);
    return handler(record);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function leaked(value: unknown): boolean {
  return JSON.stringify(value).includes(TEST_KEY);
}

async function withRegistration(run: (registration: RegistrationService) => Promise<void>, fetchImpl?: typeof fetch): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "campus-event-tally-verify-"));
  const store = new SqlitePersistence(join(directory, "events.sqlite"));
  try {
    await run(new RegistrationService(store, fetchImpl === undefined ? undefined : new TallyClient({ apiKey: TEST_KEY, fetchImpl })));
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("verify reports connected on an authenticated listing and leaks nothing", async () => {
  const forms = [{ id: "AbC123", name: "Private form name", workspaceId: "kb3o5R", status: "PUBLISHED" }];
  const { fetchImpl, requests } = mockFetch(() => jsonResponse(200, forms));
  await withRegistration(async (registration) => {
    const outcome = await registration.verifyTallyConnection();
    assert.deepEqual(outcome, { ok: true, value: { connected: true } });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "GET");
    assert.ok(requests[0]?.url.endsWith("/forms"), "diagnostic must use the read-only list endpoint");
    assert.equal(requests[0]?.body, undefined, "diagnostic must send no body");
    assert.equal(requests[0]?.headers.authorization, `Bearer ${TEST_KEY}`);
    assert.equal(leaked(outcome), false, "result must not contain the key");
    assert.equal(JSON.stringify(outcome).includes("Private form name"), false, "result must not contain form data");
    assert.equal(JSON.stringify(outcome).includes("AbC123"), false, "result must not contain form identifiers");
  }, fetchImpl);
});

test("verify maps invalid credentials to an authentication failure", async () => {
  const { fetchImpl } = mockFetch(() => jsonResponse(401, { message: "unauthorized" }));
  await withRegistration(async (registration) => {
    const outcome = await registration.verifyTallyConnection();
    assert.deepEqual(outcome, { ok: false, reason: "tally_auth" });
    assert.equal(leaked(outcome), false);
  }, fetchImpl);
});

test("verify maps network failures and timeouts without leaking", async () => {
  const network = mockFetch(async () => { throw new TypeError("fetch failed"); });
  await withRegistration(async (registration) => {
    assert.deepEqual(await registration.verifyTallyConnection(), { ok: false, reason: "tally_unavailable" });
  }, network.fetchImpl);
  const hanging = ((url: unknown, init?: { signal?: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
    // AbortSignal.timeout uses an unreferenced timer. A real fetch keeps a socket
        // alive; this mock must also hold the event loop until cancellation.
        const keepAlive = setInterval(() => {}, 1000);
        const abort = () => { clearInterval(keepAlive); reject(new DOMException("signal timed out", "TimeoutError")); };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
  })) as typeof fetch;
  const directory = await mkdtemp(join(tmpdir(), "campus-event-tally-verify-timeout-"));
  const store = new SqlitePersistence(join(directory, "events.sqlite"));
  try {
    const outcome = await new RegistrationService(store, new TallyClient({ apiKey: TEST_KEY, fetchImpl: hanging, timeoutMs: 50 })).verifyTallyConnection();
    assert.deepEqual(outcome, { ok: false, reason: "tally_timeout" });
    assert.equal(leaked(outcome), false);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("verify without configuration reports tally_not_configured and sends nothing", async () => {
  await withRegistration(async (registration) => {
    assert.deepEqual(await registration.verifyTallyConnection(), { ok: false, reason: "tally_not_configured" });
  });
});

test("verify maps rate limits without exposing details", async () => {
  const { fetchImpl } = mockFetch(() => jsonResponse(429, { message: "slow down" }));
  await withRegistration(async (registration) => {
    const outcome = await registration.verifyTallyConnection();
    assert.deepEqual(outcome, { ok: false, reason: "tally_rate_limited" });
    assert.equal(leaked(outcome), false);
  }, fetchImpl);
});

test("MCP tally_verify_connection tool answers with and without a provider", async () => {
  async function callTool(tally: TallyClient | undefined): Promise<unknown> {
    const directory = await mkdtemp(join(tmpdir(), "campus-event-tally-verify-mcp-"));
    const app = createLocalMcpApplication(join(directory, "events.sqlite"), tally === undefined ? {} : { tally });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mcp-test-client", version: "1.0.0" });
    try {
      await app.server.connect(serverTransport);
      await client.connect(clientTransport);
      return (await client.callTool({ name: "tally_verify_connection", arguments: {} })).structuredContent;
    } finally {
      await client.close();
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
  const { fetchImpl } = mockFetch(() => jsonResponse(200, []));
  const connected = await callTool(new TallyClient({ apiKey: TEST_KEY, fetchImpl })) as { ok: boolean; value?: { connected: boolean } };
  assert.equal(connected.ok, true);
  assert.deepEqual(connected.value, { connected: true });
  assert.equal(leaked(connected), false);
  const missing = await callTool(undefined) as { ok: boolean; reason?: string };
  assert.deepEqual(missing, { ok: false, reason: "tally_not_configured" });
});
