import { prepareStructuredWorkflow, type StructuredEvent } from "./structured-event.js";
import { validateBudget } from "./budget.js";
import { preparePrototypeWorkflow } from "./application.js";
import type {
  Artifact, EventRequest, PersistedApproval, PersistedArtifact, PersistedEvent, PersistedEventFact,
  PersistedRegistrationForm, PersistedSpecialistResult, PersistedTask, PersistedValidation, TaskStatus, ValidationCheck
} from "./domain.js";
import type { ApplicationPersistence, CreateResult, UpdateResult } from "./ports/persistence.js";

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_found" | "duplicate_id" | "revision_conflict" | "invalid_transition" | "approval_required" | "dependency_unmet" | "file_not_written" | "conflicting_fact" | "confirmation_required" | "tally_not_configured" | "tally_auth" | "tally_rate_limited" | "tally_timeout" | "tally_unavailable" | "tally_malformed" | "tally_unverified" };

export interface EventSummary {
  event: PersistedEvent;
  tasks: Array<PersistedTask & { dependencies: string[]; results: PersistedSpecialistResult[] }>;
  approvals: PersistedApproval[];
  validations: PersistedValidation[];
  artifacts: PersistedArtifact[];
  facts: PersistedEventFact[];
  registrationForms: PersistedRegistrationForm[];
  unresolvedIssues: string[];
}

/**
 * Persistent use cases.  It deliberately accepts only persistence ports: the
 * deterministic domain remains unaware of SQLite, filesystems, or agents.
 */
export class EventApplicationService {
  constructor(private readonly store: ApplicationPersistence) {}

  async createEvent(id: string, requestText: string): Promise<ServiceResult<PersistedEvent>> {
    const result = await this.store.events.create({ id, revision: 0, workflow: preparePrototypeWorkflow(requestText) });
    return result.ok ? { ok: true, value: result.record } : result;
  }

  async createStructuredEvent(id: string, input: StructuredEvent): Promise<ServiceResult<PersistedEvent>> {
    const created = await this.store.events.create({ id, revision: 0, workflow: prepareStructuredWorkflow(input) });
    return created.ok ? { ok: true, value: created.record } : created;
  }

  async getEvent(id: string): Promise<ServiceResult<PersistedEvent>> {
    const event = await this.store.events.get(id);
    return event === undefined ? { ok: false, reason: "not_found" } : { ok: true, value: event };
  }

  async recordFact(fact: Omit<PersistedEventFact, "revision" | "status"> & { status?: PersistedEventFact["status"] }): Promise<ServiceResult<PersistedEventFact>> {
    if (await this.store.events.get(fact.eventId) === undefined) return { ok: false, reason: "not_found" };
    const existing = await this.store.facts.listByEvent(fact.eventId);
    const contradiction = existing.find((item) => item.field === fact.field && item.value !== fact.value);
    const status = contradiction === undefined ? (fact.status ?? "estimate") : "conflicting";
    const created = await this.store.facts.createWithConflict({ ...fact, revision: 0, status }, contradiction?.id);
    if (!created.ok) return created;
    // Record both sides of a conflict.  The original evidence is retained.
    if (contradiction !== undefined) return { ok: false, reason: "conflicting_fact" };
    return { ok: true, value: created.record };
  }

  async createTask(task: Omit<PersistedTask, "revision">, dependencyIds: string[] = []): Promise<ServiceResult<PersistedTask>> {
    if (await this.store.events.get(task.eventId) === undefined) return { ok: false, reason: "not_found" };
    for (const id of dependencyIds) {
      const dependency = await this.store.tasks.get(id);
      if (dependency === undefined || dependency.eventId !== task.eventId) return { ok: false, reason: "not_found" };
    }
    const resolved = await this.store.tasks.createWithDependencies({ ...task, revision: 0 }, dependencyIds);
    return resolved.ok ? { ok: true, value: resolved.record } : resolved;
  }

  async submitSpecialistResult(result: Omit<PersistedSpecialistResult, "revision">): Promise<ServiceResult<PersistedSpecialistResult>> {
    const task = await this.store.tasks.get(result.taskId);
    if (task === undefined || task.eventId !== result.eventId) return { ok: false, reason: "not_found" };
    const created = await this.store.results.create({ ...result, revision: 0 });
    return created.ok ? { ok: true, value: created.record } : created;
  }

