import { z } from 'zod';
import { calculateTotal, validateBudget } from './budget.js';
import type { WorkflowResult } from './domain.js';

const short = z.string().trim().min(1).max(500);
export const eventRequestSchema = z.object({
  title: short,
  eventType: short.optional(), description: z.string().max(10000).optional(),
  organizer: short.optional(), date: z.iso.date().optional(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  timezone: z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }).optional(),
  location: short.optional(), venue: short.optional(),
  attendeeCount: z.number().int().positive().max(1000000).optional(),
  budgetLimit: z.number().finite().nonnegative().max(100000000).optional(),
  currency: z.string().regex(/^(?:[A-Z]{3}|RM)$/).default('MYR'),
  targetAudience: short.optional(), requirements: z.array(short).max(100).default([]),
  constraints: z.array(short).max(100).default([]), deliverables: z.array(short).max(100).default([])
}).strict().refine(value => !value.startTime || !value.endTime || value.endTime > value.startTime, 'End time must follow start time on the event date');
export const budgetLineSchema = z.object({
  item: short, amount: z.number().finite().nonnegative().max(100000000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001, 'Use at most two decimal places'),
  status: z.enum(['estimate', 'confirmed']), note: z.string().trim().min(1).max(2000)
}).strict();
export const structuredEventSchema = z.object({
  request: eventRequestSchema,
  budget: z.array(budgetLineSchema).max(200),
  assumptions: z.array(short).max(100).default([])
}).strict();
export type StructuredEvent = z.infer<typeof structuredEventSchema>;

/** WorkBuddy supplies interpretation and estimates; this service validates facts and arithmetic. */
export function prepareStructuredWorkflow(input: StructuredEvent): WorkflowResult {
  const parsed = structuredEventSchema.parse(input);
  const missing = ['attendeeCount', 'budgetLimit', 'date', 'timezone', 'location']
    .filter(key => parsed.request[key as keyof typeof parsed.request] === undefined)
    .map(key => `Missing ${key}; clarify before dependent execution.`);
  if (!parsed.budget.length) missing.push('Itemized budget is not prepared.');
  const validation = validateBudget(parsed.budget, parsed.request.budgetLimit, parsed.request.currency);
  const total = calculateTotal(parsed.budget);
  return {
    request: parsed.request, budget: parsed.budget, total,
    remainingBudget: parsed.request.budgetLimit === undefined ? undefined : Math.round((parsed.request.budgetLimit - total) * 100) / 100,
    status: missing.length ? 'needs_input' : validation.some(v => v.status === 'failed') ? 'blocked' : 'completed',
    assumptions: parsed.assumptions,
    unresolvedIssues: [...missing, 'Planning output only; bookings, publication, delivery and approvals need separate evidence.'],
    validation, artifacts: []
  };
}
