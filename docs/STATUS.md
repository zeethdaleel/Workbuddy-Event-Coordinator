# DarlingAgent — Project Status

Last reviewed: 11 October 2026

## Current Focus

DarlingAgent is currently focused on a local-first
autonomous event operations MVP for Tencent WorkBuddy.

The goal is to demonstrate:

**One Prompt → Tool Execution → Verified Deliverables**

Telegram integration and 24/7 cloud deployment are
not part of the active hackathon MVP.

## Implementation Status

| Capability | Status | Evidence or limitation |
|---|---|---|
| Local MCP server | Implemented | Tested through real stdio subprocess |
| SQLite event persistence | Implemented | Tested across process restart |
| Structured event creation | Implemented | Tested with different event inputs |
| Task creation and dependencies | Implemented | Automated tests |
| Task metadata updates | Implemented | Revision checks tested |
| Budget validation | Implemented | Deterministic calculations tested |
| Registration drafting | Implemented | Local tests |
| Proposal persistence | Implemented | Revision-checked local workflow |
| PDF generation | Implemented | Actual generated PDFs verified |
| Task tracker output | Implemented | Local output tests |
| Invitation draft output | Implemented | Saved as unsent draft |
| WorkBuddy Expert package | Implemented | Package schema validated |
| Native WorkBuddy execution | Pending live verification | Complete UI tool-use run not recorded |
| Live Tally publication in current MVP | Pending live verification | Requires API key and approval |
| Source-linked vendor research | Conditional | Requires actual WorkBuddy research tools |
| Email sending | Conditional | Requires available connector and approval |
| Telegram bot integration | Paused | Not required for local MVP |
| 24/7 reminders | Paused | Cloud infrastructure not deployed |
| Multi-user collaboration | Incomplete | Full team workflows not available |
| Production deployment | Not verified | MVP is local-first |

## Automated Verification

The implementation has previously passed
a local suite of 74 automated tests.

Covered areas include:

- Event persistence
- Task dependencies
- Budget calculations
- SQLite state
- Real MCP subprocess communication
- PDF generation
- Process-restart retrieval
- Registration safeguards

Automated test success does not prove that
the complete AI-driven WorkBuddy workflow
has executed successfully in the UI.

For current CI results, visit:

https://github.com/zeethdaleel/darling-agent/actions

## Outstanding Acceptance Tests

Before describing the MVP as fully demonstrated:

1. Open DarlingAgent from WorkBuddy's My Experts.
2. Confirm the Expert instructions load.
3. Confirm the local MCP connector is available.
4. Execute a complete event-planning request.
5. Record the actual MCP tool calls.
6. Open the generated proposal PDF.
7. Retrieve the same event in a follow-up.
8. Test a second event with different requirements.
9. Verify Tally publication separately if configured.

## Known Limitations

- Budgets can contain illustrative estimates.
- Estimates are not verified supplier quotations.
- Venue availability is not automatically confirmed.
- Registration deadlines are not automatically enforced.
- Publishing and sending require explicit authorization.
- Research requires actual available browsing tools.
- The local MCP server is not a public authentication service.
- Telegram and hosted workflows are not active MVP interfaces.
- Advanced team operations and document formats remain future work.

## Project Direction

Current:

**WorkBuddy Expert + Local MCP + Persistent SQLite + Real Documents**

Possible future work:

- Additional native integrations
- Extended registration capabilities
- More document formats
- Stronger collaboration features
- Optional cloud deployment
- Background automation

Future work should not be represented as available functionality.

## Documentation

[Installation](INSTALLATION.md)

[Architecture](ARCHITECTURE.md)

[Demo and Verification](DEMO.md)

[Local MVP Technical Record](LOCAL_MVP.md)

[Original Operations Protocol](OPERATIONS.md)
