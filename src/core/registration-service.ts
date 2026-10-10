import { buildRegistrationSpec, registrationSpecHash, tallyBlocksFromSpec, tallyFormUrl, type RegistrationSpec, type RegistrationSpecOptions } from "./registration.js";
import type { PersistedRegistrationForm } from "./domain.js";
import type { ApplicationPersistence } from "./ports/persistence.js";
import type { TallyFailureKind, TallyFormProvider } from "./ports/tally.js";
import type { ServiceResult } from "./event-application-service.js";

export interface RegistrationCreateInput extends RegistrationSpecOptions {
  registrationId: string;
  /** Explicit user confirmation. The live form is never created without it. */
  confirmed: boolean;
}

export interface RegistrationForms {
  forms: PersistedRegistrationForm[];
}

/**
 * Registration use cases. Drafting is offline and keyless; creation requires
 * an explicit confirmation flag plus a configured Tally provider, verifies
 * the returned form before persisting, and refuses duplicates.
 */
export class RegistrationService {
  constructor(
    private readonly store: ApplicationPersistence,
    private readonly tally?: TallyFormProvider
  ) {}

  async draftRegistration(eventId: string, options: RegistrationSpecOptions = {}): Promise<ServiceResult<RegistrationSpec>> {
    const event = await this.store.events.get(eventId);
    if (event === undefined) return { ok: false, reason: "not_found" };
    return { ok: true, value: buildRegistrationSpec(event, options) };
  }

  async createRegistrationForm(eventId: string, input: RegistrationCreateInput): Promise<ServiceResult<PersistedRegistrationForm>> {
    const event = await this.store.events.get(eventId);
    if (event === undefined) return { ok: false, reason: "not_found" };
    const existing = await this.store.registrationForms.listByEvent(eventId);
    if (existing.some((form) => form.status === "live")) return { ok: false, reason: "duplicate_id" };
    if (!input.confirmed) return { ok: false, reason: "confirmation_required" };
    if (this.tally === undefined) return { ok: false, reason: "tally_not_configured" };
    const spec = buildRegistrationSpec(event, input);
    // Keep the reservation after any failure: the provider may already have accepted the POST.
    // An operator must reconcile uncertain forms before authorizing another creation.
    if (!await this.store.registrationForms.reserveCreation(eventId, input.registrationId)) return { ok: false, reason: "duplicate_id" };
    const created = await this.tally.createForm(tallyBlocksFromSpec(spec), spec.capacity);
    if (!created.ok) return { ok: false, reason: mapTallyFailure(created.failure.kind) };
    if (created.form.status !== "PUBLISHED" || created.form.id.trim() === "") {
      return { ok: false, reason: "tally_unverified" };
    }
    // Verify the form exists and is accessible before claiming it is live.
    const verified = await this.tally.getForm(created.form.id);
    if (!verified.ok) return { ok: false, reason: mapTallyFailure(verified.failure.kind) };
    if (verified.form.id !== created.form.id || verified.form.status !== "PUBLISHED" || verified.form.isClosed === true) {
      return { ok: false, reason: "tally_unverified" };
    }
    const now = new Date().toISOString();
    const stored = await this.store.registrationForms.create({
      id: input.registrationId,
      revision: 0,
      eventId,
      tallyFormId: created.form.id,
      formUrl: tallyFormUrl(created.form.id),
      status: "live",
      specHash: registrationSpecHash(spec),
      createdAt: now,
      updatedAt: now
    });
    return stored.ok ? { ok: true, value: stored.record } : stored;
  }

  async getRegistrations(eventId: string): Promise<ServiceResult<RegistrationForms>> {
    if (await this.store.events.get(eventId) === undefined) return { ok: false, reason: "not_found" };
    return { ok: true, value: { forms: await this.store.registrationForms.listByEvent(eventId) } };
  }

  /**
   * Read-only connectivity diagnostic. Probes the Tally API with an
   * authenticated form-listing request; creates, reads, and returns no
   * form data, only the connection outcome.
   */
  async verifyTallyConnection(): Promise<ServiceResult<{ connected: true }>> {
    if (this.tally === undefined) return { ok: false, reason: "tally_not_configured" };
    const probed = await this.tally.verifyConnection();
    if (!probed.ok) return { ok: false, reason: mapTallyFailure(probed.failure.kind) };
    return { ok: true, value: { connected: true as const } };
  }
}

function mapTallyFailure(kind: TallyFailureKind): Extract<ServiceResult<PersistedRegistrationForm>, { ok: false }>["reason"] {
  switch (kind) {
    case "auth": return "tally_auth";
    case "rate_limited": return "tally_rate_limited";
    case "timeout": return "tally_timeout";
    case "malformed": return "tally_malformed";
    case "not_found": return "tally_unverified";
    default: return "tally_unavailable";
  }
}
