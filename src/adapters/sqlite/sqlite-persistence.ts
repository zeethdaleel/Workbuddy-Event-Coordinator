import Database from "better-sqlite3";
import { validateEventTransition, validateTaskTransition } from "../../core/lifecycle.js";
import type {
  ApprovalRepository,
  ArtifactMetadataRepository,
  CreateResult,
  EventRepository,
  TaskRepository,
  UpdateResult
} from "../../core/ports/persistence.js";
import type { PersistedApproval, PersistedArtifact, PersistedEvent, PersistedEventFact, PersistedRegistrationForm, PersistedSpecialistResult, PersistedTask, PersistedValidation } from "../../core/domain.js";

const LATEST_SCHEMA_VERSION = 2;

type EventRow = { id: string; revision: number; workflow_json: string };
type TaskRow = { id: string; revision: number; event_id: string; title: string; status: PersistedTask["status"] };
type ApprovalRow = { id: string; revision: number; event_id: string; task_id: string | null; action: string; status: PersistedApproval["status"] };
type ArtifactRow = { id: string; revision: number; event_id: string; artifact_json: string };
type FactRow = { id: string; revision: number; event_id: string; field: string; value: string; evidence: string; status: PersistedEventFact["status"] };
type ResultRow = { id: string; revision: number; event_id: string; task_id: string; specialist: string; result_json: string; evidence_json: string; unresolved_json: string };
type ValidationRow = { id: string; revision: number; event_id: string; checks_json: string };
type RegistrationFormRow = { id: string; revision: number; event_id: string; tally_form_id: string; form_url: string; status: PersistedRegistrationForm["status"]; spec_hash: string; created_at: string; updated_at: string };

/**
 * SQLite implementation of the core persistence ports. It owns SQL, migration,
 * and transaction mechanics while the core remains storage-agnostic.
 */
export class SqlitePersistence {
  private readonly database: Database.Database;
  readonly events: EventRepository;
  readonly tasks: TaskRepository;
  readonly approvals: ApprovalRepository;
  readonly artifacts: ArtifactMetadataRepository;
  readonly facts: import("../../core/ports/persistence.js").EventFactRepository;
  readonly results: import("../../core/ports/persistence.js").SpecialistResultRepository;
  readonly validations: import("../../core/ports/persistence.js").ValidationRepository;
  readonly registrationForms: import("../../core/ports/persistence.js").RegistrationFormRepository;

  constructor(path: string) {
    this.database = new Database(path);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.migrate();
    this.events = this.createEventRepository();
    this.tasks = this.createTaskRepository();
    this.approvals = this.createApprovalRepository();
    this.artifacts = this.createArtifactRepository();
    this.facts = this.createFactRepository();
    this.results = this.createResultRepository();
    this.validations = this.createValidationRepository();
    this.registrationForms = this.createRegistrationFormRepository();
  }

  close(): void {
    this.database.close();
  }

