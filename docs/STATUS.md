# Current hackathon priority

The local-first Expert implementation and its verification limits are tracked in [LOCAL_MVP.md](LOCAL_MVP.md). The ledger below describes the preserved hosted operations increment. Cloud/Telegram/OAuth work is paused by user direction.

# Capability and verification ledger

This is a tested implementation increment, **not completion of the full 2.0 specification**. No cloud deployment, live external send/publication, native WorkBuddy run or laptop-off demonstration has been performed.

| Capability | Implementation | Verification / limits |
|---|---|---|
| Existing event/task/fact persistence and local MCP | IMPLEMENTED | Existing baseline 46 automated tests passed |
| WorkBuddy structured event facts, budget and assumptions | IMPLEMENTED | Local schema, arithmetic, different-event and persistence tests |
| Natural-language intelligence | NEEDS_CONFIGURATION | WorkBuddy desktop remains responsible; native routing not live verified |
| Legacy title/attendance budget fallback | IMPLEMENTED | No fixed title; scaled illustrative costs clearly labeled, not autonomous planning |
| Authenticated owner-scoped operations MCP/HTTP | IMPLEMENTED | HTTP auth, private Telegram identity, cross-user rejection and idempotency tested |
| Task creation, dependencies, start, result submission and verified completion | IMPLEMENTED | Local SQLite checks; declared budget/document/action output contracts gate completion; agent text cannot prove external completion |
| Task/team metadata and participation | IMPLEMENTED | Identity-bound invitations, recipient acceptance/decline, assignments, deadlines, priorities, notes, document references, cancellation/reopen and revision checks tested locally |
| Full team/group operations | NOT_IMPLEMENTED | Group roles, member removal, manual completion confirmation and assignment/deadline notifications remain |
| Proposal PDF and document versions | IMPLEMENTED | Real PDF parsing, multipage, hash/tamper/access tests; two offline sample PDFs rendered and inspected |
| Telegram messages and file upload | TESTED_WITH_MOCKS | Matching chat/message/file acknowledgments validated; no live delivery |
| Reminder worker | IMPLEMENTED | Atomic claims, restart uncertainty, recurrence/DST, rate-limit retry, cancellation tested |
| Cloud reminders with laptop off | BLOCKED | Host not selected/provisioned; no deployed bot credentials |
| Progress-report reminders | IMPLEMENTED | Uses persisted task statuses; no LLM required |
| Monthly/hourly/event-relative recurrence and alerts | NOT_IMPLEMENTED | Supported subset: once/daily/weekly and pending-task report |
| Darling Connect secure state, browser cookie, PKCE and AES-GCM | IMPLEMENTED | State expiry/replay, owner isolation, encryption and mocked PKCE/identity/scope tests; Google live consent not verified |
| Google OAuth refresh/scope/account verification | NEEDS_CONFIGURATION | Maintained Google library integration; no real Google project/account supplied |
| Approved Gmail send with PDF attachments | TESTED_WITH_MOCKS | Exact preview, owner/hash/expiry gate, one-time send, stored message ID |
| Gmail mailbox reading and provider draft-folder creation | NOT_IMPLEMENTED | Local durable email drafts only; minimal send scope |
| Tally create/get and encrypted onboarding | TESTED_WITH_MOCKS | Existing mocked API tests plus concurrency/restart reservations; no live key/form |
| Tally deadline enforcement and analytics/export | NOT_IMPLEMENTED | Deadline is stored but not enforced; preview explicitly discloses it |
| Calendar create and private Drive PDF upload | IMPLEMENTED | Mocked request/acknowledgment tests; live verification pending; update/delete/folders not implemented |
| Vendor research | NOT_IMPLEMENTED | WorkBuddy browsing/source collection workflow still needs tooling and persistence integration |
| Content-bound Telegram approvals | IMPLEMENTED | Owner, exact hash, expiry and duplicate execution tests |
| Pending connection resumption | IMPLEMENTED | Draft retained; /review after connecting; no automatic send on connection |
| Native WorkBuddy team import | BLOCKED | Prior manifest absent; installed client/account validation still required |
| WorkBuddy cloud execution API | BLOCKED | No officially supported account-specific path verified; no fabricated endpoint |
| Docker deployment | NEEDS_CONFIGURATION | Recipe supplied; Docker daemon unavailable so image not built |
| DOCX/XLSX/CSV/ZIP and 15 distinct PDF templates | NOT_IMPLEMENTED | Current document scope is proposal containing budget/tasks/facts |
| QR check-in/sponsorship/post-event advanced features | NOT_IMPLEMENTED | Phase 7 scope remains |

## Security boundary and known risks

- Deploy the **operations** interface, not the old trusted-local MCP, for Telegram-backed actions. Legacy approval records are not an identity proof.
- Backend token is bound to one configured organizer. Group and multi-coordinator authorization are outside this increment.
- Telegram has no send idempotency key. A response lost after acceptance is held for review, not retried automatically. A crash after claiming an action leaves `RUNNING`; treat it as uncertain and reconcile externally. There is no unsafe automatic reset.
- Document delivery has no automatic retry. Check the audit log and Telegram chat before repeating it after ambiguity.
- Built-in PDF fonts cover Latin characters. Unsupported glyphs fail explicitly; embedded multilingual fonts are future work.
- Event changes cancel pending approvals and identify stale artifacts, but do not silently republish forms, reschedule event-relative jobs or change external calendars.
- No service should be described as continuously monitoring until deployed and its job actually scheduled.
- OAuth provider reviews, live account permissions and hackathon eligibility must be validated by the operator. This code was developed with Codex.

## Test commands

`npm ci && npm test` covers the legacy and new suites. `node dist/scripts/demo-operations.js artifacts/operations` creates two local real PDFs with verification JSON; it throws if anything tries to contact a provider. These are offline scenarios, not a live WorkBuddy demonstration.
