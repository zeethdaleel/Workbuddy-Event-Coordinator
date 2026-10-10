import type { ApprovalStatus, EventRequest, EventStatus, TaskStatus, ValidationCheck } from "./domain.js";

/**
 * Preserves the Milestone 1 lifecycle semantics. These states describe the
 * prototype workflow only; they make no claim about real-world completion.
 */
export function missingPrototypeConstraints(request: EventRequest): string[] {
  return [
    request.attendeeCount === undefined ? "Expected attendance is required." : undefined,
    request.budgetLimit === undefined ? "Budget ceiling is required." : undefined
  ].filter((item): item is string => Boolean(item));
}

export function derivePrototypeStatus(missing: string[], validation: ValidationCheck[]): EventStatus {
  if (missing.length > 0) return "needs_input";
  if (validation.some((check) => check.status === "failed")) return "blocked";
  return "completed";
}

export type TransitionResult =
  | { allowed: true }
  | { allowed: false; reason: "invalid_transition" | "approval_required" };

const eventTransitions: Readonly<Record<EventStatus, readonly EventStatus[]>> = {
  needs_input: ["blocked", "completed"],
  blocked: ["needs_input"],
  completed: []
};

const taskTransitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  queued: ["in_progress", "needs_input", "needs_approval", "blocked", "failed", "cancelled"],
  in_progress: ["needs_input", "needs_approval", "blocked", "completed", "failed", "cancelled"],
  needs_input: ["queued", "in_progress", "blocked", "failed", "cancelled"],
  needs_approval: ["in_progress", "completed", "blocked", "failed", "cancelled"],
  blocked: ["queued", "in_progress", "needs_input", "failed", "cancelled"],
  completed: ["queued"],
  failed: ["queued", "in_progress", "blocked", "cancelled"],
  cancelled: ["queued"]
};

/** Existing event statuses describe the draft-planning workflow, not real-world completion. */
export function validateEventTransition(current: EventStatus, next: EventStatus): TransitionResult {
  return eventTransitions[current].includes(next)
    ? { allowed: true }
    : { allowed: false, reason: "invalid_transition" };
}

/**
 * Task completion from an approval gate requires a separately recorded
 * approved decision; pending, rejected, and expired approvals never qualify.
 */
export function validateTaskTransition(
  current: TaskStatus,
  next: TaskStatus,
  approvalStatus?: ApprovalStatus
): TransitionResult {
  if (!taskTransitions[current].includes(next)) {
    return { allowed: false, reason: "invalid_transition" };
  }
  if (current === "needs_approval" && (next === "in_progress" || next === "completed") && approvalStatus !== "approved") {
    return { allowed: false, reason: "approval_required" };
  }
  return { allowed: true };
}
