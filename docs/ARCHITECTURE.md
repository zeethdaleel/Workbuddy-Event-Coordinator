# DarlingAgent Architecture

## Overview

DarlingAgent is a local-first AI event operations system
designed to operate through Tencent WorkBuddy.

It separates AI reasoning from deterministic execution.

WorkBuddy handles interpretation, planning, and tool selection.

The DarlingAgent MCP server handles application operations,
persistent records, validations, and local document generation.

## System Architecture

```text
+--------------------------------------+
|             EVENT ORGANIZER          |
+--------------------------------------+
                   |
                   v
+--------------------------------------+
|          TENCENT WORKBUDDY           |
|                                      |
|       Custom DarlingAgent Expert     |
|       Event execution skill          |
|       AI planning and decisions      |
+--------------------------------------+
                   |
                   v
+--------------------------------------+
|          LOCAL MCP SERVER            |
|                                      |
|       Structured event tools         |
|       Task operations                |
|       Budget validation              |
|       Registration workflows         |
|       Document generation            |
+--------------------------------------+
                   |
         +---------+---------+
         |                   |
         v                   v
+----------------+  +-------------------+
| SQLITE STORAGE |  | LOCAL DELIVERABLES|
|                |  |                   |
| Event records  |  | Proposal PDFs     |
| Tasks          |  | Task trackers     |
| Facts          |  | Invitation drafts |
| Approvals      |  |                   |
+----------------+  +-------------------+
         |
         v
+--------------------------------------+
|      OPTIONAL EXTERNAL SERVICES      |
|                                      |
|       Tally registration API         |
|       Supported native connectors    |
+--------------------------------------+
```

## Components

### WorkBuddy Expert

Located in:

```text
packages/darlingagent-expert/
```

Contains the Expert's instructions, manifest,
skills, avatar, and MCP dependency declaration.

The Expert is responsible for interpreting the
user's event-planning goal and selecting appropriate
tools available in the WorkBuddy environment.

### MCP Server

Located in:

```text
src/adapters/mcp/
```

Provides structured operations that can be invoked
by compatible MCP clients.

The production of structured outputs is separated
from conversational descriptions.

### Application Core

Located in:

```text
src/core/
```

Contains event, task, budget, registration,
and proposal-related application logic.

### SQLite Persistence

Located in:

```text
src/adapters/sqlite/
```

Stores event records and related information
across supported sessions and process restarts.

### PDF Generation

Generates real proposal documents from
saved event information.

Document generation returns file information
and verification metadata.

### Tally Integration

Located in:

```text
src/adapters/tally/
```

Supports registration operations when
the required API credentials are configured.

Publication requires explicit user confirmation.

## Execution Lifecycle

A typical event request follows this sequence:

1. Receive the user's objective in WorkBuddy.
2. Extract confirmed event facts and constraints.
3. Identify missing information and assumptions.
4. Create or retrieve the event record.
5. Create structured tasks and dependencies.
6. Prepare an event-specific itemized budget.
7. Validate budget calculations.
8. Create planning and proposal content.
9. Generate a real PDF and related files.
10. Prepare registration as a draft.
11. Request approval before external publication.
12. Retrieve saved state and report actual results.

The agent should report unavailable or failed
operations rather than pretending they succeeded.

## Approval Boundaries

Local operations can prepare plans, budgets,
tasks, and documents.

Consequential external operations require
explicit user approval.

The local MCP interface assumes a trusted local
WorkBuddy environment and is not an authenticated
public multi-user API.

Do not expose the local MCP server directly
to untrusted networks.

## Legacy Architecture

The repository also contains earlier development
for an HTTPS operations backend, Telegram messaging,
OAuth onboarding, and a durable reminder worker.

These components are preserved as experimental
or future-development work.

They are not required for the current hackathon MVP
and are not part of its recommended execution path.

## Verification

The repository includes automated tests covering
persistent storage, tool operations, task dependencies,
budget validation, and document generation.

Live WorkBuddy execution and external service behavior
require separate acceptance testing.

See [STATUS.md](STATUS.md) and [DEMO.md](DEMO.md).
