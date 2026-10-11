# DarlingAgent

### Your Event. Our Execution.

**One Prompt. One Goal. End-to-End Execution.**

DarlingAgent is a local-first AI event operations agent designed for
Tencent WorkBuddy.

It helps event organizers transform a natural-language request into
structured planning work, persistent tasks, validated budgets,
registration workflows, and real deliverable documents.

Rather than simply suggesting what to do, DarlingAgent uses MCP tools
to execute supported operations and verify their results.

**Best experienced in Tencent WorkBuddy.**

[Explore WorkBuddy](https://www.workbuddy.ai/) |
[Installation Guide](docs/INSTALLATION.md) |
[Architecture](docs/ARCHITECTURE.md) |
[Project Status](docs/STATUS.md)

---

## Why DarlingAgent?

Organizing an event involves numerous disconnected responsibilities:

- Planning schedules and activities
- Managing budgets and expenses
- Coordinating organizers and deadlines
- Preparing registration forms
- Researching vendors
- Creating documents and invitations
- Tracking unfinished work

Most AI chatbots can suggest an event plan.

DarlingAgent aims to go further by connecting AI reasoning
to persistent tools that perform and validate actual work.

**Describe the event. Let the agent handle the supported operations.**

---

## How It Works

```text
              EVENT ORGANIZER
                     |
                     v
               TENCENT WORKBUDDY
                     |
                     v
                 DARLINGAGENT
                     |
              Understand the goal
                     |
                     v
              Plan the workflow
                     |
                     v
              EXECUTE MCP TOOLS
                     |
        +------------+------------+
        |            |            |
        v            v            v
     Event DB      Budgets     Documents
        |            |            |
        v            v            v
      Tasks       Validation   PDF Proposal
        |            |            |
        +------------+------------+
                     |
                     v
                VERIFY OUTPUTS
                     |
                     v
             DELIVER REAL RESULTS
```

WorkBuddy handles natural-language understanding, planning,
and tool selection.

The DarlingAgent MCP server handles deterministic operations,
database persistence, validation, and document generation.

External operations such as publishing a registration form
require configuration and explicit user approval.

---

## Core Capabilities

### Autonomous event planning

DarlingAgent provides a WorkBuddy Expert and tools for organizing
event-planning workflows from natural-language instructions.

The complete native WorkBuddy execution flow is still undergoing
live verification.

### Persistent event management

Create, retrieve, and update event records.

Event details and task information are stored in SQLite,
allowing supported records to persist between sessions.

### Task coordination

Create structured tasks with dependencies and lifecycle states.

Record descriptions, priorities, and other task details.

Dependencies and supported state transitions are checked by
the application rather than relying solely on AI-generated text.

### Budget validation

Prepare event-specific itemized budgets.

The backend calculates totals and compares them against the
specified budget ceiling.

Cost estimates must be identified as estimates rather than
verified supplier quotations.

### Professional event documents

Generate real PDF event proposals containing relevant event facts,
budget details, planning information, tasks, and registration status.

The local workflow can also generate a task tracker and an
unsent invitation draft.

### Registration workflows

Prepare registration forms and review their details.

Tally integration supports publishing a registration form after
explicit confirmation and successful provider configuration.

A registration draft is not presented as a published form.

### WorkBuddy integrations

DarlingAgent is designed to use compatible WorkBuddy capabilities
for additional tasks such as source-based vendor research and
approved communications.

Availability depends on the connected tools and permissions.

These integrations must be verified individually.

---

## Best Used in WorkBuddy

DarlingAgent is developed primarily as a custom WorkBuddy Expert.

### Quick Start

**1. Install WorkBuddy**

Visit:

https://www.workbuddy.ai/

Install WorkBuddy and sign in.

**2. Open this repository**

https://github.com/zeethdaleel/darling-agent

**3. Ask WorkBuddy to help configure DarlingAgent**

You can use the following prompt:

> Inspect https://github.com/zeethdaleel/darling-agent.
> Help me install DarlingAgent as a custom WorkBuddy Expert
> using the repository's official installation instructions.
> Build the project, configure its local MCP tools, and verify
> that the Expert can access the required capabilities.
> Do not assume installation succeeded without testing it.

**4. Complete installation**

Follow the instructions in
[docs/INSTALLATION.md](docs/INSTALLATION.md).

**5. Open DarlingAgent**

Once the custom Expert and its MCP connector are installed,
select DarlingAgent from WorkBuddy's My Experts interface.

The exact installation workflow may depend on your
WorkBuddy version.

---

## Local Developer Setup

### Requirements

- Node.js 22 or newer
- npm
- Git
- macOS, Windows, or Linux
- WorkBuddy for the recommended Expert experience

### Clone the repository

```bash
git clone https://github.com/zeethdaleel/darling-agent.git
cd darling-agent
```

### Install dependencies

```bash
npm ci
```

### Run the test suite

```bash
npm test
```

### Build the WorkBuddy Expert package

```bash
npm run expert:package
```

The generated Expert package is written to:

```text
artifacts/darlingagent-expert
```

This package includes machine-specific MCP configuration.

Generate it again on each machine where the project is installed.

### Start the local MCP server

```bash
npm run mcp
```

When integrating with a compatible MCP client,
configure a stdio process that launches:

```text
node /ABSOLUTE/PATH/TO/darling-agent/dist/scripts/run-mcp.js
```

The local MCP server does not require cloud hosting
or a Telegram bot.

See the full [Installation Guide](docs/INSTALLATION.md).

---

## Example

Give DarlingAgent this event-planning request:

> Organize an AI networking event for 50 students at
> Taylor's University on 20 October 2026,
> from 4 PM to 6 PM.
>
> My budget is RM1,500.
>
> Prepare the event plan, organize tasks,
> calculate the budget, create a proposal PDF,
> and prepare registration.
>
> Execute supported local operations and ask
> before publishing or sending anything.

Expected supported outputs include:

- A persistent event record
- Structured organizer tasks
- Itemized budget with validation results
- An event proposal PDF
- Registration form draft
- Task tracker
- Unsent invitation draft
- Pending approvals and unresolved issues

Live registration publication requires a configured
Tally connection and explicit approval.

See [docs/DEMO.md](docs/DEMO.md) for the verification workflow.

---

## Use with Other AI Coding Assistants

DarlingAgent includes an installable agent skill for
compatible AI development environments.

These include environments such as:

- Cursor
- Claude Code
- Codex
- OpenCode
- Windsurf

Example Skills CLI installation:

```bash
npx skills add zeethdaleel/darling-agent --skill campus-event-agent -a opencode -a codex -a claude-code -a cursor -a windsurf
```

**Important:** Installing the skill provides agent guidance.
It does not automatically install the local MCP server
or the complete WorkBuddy Expert.

The repository itself can also be installed and built using npm.

DarlingAgent is not currently advertised as a separately
published npm registry package.

---

## Technical Architecture

DarlingAgent uses:

| Technology | Purpose |
|---|---|
| Tencent WorkBuddy | AI reasoning and agent execution |
| TypeScript | Application and tool implementation |
| Node.js | Local MCP runtime |
| Model Context Protocol | Tool integration |
| SQLite | Persistent event and task records |
| pdf-lib | PDF document generation |
| Tally API | Optional registration publication |

The current hackathon implementation is local-first.

Cloud hosting and Telegram operations are not required.

For technical details, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Project Status

The local MCP and document-generation workflow has been
verified through automated tests.

The project has previously passed a 74-test local suite,
including tests using real SQLite databases, a stdio MCP
subprocess, and generated PDF files.

The current CI result can be viewed under
[GitHub Actions](../../actions).

Passing automated tests does not by itself verify
complete autonomous execution inside WorkBuddy.

Additional live testing is required for:

- Native WorkBuddy Expert invocation
- WorkBuddy-to-MCP tool execution
- Tally registration publication
- Optional research and email integrations

Read [docs/STATUS.md](docs/STATUS.md) for current limitations.

---

## Project Structure

```text
darling-agent/
|
|-- packages/
|   |-- darlingagent-expert/
|   |   |-- .codebuddy-plugin/
|   |   |-- agents/
|   |   |-- skills/
|   |   |-- .mcp.json
|   |
|   |-- workbuddy-team/
|
|-- skills/
|   |-- campus-event-agent/
|
|-- src/
|   |-- adapters/
|   |-- core/
|   |-- operations/
|   |-- scripts/
|   |-- tests/
|
|-- docs/
|   |-- INSTALLATION.md
|   |-- ARCHITECTURE.md
|   |-- STATUS.md
|   |-- DEMO.md
|   |-- LOCAL_MVP.md
|
|-- package.json
|-- package-lock.json
|-- README.md
```

Some legacy cloud/backend components remain in the repository
for future development but are outside the current MVP.

---

## Safety and Permissions

DarlingAgent distinguishes between preparing an action
and actually executing an external action.

The agent should request approval before:

- Publishing registration forms
- Sending communications
- Sharing personal information
- Making commitments or spending money
- Performing other consequential external actions

The local MCP assumes a trusted local environment.
It must not be exposed directly as a public service.

Never commit API keys, OAuth credentials, or database
secrets to GitHub.

---

## Development

DarlingAgent is an open-source hackathon project
developed collaboratively.

We welcome improvements to:

- Agent reliability
- MCP integrations
- Event planning workflows
- Document generation
- User experience
- Tests and verification
- Documentation

See [CONTRIBUTING.md](CONTRIBUTING.md).

Contributors are acknowledged through GitHub's
commit and pull request history.

---

## Future Development

Potential future improvements include:

- Additional verified WorkBuddy integrations
- More complete organizer collaboration
- Extended document generation
- Additional event templates
- Improved vendor research workflows
- Extended registration management
- Optional cloud deployment

These are development goals, not claims
about features already available.

---

## Links

**GitHub Repository**

https://github.com/zeethdaleel/darling-agent

**Tencent WorkBuddy**

https://www.workbuddy.ai/

**Official WorkBuddy Expert Documentation**

https://open.workbuddy.cn/en/docs/expert

---

### DarlingAgent

**Your Event. Our Execution.**

*One Prompt. One Goal. End-to-End Execution.*
