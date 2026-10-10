import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { SqlitePersistence } from "../adapters/sqlite/sqlite-persistence.js";
import { TallyClient } from "../adapters/tally/tally-client.js";
import { createLocalMcpApplication } from "../adapters/mcp/server.js";
import { EventApplicationService } from "../core/event-application-service.js";
import { buildRegistrationSpec, registrationSpecHash, tallyBlocksFromSpec, tallyFormUrl } from "../core/registration.js";
import { RegistrationService } from "../core/registration-service.js";
import type { TallyFormProvider } from "../core/ports/tally.js";

const TEST_KEY = "tly-test-secret-key-xyz";
const BRIEF = "Organise a university networking event for 50 attendees within RM1,500.";
const BARE_BRIEF = "Organise a university networking event.";

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
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
    };
    requests.push(record);
    return handler(record);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function jsonResponse(status: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const CREATED = { id: "AbC123", name: "University networking event — Registration", workspaceId: "kb3o5R", organizationId: "atL65s", status: "PUBLISHED", hasDraftBlocks: false, isClosed: false, numberOfSubmissions: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const FETCHED = { ...CREATED, settings: {}, blocks: [] };

function tallyHappyPath(): { fetchImpl: typeof fetch; requests: CapturedRequest[] } {
  return mockFetch((request) => {
    if (request.method === "POST" && request.url.endsWith("/forms")) return jsonResponse(201, CREATED);
    if (request.method === "GET" && request.url.endsWith("/forms/AbC123")) return jsonResponse(200, FETCHED);
    return jsonResponse(404, { message: "not found" });
  });
}

async function withServices(run: (service: EventApplicationService, registration: RegistrationService, path: string, store: SqlitePersistence) => Promise<void>, tally?: TallyFormProvider): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "campus-event-tally-"));
  const path = join(directory, "events.sqlite");
  const store = new SqlitePersistence(path);
  try {
    await run(new EventApplicationService(store), new RegistrationService(store, tally), path, store);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function leaked(value: unknown): boolean {
  return JSON.stringify(value).includes(TEST_KEY);
}

test("draft produces required contact fields and lists missing requirements", async () => {
  await withServices(async (service, registration) => {
    assert.equal((await service.createEvent("event-1", BARE_BRIEF)).ok, true);
    const draft = await registration.draftRegistration("event-1");
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    assert.deepEqual(draft.value.fields.map((field) => [field.key, field.required]), [["full_name", true], ["email", true], ["phone", false]]);
    assert.ok(draft.value.missingRequirements.length > 0, "capacity and deadline must be reported missing");
    const complete = await registration.draftRegistration("event-1", { capacity: 50, deadline: "2026-11-01" });
    assert.equal(complete.ok, true);
    if (!complete.ok) return;
    assert.deepEqual(complete.value.missingRequirements, []);
    assert.equal(complete.value.capacity, 50);
  });
});

test("sensitive fields stay optional and block builder follows the verified shapes", async () => {
  await withServices(async (service, registration) => {
    assert.equal((await service.createEvent("event-1", BRIEF)).ok, true);
    const draft = await registration.draftRegistration("event-1", { includeStudentId: true, includeDietary: true, includeAccessibility: true, includeConsent: true });
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    for (const field of draft.value.fields) {
      if (["student_id", "dietary_requirements", "accessibility_needs", "consent"].includes(field.key)) {
        assert.equal(field.required, false, `${field.key} must not be mandatory`);
      }
    }
    let counter = 0;
    const blocks = tallyBlocksFromSpec(draft.value, () => `uuid-${(counter += 1)}`);
    assert.equal(blocks[0]?.type, "FORM_TITLE");
    const emailTitle = blocks.findIndex((block) => block.type === "TITLE" && (block.payload.html as string) === "Email");
    assert.equal(blocks[emailTitle + 1]?.type, "INPUT_EMAIL");
    const options = blocks.filter((block) => block.type === "MULTIPLE_CHOICE_OPTION");
    assert.equal(options.length, 2);
    assert.ok(options.every((option) => option.groupUuid === options[0]?.groupUuid), "options must share one groupUuid");
    assert.deepEqual(options.map((option) => [option.payload.index, option.payload.isFirst, option.payload.isLast]), [[0, true, false], [1, false, true]]);
    assert.equal(tallyFormUrl("AbC123"), "https://tally.so/r/AbC123");
    const event = await service.getEvent("event-1");
    assert.equal(event.ok, true);
    if (!event.ok) return;
    const rebuilt = buildRegistrationSpec(event.value, { includeStudentId: true, includeDietary: true, includeAccessibility: true, includeConsent: true });
    assert.equal(registrationSpecHash(draft.value), registrationSpecHash(rebuilt), "identical inputs must hash identically");
  });
});

test("draft reports not_found for unknown events and needs no API key", async () => {
  await withServices(async (_service, registration) => {
    assert.deepEqual(await registration.draftRegistration("missing"), { ok: false, reason: "not_found" });
  });
});

test("creation requires explicit confirmation and never calls the API without it", async () => {
  const { fetchImpl, requests } = tallyHappyPath();
  const tally = new TallyClient({ apiKey: TEST_KEY, fetchImpl });
  await withServices(async (service, registration) => {
    assert.equal((await service.createEvent("event-1", BRIEF)).ok, true);
    assert.deepEqual(
      await registration.createRegistrationForm("event-1", { registrationId: "reg-1", confirmed: false }),
      { ok: false, reason: "confirmation_required" }
    );
    assert.equal(requests.length, 0);
  }, tally);
});

test("creation without a configured provider reports tally_not_configured", async () => {
  await withServices(async (service, registration) => {
    assert.equal((await service.createEvent("event-1", BRIEF)).ok, true);
    assert.deepEqual(
      await registration.createRegistrationForm("event-1", { registrationId: "reg-1", confirmed: true }),
      { ok: false, reason: "tally_not_configured" }
    );
  });
});

test("confirmed creation verifies, persists, survives reopen, and rejects duplicates", async () => {
  const { fetchImpl, requests } = tallyHappyPath();
  const tally = new TallyClient({ apiKey: TEST_KEY, fetchImpl });
  const directory = await mkdtemp(join(tmpdir(), "campus-event-tally-reopen-"));
  const path = join(directory, "events.sqlite");
  try {
    const store = new SqlitePersistence(path);
    try {
      const service = new EventApplicationService(store);
      const registration = new RegistrationService(store, tally);
      assert.equal((await service.createEvent("event-1", BRIEF)).ok, true);
      const created = await registration.createRegistrationForm("event-1", { registrationId: "reg-1", confirmed: true, capacity: 50, deadline: "2026-11-01" });
      assert.equal(created.ok, true);
      if (!created.ok) return;
      assert.equal(created.value.tallyFormId, "AbC123");
      assert.equal(created.value.formUrl, "https://tally.so/r/AbC123");
      assert.equal(created.value.status, "live");
      // Authorization travelled only as a header; nothing returned carries the key.
      assert.equal(requests[0]?.headers.authorization, `Bearer ${TEST_KEY}`);
      assert.equal(leaked(created), false);
      const stored = await registration.getRegistrations("event-1");
      assert.equal(stored.ok, true);
      if (stored.ok) assert.equal(stored.value.forms[0]?.formUrl, "https://tally.so/r/AbC123");
      const callsBeforeRetry = requests.length;
      assert.deepEqual(
        await registration.createRegistrationForm("event-1", { registrationId: "reg-2", confirmed: true }),
        { ok: false, reason: "duplicate_id" }
      );
      assert.equal(requests.length, callsBeforeRetry, "retries must not create duplicate forms");
    } finally {
      store.close();
    }
    const reopened = new SqlitePersistence(path);
    try {
      const forms = await new RegistrationService(reopened).getRegistrations("event-1");
      assert.equal(forms.ok, true);
      if (forms.ok) assert.equal(forms.value.forms[0]?.tallyFormId, "AbC123");
    } finally {
      reopened.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("authentication failures, rate limits, and timeouts map to explicit reasons", async () => {
  await withServices(async (service, registration) => {
    assert.equal((await service.createEvent("event-1", BRIEF)).ok, true);
  });
  const cases: Array<{ name: string; fetchImpl: typeof fetch; reason: string }> = [
    { name: "401", fetchImpl: mockFetch(() => jsonResponse(401, { message: "unauthorized" })).fetchImpl, reason: "tally_auth" },
    { name: "403", fetchImpl: mockFetch(() => jsonResponse(403, { message: "forbidden" })).fetchImpl, reason: "tally_auth" },
    { name: "429", fetchImpl: mockFetch(() => jsonResponse(429, { message: "slow down" }, { "retry-after": "30" })).fetchImpl, reason: "tally_rate_limited" },
    { name: "500", fetchImpl: mockFetch(() => jsonResponse(500, { message: "boom" })).fetchImpl, reason: "tally_unavailable" },
    {
      name: "timeout",
      fetchImpl: ((url: unknown, init?: { signal?: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
        // AbortSignal.timeout uses an unreferenced timer. A real fetch keeps a socket
        // alive; this mock must also hold the event loop until cancellation.
        const keepAlive = setInterval(() => {}, 1000);
        const abort = () => { clearInterval(keepAlive); reject(new DOMException("signal timed out", "TimeoutError")); };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      })) as typeof fetch,
      reason: "tally_timeout"
    },
    {
      name: "network",
      fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch,
      reason: "tally_unavailable"
    }
  ];
  for (const failure of cases) {
    await withServices(async (service, registration) => {
      assert.equal((await service.createEvent("event-1", BRIEF)).ok, true);
      const outcome = await registration.createRegistrationForm("event-1", { registrationId: "reg-1", confirmed: true });
      assert.deepEqual(outcome, { ok: false, reason: failure.reason }, `case ${failure.name}`);
      assert.equal(leaked(outcome), false, `case ${failure.name} must not leak the key`);
      assert.deepEqual((await registration.getRegistrations("event-1")).ok, true);
    }, new TallyClient({ apiKey: TEST_KEY, fetchImpl: failure.fetchImpl, timeoutMs: 50 }));
  }
});

test("malformed responses and failed verification never persist a live form", async () => {
  const malformed: Array<{ name: string; fetchImpl: typeof fetch }> = [
    { name: "empty object", fetchImpl: mockFetch(() => jsonResponse(201, {})).fetchImpl },
    { name: "invalid json", fetchImpl: mockFetch(() => new Response("not json", { status: 201, headers: { "Content-Type": "application/json" } })).fetchImpl },
    { name: "wrong verify id", fetchImpl: mockFetch((request) => request.method === "POST" ? jsonResponse(201, CREATED) : jsonResponse(200, { ...FETCHED, id: "Other1" })).fetchImpl },
    { name: "draft on verify", fetchImpl: mockFetch((request) => request.method === "POST" ? jsonResponse(201, CREATED) : jsonResponse(200, { ...FETCHED, status: "DRAFT" })).fetchImpl },
    { name: "closed on verify", fetchImpl: mockFetch((request) => request.method === "POST" ? jsonResponse(201, CREATED) : jsonResponse(200, { ...FETCHED, isClosed: true })).fetchImpl }
  ];
  for (const failure of malformed) {
    await withServices(async (service, registration) => {
      assert.equal((await service.createEvent("event-1", BRIEF)).ok, true);
      const outcome = await registration.createRegistrationForm("event-1", { registrationId: "reg-1", confirmed: true });
      assert.equal(outcome.ok, false, `case ${failure.name}`);
      assert.equal(leaked(outcome), false, `case ${failure.name} must not leak the key`);
      const stored = await registration.getRegistrations("event-1");
      assert.equal(stored.ok, true);
      if (stored.ok) assert.deepEqual(stored.value.forms, [], `case ${failure.name} must persist nothing`);
    }, new TallyClient({ apiKey: TEST_KEY, fetchImpl: failure.fetchImpl }));
  }
});

test("registration metadata keeps revision checks and event relationships", async () => {
  const { fetchImpl } = tallyHappyPath();
  await withServices(async (service, registration, _path, store) => {
    assert.equal((await service.createEvent("event-1", BRIEF)).ok, true);
    const created = await registration.createRegistrationForm("event-1", { registrationId: "reg-1", confirmed: true });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.deepEqual(await store.registrationForms.update({ ...created.value, status: "unverified" }, 99), { ok: false, reason: "revision_conflict" });
    const updated = await store.registrationForms.update({ ...created.value, status: "unverified" }, 0);
    assert.equal(updated.ok, true);
  }, new TallyClient({ apiKey: TEST_KEY, fetchImpl }));
});

test("MCP registration tools gate confirmation and return verified metadata", async () => {
  const { fetchImpl } = tallyHappyPath();
  const directory = await mkdtemp(join(tmpdir(), "campus-event-tally-mcp-"));
  const app = createLocalMcpApplication(join(directory, "events.sqlite"), { tally: new TallyClient({ apiKey: TEST_KEY, fetchImpl }) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-test-client", version: "1.0.0" });
  try {
    await app.server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.equal((await client.callTool({ name: "event_create", arguments: { eventId: "event-1", eventBrief: BRIEF } })).isError, undefined);
    const draft = await client.callTool({ name: "registration_draft", arguments: { eventId: "event-1" } });
    assert.equal(draft.isError, undefined);
    assert.ok(((draft.structuredContent as { value: { fields: unknown[] } }).value.fields.length) >= 3);
    const unconfirmed = await client.callTool({ name: "registration_create", arguments: { eventId: "event-1", registrationId: "reg-1", confirmed: false } });
    assert.equal(unconfirmed.isError, true);
    const gated = unconfirmed.structuredContent as { ok: boolean; reason: string; draft?: { title: string } };
    assert.equal(gated.reason, "confirmation_required");
    assert.ok(gated.draft?.title, "confirmation gate must return the reviewable draft");
    const created = await client.callTool({ name: "registration_create", arguments: { eventId: "event-1", registrationId: "reg-1", confirmed: true } });
    assert.equal(created.isError, undefined);
    assert.equal((created.structuredContent as { value: { formUrl: string } }).value.formUrl, "https://tally.so/r/AbC123");
    assert.equal(leaked(created.structuredContent), false);
    const stored = await client.callTool({ name: "registration_get", arguments: { eventId: "event-1" } });
    assert.equal(stored.isError, undefined);
    assert.equal((stored.structuredContent as { value: { forms: Array<{ tallyFormId: string }> } }).value.forms[0]?.tallyFormId, "AbC123");
  } finally {
    await client.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("MCP registration tools work without an API key except creation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "campus-event-tally-nokey-"));
  const app = createLocalMcpApplication(join(directory, "events.sqlite"));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-test-client", version: "1.0.0" });
  try {
    await app.server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.equal((await client.callTool({ name: "event_create", arguments: { eventId: "event-1", eventBrief: BRIEF } })).isError, undefined);
    assert.equal((await client.callTool({ name: "registration_draft", arguments: { eventId: "event-1" } })).isError, undefined);
    const created = await client.callTool({ name: "registration_create", arguments: { eventId: "event-1", registrationId: "reg-1", confirmed: true } });
    assert.equal(created.isError, true);
    assert.match((created.structuredContent as { reason: string }).reason, /tally_not_configured/);
  } finally {
    await client.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent registration attempts reserve exactly one external creation", async () => {
  const { fetchImpl, requests } = tallyHappyPath();
  await withServices(async (service, registration) => {
    await service.createEvent("concurrent", BRIEF);
    const results = await Promise.all([
      registration.createRegistrationForm("concurrent", {registrationId:"first",confirmed:true}),
      registration.createRegistrationForm("concurrent", {registrationId:"second",confirmed:true})
    ]);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(requests.filter(request => request.method === "POST").length, 1);
  }, new TallyClient({ apiKey: TEST_KEY, fetchImpl }));
});

test("uncertain form creation is not repeated after a database reopen", async () => {
  let sends=0;
  const tally=new TallyClient({apiKey:TEST_KEY,fetchImpl:async()=>{sends++;throw new Error("lost response");}});
  await withServices(async(service,registration,path)=>{
    await service.createEvent("uncertain",BRIEF);
    assert.equal((await registration.createRegistrationForm("uncertain",{registrationId:"one",confirmed:true})).ok,false);
    const reopened=new SqlitePersistence(path);
    try {assert.deepEqual(await new RegistrationService(reopened,tally).createRegistrationForm("uncertain",{registrationId:"two",confirmed:true}),{ok:false,reason:"duplicate_id"});}
    finally {reopened.close();}
    assert.equal(sends,1);
  },tally);
});
