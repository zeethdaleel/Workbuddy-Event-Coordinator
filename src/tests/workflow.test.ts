import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { calculateTotal, prototypeBudget, validateBudget } from "../budget.js";
import { preparePrototypeWorkflow } from "../core/application.js";
import { derivePrototypeStatus, missingPrototypeConstraints } from "../core/lifecycle.js";
import { runPrototype } from "../workflow.js";

test("calculates the draft budget deterministically", () => {
  assert.equal(calculateTotal(prototypeBudget()), 1360);
});

test("reports an over-budget scenario", () => {
  const ceiling = validateBudget(prototypeBudget(), 1000);
  assert.equal(ceiling.find((check) => check.name === "budget ceiling")?.status, "failed");
});

test("requires critical missing inputs", async () => {
  const result = await runPrototype("Organise a university networking event.", "artifacts/test-missing");
  assert.equal(result.status, "needs_input");
  assert.match(result.unresolvedIssues.join(" "), /Expected attendance/);
});

test("blocks a validation failure while preserving draft artifacts", async () => {
  const result = await runPrototype("Organise a university networking event for 50 attendees within RM1,000.", "artifacts/test-over-budget");
  assert.equal(result.status, "blocked");
  assert.equal(result.artifacts.length, 2);
});

test("keeps the extracted core and compatibility wrapper behaviourally identical", async () => {
  const text = "Organise a university networking event for 50 attendees within RM1,500.";
  const coreResult = preparePrototypeWorkflow(text);
  const wrapperResult = await runPrototype(text, "artifacts/test-parity");

  assert.deepEqual({ ...wrapperResult, artifacts: [] }, coreResult);
  assert.deepEqual(coreResult.budget.map(line => line.amount), prototypeBudget().map(line => line.amount));
  assert.equal(coreResult.total, 1360);
  assert.equal(coreResult.remainingBudget, 140);
  assert.deepEqual(coreResult.validation.map((check) => check.status), ["passed", "passed"]);
  const plan = await readFile(join("artifacts/test-parity", "event-plan.md"), "utf8");
  assert.match(plan, /university networking event/);
  assert.match(plan, /no WorkBuddy execution is claimed/);
  assert.match(await readFile(join("artifacts/test-parity", "budget.md"), "utf8"), /RM1360/);
});

test("documents the existing workflow-only status semantics", () => {
  const request = { title: "University networking event", attendeeCount: 50, budgetLimit: 1500, currency: "RM" };
  const validation = validateBudget(prototypeBudget(), request.budgetLimit, request.currency);

  assert.equal(derivePrototypeStatus(missingPrototypeConstraints(request), validation), "completed");
  assert.equal(derivePrototypeStatus(["Budget ceiling is required."], validation), "needs_input");
  assert.equal(derivePrototypeStatus([], validateBudget(prototypeBudget(), 1000)), "blocked");
});

 test("fallback does not reuse event title or fixed attendance costs", () => {
  const small = preparePrototypeWorkflow("Organize a robotics workshop for 20 students within RM2,000.");
  const large = preparePrototypeWorkflow("Organize a science fair for 100 students within RM5,000.");
  assert.equal(small.request.title, "robotics workshop");
  assert.equal(large.request.title, "science fair");
  assert.notEqual(small.total, large.total);
});
