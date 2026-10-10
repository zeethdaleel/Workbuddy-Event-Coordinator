# Repeatable verification scenarios

## Offline artifact verification

```bash
npm ci
npm test
node dist/scripts/demo-operations.js artifacts/operations
```

This creates two actual proposal PDFs and `verification.json` for:

1. AI networking, 50 attendees, MYR1,500 ceiling, MYR1,250 illustrative costs.
2. Robotics competition, 120 attendees, MYR5,000 ceiling, MYR4,500 illustrative costs.

Both use temporary real SQLite databases, event-specific supplied structured plans and real PDF generation. The script deletes its temporary database after exporting the evidence. No WorkBuddy interpretation, vendor research, form publication or delivery occurs. Automated tests also deliberately use an over-budget ceiling, missing permissions, duplicate messages, uncertain network outcomes, competing workers and DST transitions.

## Required live demonstration (pending)

Prerequisites: follow DEPLOYMENT.md; connect the operations MCP in WorkBuddy; start the bot; connect only the services you intend to test. Obtain approval in Telegram before each publication/send. Use your own test recipient.

Paste the user's requested AI networking prompt into WorkBuddy. Ask the coordinator to use actual `darling_operations` tools and expose tool results:

> Organize an AI networking event for 50 students at Taylor's University on 20 October 2026 from 4 PM to 6 PM, Asia/Kuala_Lumpur, with MYR1,500. Create the event workspace, prepare a plan and budget, prepare registration and an invitation, generate a proposal PDF, create organizer tasks and remind me tomorrow at 9 AM to review remaining work. Complete everything safely supported. Ask for approval before publishing or sending. Label vendor research unsupported unless your real browsing tools find and cite sources.

1. Persist structured facts and budget; record the returned event ID. Inspect it through a new session.
2. Create dependent tasks. Try starting a task before its prerequisite completes and confirm rejection. Declare budget/document/action output contracts at task creation, then complete them using the corresponding verified output. Arbitrary agent text cannot complete them.
3. Generate the PDF and deliver it through Telegram. Open the attachment and verify title, date, amounts, assumptions and tasks.
4. Prepare Tally registration. Review fields, capacity and the disclosed deadline limitation; approve only if acceptable. Open the actual returned URL and submit a test registration. Record the provider ID and retrieval evidence.
5. Prepare the exact invitation to your own test address. Connect Gmail if needed, `/review` the stored action and approve. Confirm the stored Gmail message ID. Gmail acceptance does not prove inbox arrival; inspect the test inbox separately.
6. Schedule a near-term one-time reminder and a daily pending-task report. Perform the laptop-off test in DEPLOYMENT.md. Record Telegram acknowledgment IDs.
7. Repeat with a robotics competition for 120 students and MYR5,000 to demonstrate differing stored facts and budgets.
8. Report each artifact/action as complete, failed, uncertain, waiting for connection/approval or unsupported. Preserve real evidence; never substitute test fixture IDs.

Remaining gaps prevent claiming the complete 20-item live acceptance scenario: WorkBuddy routing/import and cloud hosting need live setup; vendor research, complete team operations, registration deadlines and some requested outputs remain unimplemented. See STATUS.md for the explicit ledger.
