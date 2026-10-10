import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractPrototypeRequest, preparePrototypeWorkflow } from "./core/application.js";
import type { Artifact, EventRequest, WorkflowResult } from "./core/domain.js";

export function extractRequest(text: string): EventRequest {
  return extractPrototypeRequest(text);
}

function planMarkdown(result: WorkflowResult): string {
  return `# ${result.request.title}\n\n## Confirmed request constraints\n- Expected attendance: ${result.request.attendeeCount ?? "not provided"}\n- Budget ceiling: ${result.request.budgetLimit ? `RM${result.request.budgetLimit}` : "not provided"}\n\n## Workflow\n1. Local fallback parser extracted supported fields; no WorkBuddy execution is claimed.\n2. A legacy attendance-scaled estimate was prepared; replace it with WorkBuddy event-specific estimates.\n3. The backend ran deterministic arithmetic and ceiling checks.\n\n## Assumptions\n${result.assumptions.map((item) => `- ${item}`).join("\n")}\n\n## Unresolved issues\n${result.unresolvedIssues.map((item) => `- ${item}`).join("\n")}\n\n## Validation\n${result.validation.map((check) => `- **${check.status}** — ${check.name}: ${check.detail}`).join("\n")}\n`;
}

function budgetMarkdown(result: WorkflowResult): string {
  const rows = result.budget.map((line) => `| ${line.item} | RM${line.amount} | ${line.status} | ${line.note} |`).join("\n");
  return `# Draft budget\n\n| Item | Amount | Status | Note |\n|---|---:|---|---|\n${rows}\n| **Total** | **RM${result.total}** | draft | Arithmetic calculated by the prototype. |\n\nRemaining against ceiling: ${result.remainingBudget === undefined ? "not verified" : `RM${result.remainingBudget}`}\n`;
}

export async function runPrototype(text: string, outputDirectory = "artifacts"): Promise<WorkflowResult> {
  const result = preparePrototypeWorkflow(text);
  await mkdir(outputDirectory, { recursive: true });
  const eventPlanPath = join(outputDirectory, "event-plan.md");
  const budgetPath = join(outputDirectory, "budget.md");
  await writeFile(eventPlanPath, planMarkdown(result), "utf8");
  await writeFile(budgetPath, budgetMarkdown(result), "utf8");
  result.artifacts = [
    { type: "event_plan", path: eventPlanPath, status: "draft" },
    { type: "budget", path: budgetPath, status: "draft" }
  ];
  return result;
}
