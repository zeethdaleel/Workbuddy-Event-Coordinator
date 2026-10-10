import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createLocalMcpApplication } from "../adapters/mcp/server.js";

async function withClient(run: (client: Client) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "campus-event-mcp-"));
  const app = createLocalMcpApplication(join(directory, "events.sqlite"));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-test-client", version: "1.0.0" });
  try {
    await app.server.connect(serverTransport);
    await client.connect(clientTransport);
    await run(client);
  } finally {
    await client.close();
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function value(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  assert.equal(result.isError, undefined);
  return (result.structuredContent as { value: unknown }).value;
}

test("MCP tool discovery exposes only bounded event-management operations", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ["approval_record_decision", "approval_request", "artifact_get", "budget_validate", "document_generate", "event_create", "event_create_structured", "event_get", "event_list", "event_list_tasks", "event_update_facts", "proposal_get", "proposal_save", "registration_create", "registration_draft", "registration_get", "tally_verify_connection", "task_create", "task_submit_result", "task_transition", "task_update"]);
    assert.equal(tools.tools.find((tool) => tool.name === "event_create")?.inputSchema.required?.includes("eventId"), true);
  });
});

test("MCP client completes persistent event, task, validation, approval, and reopen workflow", async () => {
  const directory = await mkdtemp(join(tmpdir(), "campus-event-mcp-reopen-"));
  const databasePath = join(directory, "events.sqlite");
  async function connect() {
    const app = createLocalMcpApplication(databasePath);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mcp-test-client", version: "1.0.0" });
    await app.server.connect(serverTransport); await client.connect(clientTransport);
    return { app, client };
  }
  const first = await connect();
  try {
    const created = await first.client.callTool({ name: "event_create", arguments: { eventId: "networking-2026", eventBrief: "Organise a university networking event for 50 attendees within RM1,500." } });
    assert.equal((value(created) as { workflow: { total: number } }).workflow.total, 1360);
    assert.equal((await first.client.callTool({ name: "budget_validate", arguments: { eventId: "networking-2026", validationId: "budget-check-1" } })).isError, undefined);
    assert.equal((await first.client.callTool({ name: "task_create", arguments: { taskId: "venue-task", eventId: "networking-2026", title: "Confirm venue", status: "needs_approval" } })).isError, undefined);
    const blocked = await first.client.callTool({ name: "task_transition", arguments: { taskId: "venue-task", expectedRevision: 0, status: "completed" } });
    assert.equal(blocked.isError, true);
    assert.match(blocked.content.find((item) => item.type === "text")?.text ?? "", /approval_required/);
    assert.equal((await first.client.callTool({ name: "approval_request", arguments: { approvalId: "venue-approval", eventId: "networking-2026", taskId: "venue-task", action: "Confirm venue" } })).isError, undefined);
    assert.equal((await first.client.callTool({ name: "approval_record_decision", arguments: { approvalId: "venue-approval", expectedRevision: 0, status: "approved" } })).isError, undefined);
    assert.equal((await first.client.callTool({ name: "task_transition", arguments: { taskId: "venue-task", expectedRevision: 0, status: "completed" } })).isError, undefined);
    const tasks = await first.client.callTool({ name: "event_list_tasks", arguments: { eventId: "networking-2026" } });
    assert.equal((value(tasks) as Array<{ status: string }>)[0]?.status, "completed");
    const stale = await first.client.callTool({ name: "approval_record_decision", arguments: { approvalId: "venue-approval", expectedRevision: 0, status: "rejected" } });
    assert.equal(stale.isError, true);
  } finally { await first.client.close(); await first.app.close(); }
  const reopened = await connect();
  try {
    const event = await reopened.client.callTool({ name: "event_get", arguments: { eventId: "networking-2026" } });
    assert.equal((value(event) as { event: { id: string } }).event.id, "networking-2026");
    const invalid = await reopened.client.callTool({ name: "event_create", arguments: { eventId: "bad id with space", eventBrief: "x" } });
    assert.equal(invalid.isError, true);
  } finally { await reopened.client.close(); await reopened.app.close(); await rm(directory, { recursive: true, force: true }); }
});
