import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillPath = join(packageRoot, "skills", "campus-event-agent", "SKILL.md");

async function readSkill(): Promise<string> {
  return readFile(skillPath, "utf8");
}

function readFrontmatter(source: string): Record<string, string> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, "SKILL.md must start with YAML frontmatter");
  const fields: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (field?.[1] && field[2]) fields[field[1]] = field[2].trim();
  }
  return fields;
}

test("skill lives at the standard discovery path with valid frontmatter", async () => {
  const source = await readSkill();
  const frontmatter = readFrontmatter(source);
  assert.equal(frontmatter.name, "campus-event-agent");
  assert.match(frontmatter.name ?? "", /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok((frontmatter.description ?? "").length > 20, "description must explain when to use the skill");
});

test("skill covers the full coordinator workflow", async () => {
  const source = (await readSkill()).toLowerCase();
  for (const specialist of ["compliance", "registration", "logistics", "marketing", "finance", "work distribution"]) {
    assert.ok(source.includes(specialist), `skill must cover the ${specialist} workstream`);
  }
  for (const required of ["assumption", "dependencies", "approval", "fallback", "budget_validat", "artifact"]) {
    assert.ok(source.includes(required), `skill must cover ${required}`);
  }
});

test("skill documents the MCP tools without overstating them", async () => {
  const source = await readSkill();
  for (const tool of [
    "event_create", "event_get", "event_update_facts", "task_create", "task_submit_result",
    "task_transition", "budget_validate", "event_list_tasks", "approval_request",
    "approval_record_decision", "artifact_get", "registration_draft", "registration_create",
    "registration_get", "tally_verify_connection"
  ]) {
    assert.ok(source.includes(tool), `skill must document the ${tool} tool`);
  }
  assert.ok(
    /installing this skill does not install/i.test(source),
    "skill must state that installing it does not install the MCP server"
  );
  assert.ok(
    /explicit confirmation/i.test(source),
    "skill must state that live form creation requires explicit confirmation"
  );
  assert.ok(
    /without confirmation it returns the draft/i.test(source),
    "skill must state that unconfirmed creation returns the draft instead of a live form"
  );
});

test("package ships the skill and documents the verified Skills CLI syntax", async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as { files: string[] };
  assert.ok(
    (manifest.files ?? []).some((entry) => entry.startsWith("skills/")),
    "package files must include the skills directory"
  );
  const readme = await readFile(join(packageRoot, "README.md"), "utf8");
  assert.ok(readme.includes("npx skills add zeethdaleel/darling-agent --list"));
  assert.ok(readme.includes("--skill campus-event-agent"));
  for (const agent of ["-a opencode", "-a codex", "-a claude-code", "-a cursor", "-a windsurf"]) {
    assert.ok(readme.includes(agent), `README must document the verified ${agent} identifier`);
  }
  assert.ok(readme.includes("-g"), "README must document the global install variant");
});
