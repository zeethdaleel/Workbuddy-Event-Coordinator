import type { BudgetLine, ValidationCheck } from "./domain.js";

export const prototypeBudget = (): BudgetLine[] => [
  { item: "Venue hire", amount: 350, status: "estimate", note: "Campus room estimate; availability is unverified." },
  { item: "Refreshments", amount: 600, status: "estimate", note: "RM12 per attendee for 50 attendees." },
  { item: "Name badges and networking materials", amount: 140, status: "estimate", note: "Draft estimate." },
  { item: "Promotion and printing", amount: 120, status: "estimate", note: "Draft estimate; no content has been published." },
  { item: "Contingency", amount: 150, status: "estimate", note: "Reserved for unconfirmed costs." }
];

export function calculateTotal(lines: BudgetLine[]): number {
  return Math.round(lines.reduce((total, line) => total + Math.round(line.amount * 100), 0)) / 100;
}

export function validateBudget(lines: BudgetLine[], limit?: number, currency = "RM"): ValidationCheck[] {
  const total = calculateTotal(lines);
  const checks: ValidationCheck[] = [];
  checks.push({
    name: "positive line items",
    status: lines.length > 0 && lines.every((line) => Number.isFinite(line.amount) && line.amount >= 0) ? "passed" : "failed",
    detail: "Every line item must have a finite, non-negative amount."
  });
  if (limit === undefined) {
    checks.push({ name: "budget ceiling", status: "not_verified", detail: "A budget ceiling is required to verify affordability." });
  } else {
    checks.push({
      name: "budget ceiling",
      status: Number.isFinite(limit) && limit >= 0 && Number.isFinite(total) && total <= limit ? "passed" : "failed",
      detail: total <= limit ? `${currency}${total} is within the ${currency}${limit} ceiling.` : `${currency}${total} exceeds the ${currency}${limit} ceiling by ${currency}${total - limit}.`
    });
  }
  return checks;
}
