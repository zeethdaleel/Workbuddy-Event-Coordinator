# DarlingAgent

**One Prompt. One Goal. End-to-End Execution.**

DarlingAgent is a **local-first WorkBuddy Expert** for event planning. WorkBuddy supplies reasoning and calls a local MCP server for persistent events, dependency tasks, budget validation, registration drafts and real proposal PDFs. Tally publication requires configuration and explicit approval; email uses an available native connector or remains an unsent draft.

Start with [the local Expert installation guide](packages/darlingagent-expert/README.md) and [the MVP verification record](docs/LOCAL_MVP.md). The earlier hosted backend, Telegram bot, reminder worker and OAuth implementation are preserved but are not required for this hackathon workflow.

```sh
npm ci
npm test
npm run expert:package
```

Install `artifacts/darlingagent-expert` through WorkBuddy's native expert-manager, connect its local stdio configuration, then summon DarlingAgent from My Experts. No system-prompt pasting is needed per event.

## Start here

- [Repository audit and baseline](docs/AUDIT.md)
- [Setup, accounts, secrets, Telegram webhook and deployment](docs/DEPLOYMENT.md)
- [WorkBuddy desktop and MCP setup](packages/workbuddy-team/README.md)
- [Operations contract and approval boundaries](docs/OPERATIONS.md)
- [Offline and live demonstration procedures](docs/DEMO.md)
- [Implemented, mocked, blocked and missing capabilities](docs/STATUS.md)

## Build and test

Node.js **22+** and npm are required. Use the committed npm lockfile.

```bash
npm ci
npm test
node dist/scripts/demo-operations.js artifacts/operations
```

The offline demonstration creates two real PDFs and verification JSON for different event types, attendance and budgets. No external service is contacted. Costs are explicitly illustrative estimates. `npm run demo` retains the old Markdown demonstration, now with a parsed title and attendance-scaled sample estimates. WorkBuddy should use structured inputs for real planning.

## Preserved hosted architecture (not required for the MVP)

```text
WorkBuddy desktop (understanding, planning, tool selection)
  -> local operations MCP adapter
  -> HTTPS backend (token bound to one Telegram owner)
  -> existing event database + operational tables
  -> PDFs, pending actions, secure account connections

Telegram operations bot
  -> authenticated webhook
  -> private identity, durable inbox, exact-content approval buttons

Independent cloud reminder worker
  -> durable SQLite jobs -> Telegram API -> acknowledgment history
```

WorkBuddy remains the intelligent execution platform. There is no replacement LLM orchestrator and no invented WorkBuddy cloud endpoint. Natural-language messages to the operations bot are saved for the desktop coordinator to consume; they are not automatically executed by a cloud agent. Native WorkBuddy Telegram Assistant needs a separate bot and a running desktop. Configure and verify routing before claiming one-prompt autonomy.

SQLite and documents need one host with persistent local storage. Backend and worker must run continuously. Docker and Compose files are supplied but were not built here because no Docker daemon was running. No production deployment or paid infrastructure was created.

## Account connections and real actions

Telegram `/connect gmail`, `/connect calendar`, `/connect drive` and `/connect tally` open private, short-lived HTTPS onboarding flows. Google uses the maintained OAuth library, PKCE, one-use state and account/scope verification. Credentials use AES-256-GCM with owner/provider binding. Tally keys are entered on a secure page, not in chat.

External actions freeze the reviewed payload, bind approval to the user and content hash, expire after one hour and claim execution once. Connecting never approves a send. The backend can send Gmail MIME messages with PDFs, publish and retrieve Tally forms, create Calendar events without guests, and upload PDFs privately to Drive. Live verification is pending. See each adapter's specific limits in STATUS.md.

Reminder delivery means Telegram returned a matching chat/message ID, not that someone read it. A network timeout after a send may be ambiguous; the job is held for reconciliation instead of blindly retried. Daily/weekly scheduling preserves local wall time across DST. No continuously running service is claimed until deployment is complete.

## Existing local MCP (trusted prototype)

The existing local event/task/fact/approval/registration interface remains available:

```bash
CAMPUS_EVENT_DB_PATH=./data/legacy-events.sqlite npm run mcp
```

It exposes `event_create`, `event_create_structured`, `event_get`, `event_update_facts`, `task_create`, `task_submit_result`, `task_transition`, `budget_validate`, `event_list_tasks`, `approval_request`, `approval_record_decision`, `artifact_get`, `registration_draft`, `registration_create`, `registration_get`, and `tally_verify_connection`.

This trusted-local interface accepts caller-recorded approval assertions. **Do not expose it publicly or use it as the authenticated Telegram approval service.** The operations MCP is a separate adapter for that purpose. `event_create_structured` preserves WorkBuddy's actual facts and itemized budget. Legacy workflow `completed` still means draft budget validation, never external execution.

Tally creation requires `TALLY_API_KEY` in the legacy MCP environment and explicit confirmation. It verifies the created form and persists its real ID/URL. New durable per-event reservations prevent concurrent/uncertain retries from creating duplicates. Failed attempts require deliberate reconciliation before retry. The registration deadline is not automatically enforced. Tests use mocked HTTP responses; first live form submission must be checked manually.

The legacy database defaults outside the package cache; `CAMPUS_EVENT_DB_PATH` overrides it. The operations runtime instead uses `DARLING_DATA_DIR/events.sqlite` plus a `documents` directory. Never commit either database or secrets.

## Optional skill installation

Installing this skill does not install the MCP server or an Expert Team. The original Skills CLI syntax remains:

```bash
npx skills add faizanburgi/DarlingAgent --list
npx skills add faizanburgi/DarlingAgent --skill campus-event-agent -a opencode -a codex -a claude-code -a cursor -a windsurf
npx skills add faizanburgi/DarlingAgent --skill campus-event-agent -g -a opencode -a codex -a claude-code -a cursor -a windsurf
```

Use a reviewed Git revision for your deployment rather than an assumed release tag. The native WorkBuddy team package/import path is not verified: the original README referenced a manifest that was not committed. Follow the installed client's supported custom expert/MCP UI and the [WorkBuddy instructions](packages/workbuddy-team/README.md).

No credentials belong in Git history, public Telegram groups, agent prompts or issue comments. Review [DEPLOYMENT.md](docs/DEPLOYMENT.md) before live setup and [STATUS.md](docs/STATUS.md) before presenting a demonstration.
