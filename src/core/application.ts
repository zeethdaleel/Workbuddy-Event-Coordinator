import { calculateTotal, prototypeBudget, validateBudget } from "./budget.js";
import type { EventRequest, WorkflowResult } from "./domain.js";
import { derivePrototypeStatus, missingPrototypeConstraints } from "./lifecycle.js";

export function extractPrototypeRequest(text: string): EventRequest {
  const attendees = text.match(/(\d+)\s*(?:attendees|people|students)/i)?.[1];
  const budget = text.match(/RM\s*([\d,]+)/i)?.[1]?.replace(/,/g, "");
  return {
    title: text.trim().replace(/^(?:Darling,?\s*)?(?:organise|organize|create|plan)\s+(?:an?\s+)?/i, "").split(/\s+(?:for|with|within|at|on)\s+|[.!?\n]/i)[0]?.trim() || "Untitled event",
    attendeeCount: attendees ? Number(attendees) : undefined,
    budgetLimit: budget ? Number(budget) : undefined,
    currency: "RM"
  };
}

/** Creates the original deterministic workflow result without infrastructure side effects. */
export function preparePrototypeWorkflow(text: string): WorkflowResult {
  const request = extractPrototypeRequest(text);
  const missing = missingPrototypeConstraints(request);
  const budget = request.attendeeCount === undefined ? [] : prototypeBudget().map(line => ({ ...line, amount: Math.round(line.amount * request.attendeeCount! / 50 * 100) / 100, note: "Illustrative estimate scaled by attendance from the legacy sample; replace with event-specific sourced estimates." }));
  const total = calculateTotal(budget);
  const validation = validateBudget(budget, request.budgetLimit, request.currency);

  return {
    status: derivePrototypeStatus(missing, validation),
    request,
    budget,
    total,
    remainingBudget: request.budgetLimit === undefined ? undefined : request.budgetLimit - total,
    assumptions: ["All costs are estimates, not quotations or approved spend.", "Legacy fallback parsing is limited; WorkBuddy should use event_create_structured for confirmed event details and its itemized budget."],
    unresolvedIssues: [...missing, "Venue availability, booking, institutional approvals, and supplier quotations have not been verified or completed."],
    validation,
    artifacts: []
  };
}