  schemaVersion(): number {
    return (this.database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations").get() as { version: number }).version;
  }

  /**
   * Adapter-level transaction hook for future multi-record application work.
   * The callback must be synchronous; the port methods execute their SQL before
   * returning their Promises, so they can safely participate without awaiting.
   */
  transaction<T>(work: () => T): T {
    return this.database.transaction(work)();
  }

  private migrate(): void {
    this.database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const applied = new Set((this.database.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((row) => row.version));
    if (!applied.has(1)) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE events (
            id TEXT PRIMARY KEY,
            revision INTEGER NOT NULL CHECK (revision >= 0),
            workflow_json TEXT NOT NULL
          );
          CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            revision INTEGER NOT NULL CHECK (revision >= 0),
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
            title TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('queued', 'in_progress', 'needs_input', 'needs_approval', 'blocked', 'completed', 'failed'))
          );
          CREATE INDEX tasks_event_id_idx ON tasks(event_id);
          CREATE TABLE approvals (
            id TEXT PRIMARY KEY,
            revision INTEGER NOT NULL CHECK (revision >= 0),
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
            task_id TEXT REFERENCES tasks(id) ON DELETE RESTRICT,
            action TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired'))
          );
          CREATE INDEX approvals_event_id_idx ON approvals(event_id);
          CREATE INDEX approvals_task_status_idx ON approvals(task_id, status);
          CREATE TRIGGER approvals_task_event_insert
          BEFORE INSERT ON approvals WHEN NEW.task_id IS NOT NULL
          BEGIN
            SELECT CASE WHEN (SELECT event_id FROM tasks WHERE id = NEW.task_id) != NEW.event_id
              THEN RAISE(ABORT, 'approval task must belong to the same event') END;
          END;
          CREATE TRIGGER approvals_task_event_update
          BEFORE UPDATE OF event_id, task_id ON approvals WHEN NEW.task_id IS NOT NULL
          BEGIN
            SELECT CASE WHEN (SELECT event_id FROM tasks WHERE id = NEW.task_id) != NEW.event_id
              THEN RAISE(ABORT, 'approval task must belong to the same event') END;
          END;
          CREATE TABLE artifacts (
            id TEXT PRIMARY KEY,
            revision INTEGER NOT NULL CHECK (revision >= 0),
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
            artifact_json TEXT NOT NULL
          );
          CREATE INDEX artifacts_event_id_idx ON artifacts(event_id);
        `);
        this.database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(1, new Date().toISOString());
      })();
    }
    if (this.schemaVersion() > LATEST_SCHEMA_VERSION) throw new Error("Unsupported SQLite schema version.");
    // Additive tables are safe for existing v1 prototype databases.  They do
    // not alter the stable prototype event payload or its migration marker.
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS task_dependencies (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT, dependency_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT, PRIMARY KEY (task_id, dependency_id), CHECK (task_id != dependency_id));
      CREATE TABLE IF NOT EXISTS event_facts (id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK (revision >= 0), event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT, field TEXT NOT NULL, value TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('estimate', 'confirmed', 'conflicting')));
      CREATE INDEX IF NOT EXISTS event_facts_event_id_idx ON event_facts(event_id);
      CREATE TABLE IF NOT EXISTS specialist_results (id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK (revision >= 0), event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT, specialist TEXT NOT NULL, result_json TEXT NOT NULL, evidence_json TEXT NOT NULL, unresolved_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS specialist_results_event_id_idx ON specialist_results(event_id);
      CREATE TRIGGER IF NOT EXISTS specialist_result_task_event_insert BEFORE INSERT ON specialist_results BEGIN SELECT CASE WHEN (SELECT event_id FROM tasks WHERE id = NEW.task_id) != NEW.event_id THEN RAISE(ABORT, 'result task must belong to the same event') END; END;
      CREATE TABLE IF NOT EXISTS validations (id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK (revision >= 0), event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT, checks_json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS validations_event_id_idx ON validations(event_id);
      CREATE TABLE IF NOT EXISTS registration_forms (id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK (revision >= 0), event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT, tally_form_id TEXT NOT NULL, form_url TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('live', 'unverified')), spec_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS registration_forms_event_id_idx ON registration_forms(event_id);
      CREATE TABLE IF NOT EXISTS registration_creation_intents (event_id TEXT PRIMARY KEY REFERENCES events(id), registration_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    `);
    this.migrateTaskStates();
  }

  private migrateTaskStates(): void {
    if (this.schemaVersion() >= 2) return;
    // Standard SQLite table rebuild: preserve task IDs, dependent foreign keys,
    // indexes and triggers. Foreign keys are checked before committing.
    this.database.pragma("foreign_keys = OFF");
    this.database.pragma("legacy_alter_table = ON");
    try {
      this.database.transaction(() => {
        if (this.schemaVersion() >= 2) return;
        const triggers = this.database.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL").all() as {name:string;sql:string}[];
        const indexes = this.database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='tasks' AND sql IS NOT NULL").all() as {sql:string}[];
        for (const trigger of triggers) this.database.exec(`DROP TRIGGER "${trigger.name.replace(/"/g, '""')}"`);
        this.database.exec(`
          CREATE TABLE tasks_v2 (
            id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision >= 0),
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
            title TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('queued','in_progress','needs_input','needs_approval','blocked','completed','failed','cancelled'))
          );
          INSERT INTO tasks_v2 SELECT id,revision,event_id,title,status FROM tasks;
          DROP TABLE tasks;
          ALTER TABLE tasks_v2 RENAME TO tasks;
        `);
        for (const index of indexes) this.database.exec(index.sql);
        for (const trigger of triggers) this.database.exec(trigger.sql);
        if ((this.database.pragma("foreign_key_check") as unknown[]).length) throw new Error("Task migration failed foreign-key validation");
        this.database.prepare("INSERT INTO schema_migrations VALUES(2,?)").run(new Date().toISOString());
      }).immediate();
    } finally {
      this.database.pragma("legacy_alter_table = OFF");
      this.database.pragma("foreign_keys = ON");
    }
  }

  private createEventRepository(): EventRepository {
    return {
      get: async (id) => {
        const row = this.database.prepare("SELECT id, revision, workflow_json FROM events WHERE id = ?").get(id) as EventRow | undefined;
        return row === undefined ? undefined : { id: row.id, revision: row.revision, workflow: decodeJson(row.workflow_json) };
      },
      create: async (record) => {
        try {
          this.database.prepare("INSERT INTO events (id, revision, workflow_json) VALUES (?, ?, ?)").run(record.id, record.revision, encodeJson(record.workflow));
          return { ok: true, record: structuredClone(record) };
        } catch (error) {
          if (isDuplicateId(error)) return { ok: false, reason: "duplicate_id" };
          throw error;
        }
      },
      update: async (record, expectedRevision) => {
        const current = await this.events.get(record.id);
        if (current === undefined) return { ok: false, reason: "not_found" };
        if (current.revision !== expectedRevision) return { ok: false, reason: "revision_conflict" };
        if (!validateEventTransition(current.workflow.status, record.workflow.status).allowed) return { ok: false, reason: "revision_conflict" };
        const result = this.database.prepare("UPDATE events SET revision = ?, workflow_json = ? WHERE id = ? AND revision = ?")
          .run(expectedRevision + 1, encodeJson(record.workflow), record.id, expectedRevision);
        if (result.changes === 0) return { ok: false, reason: "revision_conflict" };
        return { ok: true, record: { ...structuredClone(record), revision: expectedRevision + 1 } };
      }
    };
  }

  private createTaskRepository(): TaskRepository {
    return {
      get: async (id) => mapTask(this.database.prepare("SELECT id, revision, event_id, title, status FROM tasks WHERE id = ?").get(id) as TaskRow | undefined),
      listByEvent: async (eventId) => (this.database.prepare("SELECT id, revision, event_id, title, status FROM tasks WHERE event_id = ? ORDER BY id").all(eventId) as TaskRow[]).map(mapTask).filter((task): task is PersistedTask => task !== undefined),
      dependencies: async (taskId) => (this.database.prepare("SELECT dependency_id FROM task_dependencies WHERE task_id = ? ORDER BY dependency_id").all(taskId) as Array<{ dependency_id: string }>).map((row) => row.dependency_id),
      setDependencies: async (taskId, dependencyIds) => {
        this.database.prepare("DELETE FROM task_dependencies WHERE task_id = ?").run(taskId);
        const insert = this.database.prepare("INSERT INTO task_dependencies (task_id, dependency_id) VALUES (?, ?)");
        for (const dependencyId of dependencyIds) insert.run(taskId, dependencyId);
      },
      createWithDependencies: async (record, dependencyIds) => {
        try {
          this.database.transaction(() => {
            this.database.prepare("INSERT INTO tasks (id, revision, event_id, title, status) VALUES (?, ?, ?, ?, ?)").run(record.id, record.revision, record.eventId, record.title, record.status);
            const insert = this.database.prepare("INSERT INTO task_dependencies (task_id, dependency_id) VALUES (?, ?)");
            for (const dependencyId of dependencyIds) insert.run(record.id, dependencyId);
          })();
          return { ok: true, record: structuredClone(record) };
        } catch (error) {
          if (isDuplicateId(error)) return { ok: false, reason: "duplicate_id" };
          throw error;
        }
      },
      create: async (record) => this.createRecord(record, "INSERT INTO tasks (id, revision, event_id, title, status) VALUES (?, ?, ?, ?, ?)", [record.id, record.revision, record.eventId, record.title, record.status]),
      update: async (record, expectedRevision) => {
        const current = mapTask(this.database.prepare("SELECT id, revision, event_id, title, status FROM tasks WHERE id = ?").get(record.id) as TaskRow | undefined);
        if (current === undefined) return { ok: false, reason: "not_found" };
        if (current.revision !== expectedRevision) return { ok: false, reason: "revision_conflict" };
        const approval = current.status === "needs_approval" && (record.status === "in_progress" || record.status === "completed")
          ? this.database.prepare("SELECT 1 FROM approvals WHERE task_id = ? AND status = 'approved' LIMIT 1").get(record.id)
          : undefined;
        if (!validateTaskTransition(current.status, record.status, approval === undefined ? undefined : "approved").allowed) {
          return { ok: false, reason: "revision_conflict" };
        }
        const result = this.database.prepare("UPDATE tasks SET revision = ?, event_id = ?, title = ?, status = ? WHERE id = ? AND revision = ?")
          .run(expectedRevision + 1, record.eventId, record.title, record.status, record.id, expectedRevision);
        if (result.changes === 0) return { ok: false, reason: "revision_conflict" };
        return { ok: true, record: { ...structuredClone(record), revision: expectedRevision + 1 } };
      }
    };
  }

  private createApprovalRepository(): ApprovalRepository {
    return {
      get: async (id) => mapApproval(this.database.prepare("SELECT id, revision, event_id, task_id, action, status FROM approvals WHERE id = ?").get(id) as ApprovalRow | undefined),
      listByEvent: async (eventId) => (this.database.prepare("SELECT id, revision, event_id, task_id, action, status FROM approvals WHERE event_id = ? ORDER BY id").all(eventId) as ApprovalRow[]).map(mapApproval).filter((record): record is PersistedApproval => record !== undefined),
      create: async (record) => this.createRecord(record, "INSERT INTO approvals (id, revision, event_id, task_id, action, status) VALUES (?, ?, ?, ?, ?, ?)", [record.id, record.revision, record.eventId, record.taskId ?? null, record.action, record.status]),
      update: async (record, expectedRevision) => this.updateSimpleRecord(record, expectedRevision, "approvals", "UPDATE approvals SET revision = ?, event_id = ?, task_id = ?, action = ?, status = ? WHERE id = ? AND revision = ?", [record.eventId, record.taskId ?? null, record.action, record.status, record.id])
    };
  }

  private createArtifactRepository(): ArtifactMetadataRepository {
    return {
      get: async (id) => mapArtifact(this.database.prepare("SELECT id, revision, event_id, artifact_json FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined),
      listByEvent: async (eventId) => (this.database.prepare("SELECT id, revision, event_id, artifact_json FROM artifacts WHERE event_id = ? ORDER BY id").all(eventId) as ArtifactRow[]).map(mapArtifact).filter((record): record is PersistedArtifact => record !== undefined),
      create: async (record) => this.createRecord(record, "INSERT INTO artifacts (id, revision, event_id, artifact_json) VALUES (?, ?, ?, ?)", [record.id, record.revision, record.eventId, encodeJson(record.artifact)]),
      update: async (record, expectedRevision) => this.updateSimpleRecord(record, expectedRevision, "artifacts", "UPDATE artifacts SET revision = ?, event_id = ?, artifact_json = ? WHERE id = ? AND revision = ?", [record.eventId, encodeJson(record.artifact), record.id])
    };
  }

  private createFactRepository(): import("../../core/ports/persistence.js").EventFactRepository {
    return {
      get: async (id) => mapFact(this.database.prepare("SELECT id, revision, event_id, field, value, evidence, status FROM event_facts WHERE id = ?").get(id) as FactRow | undefined),
      listByEvent: async (eventId) => (this.database.prepare("SELECT id, revision, event_id, field, value, evidence, status FROM event_facts WHERE event_id = ? ORDER BY id").all(eventId) as FactRow[]).map(mapFact).filter((record): record is PersistedEventFact => record !== undefined),
      create: async (record) => this.createRecord(record, "INSERT INTO event_facts (id, revision, event_id, field, value, evidence, status) VALUES (?, ?, ?, ?, ?, ?, ?)", [record.id, record.revision, record.eventId, record.field, record.value, record.evidence, record.status]),
      createWithConflict: async (record, conflictingFactId) => {
        try {
          this.database.transaction(() => {
            this.database.prepare("INSERT INTO event_facts (id, revision, event_id, field, value, evidence, status) VALUES (?, ?, ?, ?, ?, ?, ?)").run(record.id, record.revision, record.eventId, record.field, record.value, record.evidence, record.status);
            if (conflictingFactId !== undefined) {
              const changed = this.database.prepare("UPDATE event_facts SET revision = revision + 1, status = 'conflicting' WHERE id = ? AND event_id = ?").run(conflictingFactId, record.eventId);
              if (changed.changes !== 1) throw new Error("Conflicting fact disappeared during update.");
            }
          })();
          return { ok: true, record: structuredClone(record) };
        } catch (error) {
          if (isDuplicateId(error)) return { ok: false, reason: "duplicate_id" };
          throw error;
        }
      },
      update: async (record, expectedRevision) => this.updateSimpleRecord(record, expectedRevision, "event_facts", "UPDATE event_facts SET revision = ?, event_id = ?, field = ?, value = ?, evidence = ?, status = ? WHERE id = ? AND revision = ?", [record.eventId, record.field, record.value, record.evidence, record.status, record.id])
    };
  }

  private createResultRepository(): import("../../core/ports/persistence.js").SpecialistResultRepository {
    return {
      get: async (id) => mapResult(this.database.prepare("SELECT id, revision, event_id, task_id, specialist, result_json, evidence_json, unresolved_json FROM specialist_results WHERE id = ?").get(id) as ResultRow | undefined),
      listByEvent: async (eventId) => (this.database.prepare("SELECT id, revision, event_id, task_id, specialist, result_json, evidence_json, unresolved_json FROM specialist_results WHERE event_id = ? ORDER BY id").all(eventId) as ResultRow[]).map(mapResult).filter((record): record is PersistedSpecialistResult => record !== undefined),
      create: async (record) => this.createRecord(record, "INSERT INTO specialist_results (id, revision, event_id, task_id, specialist, result_json, evidence_json, unresolved_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [record.id, record.revision, record.eventId, record.taskId, record.specialist, encodeJson(record.result), encodeJson(record.evidence), encodeJson(record.unresolvedIssues)]),
      update: async (record, expectedRevision) => this.updateSimpleRecord(record, expectedRevision, "specialist_results", "UPDATE specialist_results SET revision = ?, event_id = ?, task_id = ?, specialist = ?, result_json = ?, evidence_json = ?, unresolved_json = ? WHERE id = ? AND revision = ?", [record.eventId, record.taskId, record.specialist, encodeJson(record.result), encodeJson(record.evidence), encodeJson(record.unresolvedIssues), record.id])
    };
  }

  private createValidationRepository(): import("../../core/ports/persistence.js").ValidationRepository {
    return {
      get: async (id) => mapValidation(this.database.prepare("SELECT id, revision, event_id, checks_json FROM validations WHERE id = ?").get(id) as ValidationRow | undefined),
      listByEvent: async (eventId) => (this.database.prepare("SELECT id, revision, event_id, checks_json FROM validations WHERE event_id = ? ORDER BY id").all(eventId) as ValidationRow[]).map(mapValidation).filter((record): record is PersistedValidation => record !== undefined),
      create: async (record) => this.createRecord(record, "INSERT INTO validations (id, revision, event_id, checks_json) VALUES (?, ?, ?, ?)", [record.id, record.revision, record.eventId, encodeJson(record.checks)]),
      update: async (record, expectedRevision) => this.updateSimpleRecord(record, expectedRevision, "validations", "UPDATE validations SET revision = ?, event_id = ?, checks_json = ? WHERE id = ? AND revision = ?", [record.eventId, encodeJson(record.checks), record.id])
    };
  }

  private createRegistrationFormRepository(): import("../../core/ports/persistence.js").RegistrationFormRepository {
    return {
      reserveCreation: async (eventId, registrationId) => this.database.prepare("INSERT OR IGNORE INTO registration_creation_intents VALUES (?, ?, ?)").run(eventId, registrationId, new Date().toISOString()).changes === 1,
      get: async (id) => mapRegistrationForm(this.database.prepare("SELECT id, revision, event_id, tally_form_id, form_url, status, spec_hash, created_at, updated_at FROM registration_forms WHERE id = ?").get(id) as RegistrationFormRow | undefined),
      listByEvent: async (eventId) => (this.database.prepare("SELECT id, revision, event_id, tally_form_id, form_url, status, spec_hash, created_at, updated_at FROM registration_forms WHERE event_id = ? ORDER BY id").all(eventId) as RegistrationFormRow[]).map(mapRegistrationForm).filter((record): record is PersistedRegistrationForm => record !== undefined),
      create: async (record) => this.createRecord(record, "INSERT INTO registration_forms (id, revision, event_id, tally_form_id, form_url, status, spec_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [record.id, record.revision, record.eventId, record.tallyFormId, record.formUrl, record.status, record.specHash, record.createdAt, record.updatedAt]),
      update: async (record, expectedRevision) => this.updateSimpleRecord(record, expectedRevision, "registration_forms", "UPDATE registration_forms SET revision = ?, event_id = ?, tally_form_id = ?, form_url = ?, status = ?, spec_hash = ?, created_at = ?, updated_at = ? WHERE id = ? AND revision = ?", [record.eventId, record.tallyFormId, record.formUrl, record.status, record.specHash, record.createdAt, record.updatedAt, record.id])
    };
  }

  private async createRecord<T extends { id: string }>(record: T, sql: string, values: unknown[]): Promise<CreateResult<T>> {
    try {
      this.database.prepare(sql).run(...values);
      return { ok: true, record: structuredClone(record) };
    } catch (error) {
      if (isDuplicateId(error)) return { ok: false, reason: "duplicate_id" };
      throw error;
    }
  }

  private async updateSimpleRecord<T extends { id: string; revision: number }>(record: T, expectedRevision: number, table: "approvals" | "artifacts" | "event_facts" | "specialist_results" | "validations" | "registration_forms", sql: string, values: unknown[]): Promise<UpdateResult<T>> {
    const exists = this.database.prepare(`SELECT revision FROM ${table} WHERE id = ?`).get(record.id) as { revision: number } | undefined;
    if (exists === undefined) return { ok: false, reason: "not_found" };
    if (exists.revision !== expectedRevision) return { ok: false, reason: "revision_conflict" };
    const result = this.database.prepare(sql).run(expectedRevision + 1, ...values, expectedRevision);
    if (result.changes === 0) return { ok: false, reason: "revision_conflict" };
    return { ok: true, record: { ...structuredClone(record), revision: expectedRevision + 1 } };
  }
}

function mapTask(row: TaskRow | undefined): PersistedTask | undefined {
  return row === undefined ? undefined : { id: row.id, revision: row.revision, eventId: row.event_id, title: row.title, status: row.status };
}

function mapApproval(row: ApprovalRow | undefined): PersistedApproval | undefined {
  return row === undefined ? undefined : { id: row.id, revision: row.revision, eventId: row.event_id, ...(row.task_id === null ? {} : { taskId: row.task_id }), action: row.action, status: row.status };
}

function mapArtifact(row: ArtifactRow | undefined): PersistedArtifact | undefined {
  return row === undefined ? undefined : { id: row.id, revision: row.revision, eventId: row.event_id, artifact: decodeJson(row.artifact_json) };
}

function mapFact(row: FactRow | undefined): PersistedEventFact | undefined {
  return row === undefined ? undefined : { id: row.id, revision: row.revision, eventId: row.event_id, field: row.field, value: row.value, evidence: row.evidence, status: row.status };
}

function mapResult(row: ResultRow | undefined): PersistedSpecialistResult | undefined {
  return row === undefined ? undefined : { id: row.id, revision: row.revision, eventId: row.event_id, taskId: row.task_id, specialist: row.specialist, result: decodeJson(row.result_json), evidence: decodeJson(row.evidence_json), unresolvedIssues: decodeJson(row.unresolved_json) };
}

function mapValidation(row: ValidationRow | undefined): PersistedValidation | undefined {
  return row === undefined ? undefined : { id: row.id, revision: row.revision, eventId: row.event_id, checks: decodeJson(row.checks_json) };
}

function mapRegistrationForm(row: RegistrationFormRow | undefined): PersistedRegistrationForm | undefined {
  return row === undefined ? undefined : { id: row.id, revision: row.revision, eventId: row.event_id, tallyFormId: row.tally_form_id, formUrl: row.form_url, status: row.status, specHash: row.spec_hash, createdAt: row.created_at, updatedAt: row.updated_at };
}

function isDuplicateId(error: unknown): boolean {
  return error instanceof Error && "code" in error && ["SQLITE_CONSTRAINT_PRIMARYKEY", "SQLITE_CONSTRAINT_UNIQUE"].includes(String((error as { code: unknown }).code));
}

type EncodedJson = { value: unknown; undefinedPaths: string[][] };

/** JSON omits undefined values, so preserve their property paths explicitly. */
function encodeJson(value: unknown): string {
  const undefinedPaths: string[][] = [];
  collectUndefinedPaths(value, [], undefinedPaths);
  return JSON.stringify({ value, undefinedPaths } satisfies EncodedJson);
}

function decodeJson<T>(encoded: string): T {
  const payload = JSON.parse(encoded) as EncodedJson;
  for (const path of payload.undefinedPaths) {
    let target = payload.value as Record<string, unknown>;
    for (const segment of path.slice(0, -1)) target = target[segment] as Record<string, unknown>;
    target[path.at(-1)!] = undefined;
  }
  return payload.value as T;
}

function collectUndefinedPaths(value: unknown, path: string[], output: string[][]): void {
  if (value === undefined) {
    output.push(path);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) collectUndefinedPaths(child, [...path, key], output);
  }
}