  async transitionTask(id: string, expectedRevision: number, next: TaskStatus): Promise<ServiceResult<PersistedTask>> {
    const task = await this.store.tasks.get(id);
    if (task === undefined) return { ok: false, reason: "not_found" };
    if (task.revision !== expectedRevision) return { ok: false, reason: "revision_conflict" };
    if (next === "completed" || next === "in_progress") {
      const dependencies = await this.store.tasks.dependencies(id);
      for (const dependencyId of dependencies) if ((await this.store.tasks.get(dependencyId))?.status !== "completed") return { ok: false, reason: "dependency_unmet" };
    }
    const updated = await this.store.tasks.update({ ...task, status: next }, expectedRevision);
    if (!updated.ok) {
      // The adapter protects lifecycle and approval gates; expose useful service outcomes.
      if (task.status === "needs_approval" && (next === "completed" || next === "in_progress")) return { ok: false, reason: "approval_required" };
      return { ok: false, reason: "invalid_transition" };
    }
    return { ok: true, value: updated.record };
  }

  async requestApproval(approval: Omit<PersistedApproval, "revision" | "status">): Promise<ServiceResult<PersistedApproval>> {
    if (await this.store.events.get(approval.eventId) === undefined) return { ok: false, reason: "not_found" };
    if (approval.taskId !== undefined) {
      const task = await this.store.tasks.get(approval.taskId);
      if (task === undefined || task.eventId !== approval.eventId) return { ok: false, reason: "not_found" };
    }
    const created = await this.store.approvals.create({ ...approval, revision: 0, status: "pending" });
    return created.ok ? { ok: true, value: created.record } : created;
  }

  async recordApprovalDecision(id: string, expectedRevision: number, status: "approved" | "rejected" | "expired"): Promise<ServiceResult<PersistedApproval>> {
    const approval = await this.store.approvals.get(id);
    if (approval === undefined) return { ok: false, reason: "not_found" };
    if (approval.revision !== expectedRevision) return { ok: false, reason: "revision_conflict" };
    const updated = await this.store.approvals.update({ ...approval, status }, expectedRevision);
    return updated.ok ? { ok: true, value: updated.record } : updated;
  }

  async validateEvent(id: string, validationId: string): Promise<ServiceResult<PersistedValidation>> {
    const event = await this.store.events.get(id);
    if (event === undefined) return { ok: false, reason: "not_found" };
    const checks = validateBudget(event.workflow.budget, event.workflow.request.budgetLimit, event.workflow.request.currency);
    const created = await this.store.validations.create({ id: validationId, revision: 0, eventId: id, checks });
    return created.ok ? { ok: true, value: created.record } : created;
  }

  /** The verifier must confirm a completed file write. DB + filesystem are not one transaction. */
  async registerArtifact(record: Omit<PersistedArtifact, "revision">, fileWritten: () => Promise<boolean>): Promise<ServiceResult<PersistedArtifact>> {
    if (!await fileWritten()) return { ok: false, reason: "file_not_written" };
    if (await this.store.events.get(record.eventId) === undefined) return { ok: false, reason: "not_found" };
    const created = await this.store.artifacts.create({ ...record, revision: 0 });
    return created.ok ? { ok: true, value: created.record } : created;
  }

  async getSummary(eventId: string): Promise<ServiceResult<EventSummary>> {
    const event = await this.store.events.get(eventId);
    if (event === undefined) return { ok: false, reason: "not_found" };
    const [taskRecords, approvals, validations, artifacts, facts, allResults, registrationForms] = await Promise.all([
      this.store.tasks.listByEvent(eventId), this.store.approvals.listByEvent(eventId), this.store.validations.listByEvent(eventId),
      this.store.artifacts.listByEvent(eventId), this.store.facts.listByEvent(eventId), this.store.results.listByEvent(eventId),
      this.store.registrationForms.listByEvent(eventId)
    ]);
    const tasks = await Promise.all(taskRecords.map(async (task) => ({
      ...task, dependencies: await this.store.tasks.dependencies(task.id), results: allResults.filter((result) => result.taskId === task.id)
    })));
    const unresolvedIssues = [...event.workflow.unresolvedIssues, ...facts.filter((fact) => fact.status === "conflicting").map((fact) => `Conflicting ${fact.field}: ${fact.value}.`)];
    return { ok: true, value: { event, tasks, approvals, validations, artifacts, facts, registrationForms, unresolvedIssues } };
  }
}
