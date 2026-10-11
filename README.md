<div align="center">

# DarlingAgent

### Your Event. Our Execution.

**One Prompt. One Goal. End-to-End Execution.**

An autonomous AI event operations agent built for Tencent WorkBuddy.

Transform a simple event-planning request into structured tasks,
validated budgets, real documents, and actionable workflows.

<br/>

### [🌐 Visit Website](https://darlingagentweb-darlingagent.vercel.app) · [🚀 Get Started](https://darlingagentweb-darlingagent.vercel.app) · [💻 View Source](https://github.com/zeethdaleel/darling-agent)

<br/>

**Best experienced in Tencent WorkBuddy.**

[WorkBuddy](https://www.workbuddy.ai/) ·
[Installation](docs/LOCAL_MVP.md) ·
[Project Status](docs/STATUS.md) ·
[Report an Issue](https://github.com/zeethdaleel/darling-agent/issues)

</div>

---

## Meet DarlingAgent

Event planning shouldn't require endless spreadsheets,
disconnected tools, and repetitive coordination.

**DarlingAgent is designed to turn intentions into execution.**

Built around Tencent WorkBuddy, it combines AI-driven
planning with persistent MCP tools to help organizers
prepare, coordinate, and validate event operations.

Instead of only generating suggestions, DarlingAgent
can execute supported tasks, save real records,
generate documents, and report verifiable results.

### Explore the full experience

**[Visit the Official DarlingAgent Website →](https://darlingagentweb-darlingagent.vercel.app)**

Discover the product, explore its capabilities,
and learn how to get started.

---

## What Can DarlingAgent Do?

| Capability | Description |
|---|---|
| **Event Planning** | Structure event objectives, requirements, and plans |
| **Task Management** | Create persistent tasks with dependencies and statuses |
| **Budget Validation** | Calculate event costs and validate budgets |
| **PDF Generation** | Generate actual event proposal documents |
| **Registration** | Prepare registration drafts and support approved Tally publication |
| **Event Persistence** | Save and retrieve event information across sessions |
| **Document Preparation** | Generate task trackers and invitation drafts |
| **WorkBuddy Integration** | Use a custom Expert and MCP tools for local execution |

Additional capabilities depend on the research,
communication, and service connectors available
in the user's WorkBuddy environment.

Some integrations require configuration and
explicit human approval.

---

## How DarlingAgent Works

```text
         YOUR EVENT IDEA
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
           Plan the work
                |
                v
          EXECUTE MCP TOOLS
                |
       +--------+--------+
       |        |        |
       v        v        v
     Tasks    Budget   Documents
       |        |        |
       +--------+--------+
                |
                v
          VERIFY RESULTS
                |
                v
         REAL DELIVERABLES
```

**WorkBuddy provides AI reasoning and tool selection.**

**DarlingAgent's MCP server provides persistent
operations, deterministic checks, and local documents.**

This separation helps distinguish real execution
from conversational output.

---

## Get Started

### Option 1 — Tencent WorkBuddy (Recommended)

DarlingAgent is designed primarily for WorkBuddy.

**Step 1:** Download and open
[Tencent WorkBuddy](https://www.workbuddy.ai/).

**Step 2:** Sign in to your account.

**Step 3:** Open the official DarlingAgent repository:

https://github.com/zeethdaleel/darling-agent

**Step 4:** Ask WorkBuddy to help install the agent:

> Inspect the DarlingAgent GitHub repository.
> Help me install it as a custom WorkBuddy Expert.
> Follow the project's installation instructions,
> build the required dependencies, configure its
> local MCP tools, and verify that it can execute
> event-planning operations.

**Step 5:** Complete the required Expert and MCP
configuration in WorkBuddy.

**Step 6:** Open your configured DarlingAgent Expert
and give it an event-planning objective.

> Note: Sharing the repository URL is an assisted
> setup method, not a verified one-click installation.
> Follow the repository's Expert installation guide.

**[Get Started on the Website →](https://darlingagentweb-darlingagent.vercel.app)**

### Option 2 — Local Installation

For developers who prefer manual setup.

**Requirements:**

- Node.js 22 or newer
- npm
- Git
- A compatible MCP client

Clone the official repository:

```bash
git clone https://github.com/zeethdaleel/darling-agent.git
cd darling-agent
```

Install dependencies:

```bash
npm ci
```

Run tests:

```bash
npm test
```

Build the WorkBuddy Expert package:

```bash
npm run expert:package
```

The generated Expert package will be available at:

```text
artifacts/darlingagent-expert
```

Import this package using WorkBuddy's supported
Expert installation workflow.

If necessary, configure the local MCP connector
using the generated `.mcp.json`.

The MCP server entry point is:

```text
dist/scripts/run-mcp.js
```

Additional installation information is available in:

[WorkBuddy Expert Setup](packages/darlingagent-expert/README.md)

[Local MVP Documentation](docs/LOCAL_MVP.md)

---

## Compatible AI Development Environments

DarlingAgent also includes a reusable agent skill
that can be installed in compatible coding assistants.

Supported installation targets include:

- Cursor
- Claude Code
- Codex
- OpenCode
- Windsurf

List the available repository skills:

```bash
npx skills add zeethdaleel/darling-agent --list
```

Install the event coordination skill:

```bash
npx skills add zeethdaleel/darling-agent --skill campus-event-agent -a opencode -a codex -a claude-code -a cursor -a windsurf
```

Optional global skill installation:

```bash
npx skills add zeethdaleel/darling-agent --skill campus-event-agent -g -a opencode -a codex -a claude-code -a cursor -a windsurf
```

**Important:** Installing the skill does not
automatically configure the MCP server or install
the complete WorkBuddy Expert.

DarlingAgent is currently distributed through
its GitHub repository rather than as a standalone
npm registry package.

---

## Try DarlingAgent

Once the Expert is installed in WorkBuddy, try:

> Organize an AI networking event for 50 students
> at Taylor's University on 20 October 2026.
>
> Budget: RM1,500.
>
> Prepare an event plan, organize tasks, validate
> the budget, draft registration, and generate a
> professional proposal PDF.
>
> Execute supported local operations and show
> the actual results.
>
> Ask for approval before publishing or sending
> anything externally.

With the correct MCP configuration, the local
workflow supports generating and storing:

- Event records
- Structured tasks
- Budget calculations
- Event proposal PDFs
- Registration drafts
- Task trackers
- Unsent invitation drafts

External publication requires the appropriate
service connection and explicit approval.

**[Learn More on the Website →](https://darlingagentweb-darlingagent.vercel.app)**

---

## Built With

| Technology | Purpose |
|---|---|
| **Tencent WorkBuddy** | Primary AI execution environment |
| **TypeScript** | Application implementation |
| **Node.js** | Local runtime |
| **MCP** | Tool integration |
| **SQLite** | Persistent event records |
| **pdf-lib** | PDF document generation |
| **Tally API** | Optional registration publication |

The current MVP is designed for local execution.

No VPS, Telegram bot, or 24/7 cloud server
is required for the recommended workflow.

---

## Project Status

DarlingAgent is an actively developed
hackathon MVP.

The local implementation has passed
74 automated tests covering application behavior,
persistent storage, tool execution, and generated files.

The custom WorkBuddy Expert package has also
passed schema validation.

**However, a complete live WorkBuddy Expert
acceptance run remains to be verified.**

Tally publication and optional external
integrations require separate live testing.

The project should not yet be considered
production-ready.

For detailed verification information, see:

[Project Status](docs/STATUS.md)

[Local MVP Verification](docs/LOCAL_MVP.md)

[GitHub Actions](https://github.com/zeethdaleel/darling-agent/actions)

---

## Documentation

For product information, features, and the
recommended getting-started experience:

### [Visit darlingagent.vercel.app →](https://darlingagent.vercel.app)

For technical documentation:

| Resource | Description |
|---|---|
| [Expert Installation](packages/darlingagent-expert/README.md) | WorkBuddy Expert setup |
| [Local MVP](docs/LOCAL_MVP.md) | Technical setup and verification |
| [Project Status](docs/STATUS.md) | Current capabilities and limitations |
| [Demo Guide](docs/DEMO.md) | Test and demonstration procedures |
| [Operations Protocol](docs/OPERATIONS.md) | Advanced/legacy operations interface |
| [Deployment Guide](docs/DEPLOYMENT.md) | Optional hosted backend architecture |

The legacy Telegram/cloud functionality remains
in the codebase but is not part of the active
local-first MVP.

---

## Open Source & Contributions

DarlingAgent is developed collaboratively.

Contributions, bug reports, and improvements
are welcome.

For issues and suggestions:

[Open a GitHub Issue](https://github.com/zeethdaleel/darling-agent/issues)

For code changes:

[Explore the Repository](https://github.com/zeethdaleel/darling-agent)

Please run the test suite before submitting
changes and never commit secrets or personal data.

---

## What's Next?

We're working toward a more complete
autonomous event operations experience.

Future development may include:

- More verified WorkBuddy integrations
- Expanded event coordination workflows
- Additional document formats
- Improved research capabilities
- Extended registration management
- Stronger team collaboration

These are development goals and not
claims of implemented functionality.

---

<div align="center">

### Less planning. More happening.

**Your Event. Our Execution.**

<br/>

### [Explore DarlingAgent ↗](https://darlingagent.vercel.app)

[Website](https://darlingagentweb-darlingagent.vercel.app) ·
[WorkBuddy](https://www.workbuddy.ai/) ·
[GitHub](https://github.com/zeethdaleel/darling-agent)

<br/>

**DarlingAgent © 2026**

</div>
