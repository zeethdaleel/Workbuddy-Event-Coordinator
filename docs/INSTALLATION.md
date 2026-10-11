# Installing DarlingAgent

DarlingAgent is designed primarily for Tencent WorkBuddy.

The recommended installation is:

**WorkBuddy Expert + Local MCP Server + SQLite**

No Telegram bot, VPS, or cloud deployment is required for
the current hackathon MVP.

## 1. Requirements

Before installation, make sure you have:

- Node.js 22 or newer
- npm
- Git
- Tencent WorkBuddy
- A supported operating system

Check Node.js:

```bash
node --version
```

Check npm:

```bash
npm --version
```

## 2. Download DarlingAgent

Clone the official team repository:

```bash
git clone https://github.com/zeethdaleel/darling-agent.git
cd darling-agent
```

If you previously cloned the repository under its old
name, you can keep your existing local folder.

## 3. Install Dependencies

Run:

```bash
npm ci
```

This installs the dependencies using the
repository's package lockfile.

## 4. Verify the Application

Run:

```bash
npm test
```

The test suite checks supported application behavior,
including database persistence, task dependencies,
budget validation, and document generation.

A passing test suite verifies the tested application
components, not necessarily the WorkBuddy user interface.

## 5. Build the WorkBuddy Expert

Run:

```bash
npm run expert:package
```

This creates:

```text
artifacts/darlingagent-expert/
```

The generated package contains:

- Expert manifest
- Agent instructions
- Event execution skill
- Expert avatar
- Local MCP configuration

The packaging script writes machine-specific executable
paths into the generated MCP configuration.

Regenerate this package on every new machine.

Do not move the cloned repository after installation
without rebuilding and updating the MCP configuration.

## 6. Install in WorkBuddy

Open Tencent WorkBuddy and sign in.

Find the Expert management interface.

Depending on the installed version, navigate to:

**Experts → My Experts → Create Expert**

Install the generated DarlingAgent package using
WorkBuddy's supported Expert installation mechanism.

The package is located at:

```text
artifacts/darlingagent-expert
```

The Expert should be registered as:

```text
DARLINGAGENT
AUTONOMOUS EVENT MANAGER
```

The repository includes the required package structure.

However, native installation and execution must be
verified in the user's actual WorkBuddy environment.

If your WorkBuddy version does not support importing
the package directly, follow its supported custom
Expert or expert-manager installation workflow.

Do not manually modify undocumented WorkBuddy
registry files.

## 7. Connect the Local MCP Server

The generated package includes:

```text
.mcp.json
```

This contains a connector named:

```text
darlingagent-local
```

If WorkBuddy does not connect the dependency automatically,
open its custom connector settings.

Configure a local stdio MCP server.

Command:

```text
node
```

Arguments:

```text
/ABSOLUTE/PATH/TO/darling-agent/dist/scripts/run-mcp.js
```

The generated `.mcp.json` includes the correct
machine-specific executable and path.

Use that generated configuration wherever possible.

Do not use `npm run mcp` directly as the WorkBuddy
stdio command. The direct Node.js entry point is
preferred because npm output can interfere with MCP.

## 8. Verify the Tools

After connecting, confirm WorkBuddy can discover
and invoke actual tools.

Examples:

- event_create_structured
- event_list
- event_get
- task_create
- task_update
- budget_validate
- proposal_save
- proposal_get
- document_generate
- registration_draft
- registration_get

Ask WorkBuddy to verify the MCP connection before
attempting a complete event workflow.

## 9. First Event

Summon DarlingAgent and enter:

> Organize an AI networking event for
> 50 students at Taylor's University
> on 20 October 2026.
>
> Budget: RM1,500.
>
> Create a persistent event plan, organizer tasks,
> an itemized budget, a registration draft,
> and a real proposal PDF.
>
> Execute supported local operations.
> Show actual file paths and tool results.
> Ask before publishing or sending anything.

Verify that the Expert:

1. Invokes the MCP tools.
2. Saves an event record.
3. Creates tasks.
4. Validates budget calculations.
5. Generates an actual PDF file.
6. Returns the relevant outputs.
7. Distinguishes completed actions from drafts.

## 10. Optional Tally Integration

Tally is used for registration publication.

A Tally API key is optional.

Without the key, DarlingAgent can still prepare
registration drafts.

With a valid key, the integration supports
form creation after explicit approval.

Configure `TALLY_API_KEY` privately in the
local MCP connector's environment.

Never paste the API key into an AI conversation,
commit it to GitHub, or include it in documentation.

Restart the MCP connector after changing its
environment variables.

Ask DarlingAgent to run:

```text
tally_verify_connection
```

After a successful connection check:

1. Create a registration draft.
2. Review the fields and capacity.
3. Explicitly approve publication.
4. Create the form.
5. Verify the returned URL.

Automatic enforcement of registration deadlines
is not implemented.

## 11. Local Database

DarlingAgent uses SQLite.

The default macOS location is:

```text
~/Library/Application Support/campus-event-agent/campus-events.sqlite
```

The local workflow stores supported generated deliverables
in a related `deliverables` directory.

You can configure another path through:

```text
CAMPUS_EVENT_DB_PATH
```

Use an absolute path if configuring this explicitly.

Different database paths represent different event records.

Back up your database if the records are important.

## 12. Use with Other Coding Assistants

The repository includes a reusable agent skill.

For compatible AI coding environments, try:

```bash
npx skills add zeethdaleel/darling-agent --list
```

Example installation:

```bash
npx skills add zeethdaleel/darling-agent --skill campus-event-agent -a opencode -a codex -a claude-code -a cursor -a windsurf
```

Verify supported Skills CLI options in your installed version.

This command installs the agent skill only.

The complete MCP server requires separate installation
and configuration.

## 13. Troubleshooting

### WorkBuddy cannot find the Expert

Check whether the package was registered through the
supported Expert installation interface.

Verify the package manifest and installed WorkBuddy version.

### MCP tools are missing

Confirm the local connector exists and its paths point
to the correct repository checkout.

Rebuild:

```bash
npm run expert:package
```

Reconfigure the connector if necessary.

### Node.js command fails

Check:

```bash
node --version
```

Node.js 22 or newer is required.

### Event records are missing

Check that the MCP server is using the same
SQLite database path as the previous session.

### PDF is not generated

Check MCP errors, document-generation output,
and whether the output directory is writable.

### Tally is not connected

Verify that the API key is configured in the
connector environment and the connector has restarted.

Do not expose the key in logs or screenshots.

## 14. Additional Resources

[Official Repository](https://github.com/zeethdaleel/darling-agent)

[Architecture](ARCHITECTURE.md)

[Project Status](STATUS.md)

[Demonstration Guide](DEMO.md)

[WorkBuddy Expert Documentation](https://open.workbuddy.cn/en/docs/expert)
