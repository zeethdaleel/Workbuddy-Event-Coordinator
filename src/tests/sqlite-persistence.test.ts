import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { SqlitePersistence } from "../adapters/sqlite/sqlite-persistence.js";
import { preparePrototypeWorkflow } from "../core/application.js";
import type { PersistedEvent } from "../core/domain.js";

const event = (id = "event-1"): PersistedEvent => ({
  id,
  revision: 0,
  workflow: preparePrototypeWorkflow("Organise a university networking event.")
});

async function withDatabase(run: (store: SqlitePersistence, path: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "campus-event-agent-"));
  const path = join(directory, "events.sqlite");
  const store = new SqlitePersistence(path);
  try {
    await run(store, path);
  } finally {
    try {
      store.close();
    } catch {
      // Tests can intentionally close and reopen the database.
    }
    await rm(directory, { recursive: true, force: true });
  }
}

test("initializes once and persists an event across a database reopen", async () => {
  await withDatabase(async (store, path) => {
    assert.equal(store.schemaVersion(), 2);
    assert.deepEqual(await store.events.create(event()), { ok: true, record: event() });
    store.close();

    const reopened = new SqlitePersistence(path);
    try {
      assert.equal(reopened.schemaVersion(), 2);
      assert.deepEqual(await reopened.events.get("event-1"), event());
      assert.equal(await reopened.events.get("missing"), undefined);
      assert.deepEqual(await reopened.events.create(event()), { ok: false, reason: "duplicate_id" });
    } finally {
      reopened.close();
    }
  });
});

test("updates records with database-enforced revisions and rejects stale concurrent writes", async () => {
  await withDatabase(async (store) => {
    assert.equal((await store.events.create(event())).ok, true);
    assert.equal((await store.tasks.create({ id: "task-1", revision: 0, eventId: "event-1", title: "Draft budget", status: "queued" })).ok, true);
    const next = { id: "task-1", revision: 0, eventId: "event-1", title: "Draft budget", status: "in_progress" as const };
    const [first, stale] = await Promise.all([store.tasks.update(next, 0), store.tasks.update(next, 0)]);
    assert.equal(first.ok, true);
    assert.deepEqual(stale, { ok: false, reason: "revision_conflict" });
    assert.equal((await store.tasks.get("task-1"))?.revision, 1);

    const approval = { id: "approval-1", revision: 0, eventId: "event-1", taskId: "task-1", action: "Confirm venue", status: "pending" as const };
    assert.equal((await store.approvals.create(approval)).ok, true);
    assert.equal((await store.artifacts.create({ id: "artifact-1", revision: 0, eventId: "event-1", artifact: { type: "budget", path: "artifacts/budget.md", status: "draft" } })).ok, true);
    const approved = await store.approvals.update({ ...approval, status: "approved" }, 0);
    assert.equal(approved.ok, true);
    const artifactUpdate = await store.artifacts.update({ id: "artifact-1", revision: 0, eventId: "event-1", artifact: { type: "budget", path: "artifacts/budget-v2.md", status: "draft" } }, 0);
    assert.equal(artifactUpdate.ok, true);
    assert.equal((await store.approvals.get("approval-1"))?.status, "approved");
    assert.equal((await store.artifacts.get("artifact-1"))?.revision, 1);
  });
});

test("enforces foreign keys, same-event approval links, lifecycle rules, and approval gates", async () => {
  await withDatabase(async (store) => {
    await assert.rejects(store.tasks.create({ id: "orphan-task", revision: 0, eventId: "missing", title: "Impossible", status: "queued" }));
    assert.equal((await store.events.create(event())).ok, true);
    assert.equal((await store.events.create(event("event-2"))).ok, true);
    assert.equal((await store.tasks.create({ id: "task-1", revision: 0, eventId: "event-1", title: "Venue decision", status: "needs_approval" })).ok, true);
    assert.equal((await store.tasks.create({ id: "task-2", revision: 0, eventId: "event-2", title: "Other event", status: "queued" })).ok, true);
    await assert.rejects(store.approvals.create({ id: "wrong-link", revision: 0, eventId: "event-1", taskId: "task-2", action: "Confirm venue", status: "pending" }));

    const pendingCompletion = await store.tasks.update({ id: "task-1", revision: 0, eventId: "event-1", title: "Venue decision", status: "completed" }, 0);
    assert.deepEqual(pendingCompletion, { ok: false, reason: "revision_conflict" });
    const approval = { id: "approval-1", revision: 0, eventId: "event-1", taskId: "task-1", action: "Confirm venue", status: "pending" as const };
    assert.equal((await store.approvals.create(approval)).ok, true);
    assert.equal((await store.approvals.update({ ...approval, status: "approved" }, 0)).ok, true);
    assert.equal((await store.tasks.update({ id: "task-1", revision: 0, eventId: "event-1", title: "Venue decision", status: "completed" }, 0)).ok, true);

    const blocked = { ...event(), workflow: { ...event().workflow, status: "blocked" as const } };
    assert.equal((await store.events.update(blocked, 0)).ok, true);
    const invalidCompletion = await store.events.update({ ...blocked, revision: 1, workflow: { ...blocked.workflow, status: "completed" } }, 1);
    assert.deepEqual(invalidCompletion, { ok: false, reason: "revision_conflict" });
  });
});

test("rolls back all writes when an adapter transaction fails", async () => {
  await withDatabase(async (store) => {
    assert.throws(() => store.transaction(() => {
      void store.events.create(event("rolled-back"));
      throw new Error("simulated failure");
    }), /simulated failure/);
    assert.equal(await store.events.get("rolled-back"), undefined);
  });
});
