# DarlingAgent — Hackathon Demonstration

## Objective

Demonstrate that DarlingAgent is more than
a conversational event-planning chatbot.

The demonstration should show WorkBuddy
interpreting an event request and invoking
real tools to create persistent, verifiable outputs.

## Prerequisites

- DarlingAgent repository cloned
- Node.js 22+
- Dependencies installed
- WorkBuddy Expert package generated
- DarlingAgent Expert installed in WorkBuddy
- Local MCP connector working
- Access to generated files

Optional:

- Tally API key
- Supported WorkBuddy research tools
- Supported email connector

## Pre-Demo Checks

Run:

```bash
npm ci
npm test
npm run expert:package
```

Verify:

- The build succeeds.
- The Expert package exists.
- WorkBuddy can discover its MCP tools.
- SQLite storage is writable.
- Generated files can be opened.

## Main Demonstration Prompt

Open DarlingAgent inside WorkBuddy.

Enter:

> Organize an AI networking event for
> 50 students at Taylor's University
> on 20 October 2026, from 4 PM to 6 PM.
>
> The budget is RM1,500.
>
> Create the event workspace, plan the event,
> organize tasks, calculate and validate the budget,
> draft registration, and generate a professional
> event proposal PDF.
>
> Use available MCP tools to execute the work.
> Ask before publishing anything externally.
> Show completed results, file paths, and
> unresolved actions.

## Expected Execution

### 1. Understand the Request

Extract:

- Event type
- Attendance
- Budget
- Currency
- Date and time
- Location
- Requested deliverables

Unknown facts must be identified.

### 2. Create Event Record

Create a persistent event through the MCP server.

Record the real event ID.

### 3. Create Tasks

Create tasks and dependencies.

Verify they are stored and retrievable.

### 4. Validate Budget

Create an itemized budget.

Run the deterministic budget validation tool.

Confirm totals and remaining budget.

Clearly identify estimated costs.

### 5. Generate Documents

Save the event proposal.

Generate a real PDF.

Verify:

- The file exists.
- The file opens.
- Event facts are correct.
- Budget figures match.
- Relevant tasks are included.

Retrieve the generated task tracker
and invitation draft if produced.

### 6. Prepare Registration

Generate a registration specification.

Show the draft fields.

Do not publish without explicit approval.

If Tally is not connected, clearly report
the form as a draft.

## Persistence Test

Start a follow-up interaction.

Ask:

> Retrieve the event we just created.
> Show the saved budget, tasks,
> registration status, and proposal.

Verify that DarlingAgent retrieves the
previously saved event rather than recreating
a sample response.

## Second Scenario

Enter:

> Organize a robotics competition for
> 120 students with a budget of RM5,000.
>
> Create a new event record, budget,
> task plan, and proposal PDF.

Verify that:

- The event ID differs.
- Attendance differs.
- Budget differs.
- Task and proposal content reflect the new event.
- The first event remains accessible.

## Optional Live Tally Test

Only if a valid Tally API key is configured:

1. Prepare the draft.
2. Review the exact registration fields.
3. Approve publication explicitly.
4. Invoke the registration creation tool.
5. Retrieve the published form.
6. Open its URL.
7. Submit a test registration if appropriate.

Record actual provider evidence.

Do not substitute mocked test results.

## Optional Research and Communication

If WorkBuddy has relevant research tools:

- Find real vendors.
- Record source URLs.
- Do not invent prices or availability.

If a supported email connector is connected:

- Prepare exact recipient and message details.
- Obtain approval.
- Send only if supported and authorized.
- Verify the provider response.

Otherwise, save the invitation as an unsent draft.

## Evidence Checklist

| Evidence | Required |
|---|---|
| WorkBuddy Expert visible | Yes |
| Real MCP tool calls | Yes |
| Persistent event ID | Yes |
| Saved tasks | Yes |
| Budget validation | Yes |
| Actual PDF | Yes |
| Event retrieval | Yes |
| Second distinct event | Yes |
| Live Tally link | Optional, only if verified |
| Research sources | Optional, only if verified |
| Approved email send | Optional, only if verified |

## Demonstration Rules

Never claim an action succeeded unless
there is evidence that it happened.

Clearly distinguish:

- Completed
- Draft
- Waiting for approval
- Requires configuration
- Unsupported
- Failed

The strongest demonstration is a short,
repeatable workflow with real tool outputs.

## Current Verification Record

See:

[LOCAL_MVP.md](LOCAL_MVP.md)

This document describes previous automated tests,
package validation, and outstanding live checks.

## Final Demo Goal

A judge gives DarlingAgent one event objective.

WorkBuddy interprets it, invokes real tools,
creates documents and persistent records,
and reports verifiable results.

**One Prompt. One Goal. End-to-End Execution.**
