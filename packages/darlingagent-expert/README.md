# DARLINGAGENT — AUTONOMOUS EVENT MANAGER

This is the local hackathon Expert. The separate hosted operations implementation is preserved for future development and is not required here.

## Prepare the runtime and package

From the repository root, with Node 22 or newer:

```sh
npm ci
npm test
npm run expert:package
```

The generated package is `artifacts/darlingagent-expert`. Its `.mcp.json` contains the actual absolute Node executable and server path for this checkout. Generate it on each machine; do not move/delete the checkout after installation. The source package uses a plugin-root path for repository development. The generated package is the recommended install target.

## Install once in WorkBuddy

Open **Experts · Skills · Connectors → Experts → My Experts → Create Expert**. Ask the built-in `expert-manager` to install the generated package directory without rewriting it, preserving `.codebuddy-plugin/plugin.json`, `agents/darlingagent.md`, the bundled `event-execution` skill, and `.mcp.json`. Register it as a My Experts entry named `darlingagent`. Then summon **DARLINGAGENT — AUTONOMOUS EVENT MANAGER** from My Experts. Its instructions load automatically; do not paste the system prompt for each event.

The package follows the official Expert schema: https://open.workbuddy.cn/en/docs/expert . A schema-valid package is not proof of a successful client installation; see the live verification record in `docs/LOCAL_MVP.md`.

## Connect the local MCP

If the Expert dependency card does not connect it automatically, open **Connectors → Custom Connectors** and add the stdio configuration from the generated `.mcp.json`. It launches `dist/scripts/run-mcp.js` directly. Do not use `npm run mcp` as the stdio command because npm banners can corrupt protocol output. No HTTPS URL, Telegram token, hosted backend, encryption key or Google OAuth project is required.

Discover tools including `event_create_structured`, `event_get`, `task_create`, `task_update`, `budget_validate`, `proposal_save`, `document_generate`, and `registration_draft/create/get`.

Default persistent database on macOS: `~/Library/Application Support/campus-event-agent/campus-events.sqlite`. PDFs, task trackers and invitation drafts are written under its `deliverables/` directory. Set `CAMPUS_EVENT_DB_PATH` in the connector environment to use another database. Use a dedicated local database; do not point this trusted local connector at a multi-user hosted database.

## Optional Tally

Set `TALLY_API_KEY` privately in the connector environment, then restart/reconnect the connector. Never put it in the package, source control or chat. Ask the Expert to run `tally_verify_connection`. Without a key, planning, drafting, budgets and PDFs still work. Publishing requires explicit approval of the draft; capacity is supported, automatic deadline closing is not. After a successful create, the service retrieves the form from Tally and stores its ID and URL. A failed or uncertain attempt stays reserved to prevent duplicate publication; reconcile it before any retry.

## Demonstrate

Summon DarlingAgent and enter one prompt:

> Organize an AI networking event for 50 students at Taylor's University on 20 October 2026. Budget: RM1,500. Prepare everything needed.

The Expert should execute local tools, save a plan and dependencies, validate the budget, draft registration, research vendors if browsing is available, save an unsent invitation and generate a real proposal PDF. It should return IDs, absolute file paths, validation evidence, pending approvals and unresolved work. No publication or email sending is authorized by this prompt.

In a second message, ask: "Retrieve the same event from the database and show its budget and outstanding tasks." A separate scenario with a different title, attendance and budget must produce different state and deliverables.

If Tally is configured, explicitly approve the exact reviewed registration draft; then verify `registration_get` and regenerate the PDF. If an email connector is available, approve the exact recipients/content separately. Otherwise the invitation remains an unsent file.

Telegram is optional. No new bot or routing workaround is included. Use the Expert directly in WorkBuddy unless the native Assistant explicitly supports selecting it and that route has been verified.
