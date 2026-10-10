# Preserved earlier team design

For the hackathon, install the new [DarlingAgent local Expert](../darlingagent-expert/README.md). This earlier team/hosted setup is preserved as development history and is not required.

# DarlingAgent WorkBuddy desktop setup

The existing role prompts and avatars are preserved. **This directory is not a verified importable Expert Team package.** Its prior README referred to `.codebuddy-plugin/plugin.json`, but that file is absent in the source repository. `settings.json` is empty and its native schema has not been validated. Do not promise a one-command native import.

## Supported integration direction

[Official WorkBuddy connector guidance](https://open.workbuddy.cn/en/docs/connector) documents MCP plus skills. Configure a local stdio MCP server using the MCP settings offered by your installed WorkBuddy version:

```text
command: node
arguments: /ABSOLUTE/PATH/DarlingAgent/dist/scripts/run-operations-mcp.js
environment:
  DARLING_BACKEND_URL=https://YOUR_DOMAIN
  DARLING_AGENT_TOKEN=<private backend token>
```

Build with `npm ci` first. Match the token to the backend's configuration. The backend binds it to `DARLING_AGENT_OWNER`; do not include user IDs or secrets in agent prompts. The operations backend and reminder worker run separately on the selected cloud host. Installing the skill alone does not install the MCP server.

For local trusted prototype experiments only, the original `dist/scripts/run-mcp.js` still exists. It has a different security model and must not be exposed publicly. Do not connect both interfaces to the same production workflow.

## Coordinator instructions

Use `agents/campus-event-team-lead.md` for the lead and `agents/finance-budgeting.md` for Finance in the supported custom expert/team UI. The other workstreams are responsibility checklists, not claimed native agents. Read `docs/OPERATIONS.md` for typed inputs and approval boundaries. Tool discovery should show `darling_operations`.

1. Start the operations Telegram bot with `/start` to verify your identity.
2. In WorkBuddy, ask the coordinator to call `inbox_list` and process the pending event request, or supply the request in WorkBuddy directly.
3. WorkBuddy extracts the actual event facts, asks for critical omissions, and supplies structured event-specific costs. The backend never substitutes an independent model.
4. Persist the event, tasks, dependencies and assumptions. Generate and deliver the PDF; prepare registration/email actions. Approve exact previews **in Telegram**.
5. Store a reminder; the independent cloud worker delivers it later. Return the event and action IDs with verified results.
6. Mark the inbox item complete only after it has been handled or a clearly identified blocker reported.

[Native Telegram Assistant](https://www.workbuddy.ai/docs/workbuddy/Platform-Integration/Telegram-Guide) requires WorkBuddy running on the computer. Use a separate bot from the backend operations bot. Verify that it selects this coordinator in your installed client before using it for a one-prompt demonstration.

[Native Automation](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Automation-Guide) can be configured in WorkBuddy to check the inbox while the desktop runs. No automation was installed here. [The official FAQ](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/FQA) states that remote Assistant tasks require the desktop running. Supported headless/cloud WorkBuddy execution has **not** been verified. The deterministic reminder worker continues independently once jobs are persisted.

## Live validation still required

- Confirm the installed version's MCP configuration and custom team creation flow.
- Confirm Finance delegation and actual backend tool calls in WorkBuddy logs.
- Verify routing from native Telegram into this coordinator, or use the explicit inbox workflow.
- Run both scenarios in `docs/DEMO.md`; distinguish real provider IDs from mocked tests.
- Confirm hackathon tool-use eligibility with the organizer. This implementation was developed using Codex and does not assert competition eligibility.
