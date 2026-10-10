import type { PersistedApproval, PersistedArtifact, PersistedEvent, PersistedEventFact, PersistedRegistrationForm, PersistedSpecialistResult, PersistedTask, PersistedValidation } from "../domain.js";

export interface VersionedRecord {
  id: string;
  revision: number;
}

export type CreateResult<T> =
  | { ok: true; record: T }
  | { ok: false; reason: "duplicate_id" };

export type UpdateResult<T> =
  | { ok: true; record: T }
  | { ok: false; reason: "not_found" | "revision_conflict" };

/**
 * A storage boundary only. Implementations own durability, serialization, and
 * transaction mechanics; the core owns no database or filesystem dependency.
 */
export interface VersionedRepository<T extends VersionedRecord> {
  get(id: string): Promise<T | undefined>;
  create(record: T): Promise<CreateResult<T>>;
  update(record: T, expectedRevision: number): Promise<UpdateResult<T>>;
}

export interface EventRepository extends VersionedRepository<PersistedEvent> {}

/** Event-scoped query support belongs at the persistence boundary, not in domain logic. */
export interface EventScopedRepository<T extends VersionedRecord> extends VersionedRepository<T> {
  listByEvent(eventId: string): Promise<T[]>;
}

export interface TaskRepository extends EventScopedRepository<PersistedTask> {
  dependencies(taskId: string): Promise<string[]>;
  setDependencies(taskId: string, dependencyIds: string[]): Promise<void>;
  createWithDependencies(record: PersistedTask, dependencyIds: string[]): Promise<CreateResult<PersistedTask>>;
}
export interface ApprovalRepository extends EventScopedRepository<PersistedApproval> {}
export interface ArtifactMetadataRepository extends EventScopedRepository<PersistedArtifact> {}
export interface EventFactRepository extends EventScopedRepository<PersistedEventFact> {
  createWithConflict(record: PersistedEventFact, conflictingFactId?: string): Promise<CreateResult<PersistedEventFact>>;
}
export interface SpecialistResultRepository extends EventScopedRepository<PersistedSpecialistResult> {}
export interface ValidationRepository extends EventScopedRepository<PersistedValidation> {}
export interface RegistrationFormRepository extends EventScopedRepository<PersistedRegistrationForm> {
  /** Durable per-event reservation before an irreversible external POST. Never automatically released. */
  reserveCreation(eventId: string, registrationId: string): Promise<boolean>;
}

export interface PersistenceTransaction {
  transaction<T>(work: () => T): T;
}

export interface ApplicationPersistence extends PersistenceTransaction {
  events: EventRepository;
  tasks: TaskRepository;
  approvals: ApprovalRepository;
  artifacts: ArtifactMetadataRepository;
  facts: EventFactRepository;
  results: SpecialistResultRepository;
  validations: ValidationRepository;
  registrationForms: RegistrationFormRepository;
}
