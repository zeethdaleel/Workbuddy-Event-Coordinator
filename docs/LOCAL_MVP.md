# Local WorkBuddy MVP

The hackathon path is **WorkBuddy Expert → local stdio MCP → existing application services → SQLite and local files**. The hosted backend is preserved and is not started or required.

## Install and run

Follow [the Expert guide](../packages/darlingagent-expert/README.md). Build with Node 22+, run `npm ci`, `npm test`, and `npm run expert:package`. Install the generated package through WorkBuddy's built-in expert-manager and connect `darlingagent-local` from its generated `.mcp.json`. Summon DarlingAgent from My Experts.

The official installed expert-manager uses `$WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins/darlingagent` and requires its `validate_expert.py` and `register_expert.py` scripts. Do not hand-edit a guessed Expert registry. On the verified WorkBuddy AI installation the configuration directory is `~/.workbuddy-ai`; other products/builds may differ. Registration needs the native WorkBuddy session marker to appear under the correct user's My Experts. The repository package is a source/distribution copy; native installation copies it to the app's required location.

If using the vendor ZIP helper, check that `.mcp.json` is included: the installed helper omitted it during testing, so the delivered ZIP explicitly includes it. Generated connector paths are machine-specific and must be regenerated on another machine.

## Implemented tools

- Existing: structured event creation/retrieval, tasks/dependencies/transitions, budget validation, sourced facts, approvals, registration draft/create/get and Tally connectivity.
- Added: `event_list`, `task_update`, `proposal_save`, `proposal_get`, `document_generate`.
- `document_generate` returns an absolute PDF path, hash, page count, a JSON task tracker and an optional unsent invitation text file. It registers the PDF in the event's artifact metadata so later conversations can retrieve its path.
- Proposal content is validated and revision-checked. It includes objectives, agenda, proposed/accepted assignments, vendor source URLs, pending approvals, unresolved issues and an optional invitation draft.
- The PDF reuses the existing generator and includes the stored budget/tasks/facts, proposal sections and registration status. Existing operations backend callers continue to work.

## Evidence and limits

- Full suite: 74 tests pass, including all previous tests.
- Real stdio MCP subprocess, actual SQLite writes, two different event requests, dependency tasks, revision-conflict recovery, budget arithmetic, actual PDFs and unsent email files, and process-restart retrieval are tested without provider mocks.
- WorkBuddy's installed official Expert validator passed against the package in its required directory structure. All required manifest resources are present, including 512×512 avatar and local MCP declaration.
- Two retained test PDFs were rendered and visually inspected. These test fixtures are not a claim of autonomous WorkBuddy execution.
- Native WorkBuddy installation was initiated through My Experts → Create Expert. Its skill loader timed out; the installed official manager scripts were located. The installer subsequently wrote the package and marketplace entry and added `darlingagent-local` to the native MCP config, preserving `campus-event-agent`. The installed package passes the official validator. The Mac locked before the UI acceptance run could be completed. **Summonability and real WorkBuddy tool invocation are not yet verified.**
- Tally key is not configured. The user requested drafts first. No live registration form was published.
- WorkBuddy vendor browsing and email sending have not been exercised in the new Expert. Instructions use actual native tools when available, save sources, and keep unsupported work pending. No invented vendor data is supplied.
- No Telegram custom-Expert route has been verified. Use DarlingAgent directly in WorkBuddy. No new bot, hosting, OAuth system, or background worker was added.

## Approval boundary

The local connector trusts the signed-in OS user and WorkBuddy conversation. The agent must show the exact registration draft and wait for an explicit human reply before `confirmed:true`. A tool argument is not independent cryptographic proof of a human decision; do not expose this local interface as a public API. Email requires separate explicit approval through the native connector. The existing stronger Telegram approval backend remains preserved for future work.

## Acceptance run

1. Summon the saved Expert, enter the networking prompt from the guide once, and observe multiple actual MCP calls.
2. Check event and task IDs, budget validation, actual PDF/tracker/invitation paths and draft registration fields.
3. In a follow-up ask it to retrieve the same event. It must query persisted state.
4. Run a different event request and compare budgets, tasks and PDF content.
5. With a privately configured Tally key and explicit draft approval, publish and retrieve the real form; regenerate the PDF with its link. This step is pending until credentials and approval exist.
6. For vendors, inspect WorkBuddy's real search/fetch results and stored source URLs. For email, approve exact content only when a supported native connector is connected.

The final hackathon acceptance test remains incomplete until the native Expert invocation is verified and the separately authorized live Tally step is performed.
