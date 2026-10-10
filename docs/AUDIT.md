# DarlingAgent 2.0 audit

Baseline: e01b3f9, inspected 2026-10-10. Existing suite: **46 passed, 0 failed** before source changes. `npm ci` could not run because the repository only shipped a pnpm lock; `npm install` and `npm test` succeeded. npm lockfile will make npm builds reproducible.

Existing: TypeScript, local stdio MCP, SQLite event/task/fact/artifact/approval persistence, revision checks, task dependencies, deterministic budget validation, Tally create/get/connectivity adapter, two WorkBuddy role definitions. Tests use real temporary SQLite databases and mocked Tally HTTP.

Confirmed gaps: fixed event title and 50-person sample costs; no structured WorkBuddy event/budget input; no Telegram backend, durable scheduler, document generator, OAuth or multi-user authorization. Local artifact wording incorrectly attributes deterministic work to agents. Approval records are workflow notes, not authenticated permission grants. Tally create has a check-then-send race and ambiguous failures can duplicate forms. Same-status event updates are rejected. Dependencies are checked on completion but not start.

## Platform evidence

- [Official Telegram guide](https://www.workbuddy.ai/docs/workbuddy/Platform-Integration/Telegram-Guide): Assistant runs on the user's computer; bot configuration lives in WorkBuddy.
- [Official FAQ](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/FQA): WorkBuddy must run to execute remote Assistant tasks.
- [Official Automation guide](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide): one-time and recurring tasks are documented; this is not proof of a supported cloud invocation API.
- [Official connector guidance](https://open.workbuddy.cn/en/docs/connector): MCP plus skill is the integration direction. No invented WorkBuddy REST execution endpoint will be added.

Native team import, routing from Telegram into the custom team, account capability, cloud execution, and hackathon eligibility remain unverified. No secrets or live provider accounts were supplied. Cloud deployment requires user choice and authorization.

## Implementation sequence

1. Preserve legacy compatibility while adding validated structured event/budget input for WorkBuddy; fix title/cost assumptions and dependency checks.
2. Add real PDF artifacts, version/hash evidence, and Telegram adapter.
3. Add durable reminder jobs with claims, explicit uncertain-delivery handling, recurrence and standalone worker.
4. Add authenticated operations backend and connection/approval infrastructure; integrate providers incrementally.
5. Test, document capability limits, and create a reviewable PR. Never describe this as production ready without live end-to-end verification.

Additional audit findings: compiled `dist/` and generated `artifacts/` files were tracked despite ignore rules; they are removed from tracking and remain reproducible from source. Root extensionless files `core`, `mcp`, `tally`, `tests` are uploaded source copies outside TypeScript's include path, preserved unchanged. The advertised `.codebuddy-plugin/plugin.json` is missing, so native import is explicitly unverified.

## Increment verification

Final local suite: **69 passed, 0 failed**, including real SQLite and PDF operations; provider HTTP and OAuth behavior tested with mocks. Clean npm installation was verified. Two offline scenarios generated proposal PDFs and verification JSON; rendered PDFs were visually inspected. No live Gmail/Tally/Telegram/Google/WorkBuddy execution or cloud deployment occurred. Docker daemon was unavailable; image build remains unverified.

Desktop observation: WorkBuddy AI 5.7.6 is installed and its Assistant UI shows Telegram connected. This is evidence of native channel configuration only, not execution of the new backend or successful team import. No new prompts were submitted or bot settings changed.
