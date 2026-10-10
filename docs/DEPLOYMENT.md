# Deployment and connection setup

Status: local build/tests verified; **not deployed, not production ready**. Docker daemon was unavailable during implementation, so the container recipe is not build-verified. Choose an always-on Linux VM/container host with a persistent local disk, HTTPS reverse proxy and restart supervision. Do not use ephemeral/serverless storage or ordinary WordPress shared hosting. This SQLite design is for one host; do not mount its database on network filesystems or scale across hosts.

## Processes

1. HTTP backend: Telegram webhook, private account connection pages, Google callback and authenticated WorkBuddy operations.
2. Reminder worker: runs continuously and reads the same persistent database.
3. WorkBuddy desktop: intelligent planning and MCP tool execution. It must be running for AI work; the worker does not depend on it after a reminder has been stored.

## Local build (no external actions)

```bash
git clone https://github.com/faizanburgi/DarlingAgent.git
cd DarlingAgent
git switch feat/darlingagent-operations
npm ci
npm test
npm run build
node dist/scripts/demo-operations.js artifacts/operations
```

Node.js 22 or newer is required. `npm ci` builds the project via the existing prepare hook. Native SQLite builds may require Python, make and a C++ compiler if a prebuilt binary is unavailable. npm is the supported lockfile workflow for this branch; the old pnpm lock was replaced to avoid conflicting dependency resolutions.

## Configure privately

Copy `.env.example` to `.env`, fill values in a secret editor, and keep it outside Git. Do not paste keys into Telegram or issue/PR comments. Generate independent random values for `TELEGRAM_WEBHOOK_SECRET` and `DARLING_AGENT_TOKEN`, and 32 random bytes encoded as hex for `CREDENTIAL_ENCRYPTION_KEY`. Back up the encryption key separately from the database; losing it makes connections unreadable.

`DARLING_AGENT_OWNER` is the numeric ID of the organizer's Telegram user. Only that owner is accessible to the configured WorkBuddy token. The user must first `/start` the operations bot to establish verified private-chat reachability.

```bash
node --env-file=.env dist/scripts/migrate.js
node --env-file=.env dist/scripts/run-server.js
# In a second supervised process:
node --env-file=.env dist/scripts/run-worker.js
```

`npm start` and `npm run worker` assume the process manager injects environment variables. Node's `--env-file` commands above load them explicitly. Use absolute persistent `DARLING_DATA_DIR` in deployment.

## Docker option (operator runs after selecting hosting)

```bash
docker compose build
docker compose up -d
# View state without printing environment values:
docker compose ps
docker compose logs --tail=100 backend worker
```

Both services mount the named `darling-data` volume. Keep the backend bound to localhost behind your HTTPS reverse proxy. Do not run `docker compose down -v` unless intentionally deleting all event data. Docker must be running. This repository does not buy hosting, configure DNS, provision certificates or deploy automatically.

Configure HTTPS on your domain with a maintained reverse proxy. Forward `/telegram/webhook`, `/connect/*`, `/oauth/callback`, `/health` and `/agent` to port 3000; use request limits and rate limits at the edge as well. Never log query strings for account-connection routes or request bodies containing credentials. Back up SQLite using the SQLite backup API (or stop both services before copying the database and WAL files) and include the documents directory. Test restores before relying on the system.

## Telegram

Create an **operations bot** in BotFather. If you also use WorkBuddy's native Telegram Assistant, use a **different bot token**. A bot cannot have two competing webhook/polling consumers.

The operations bot supports private chats only. Commands: `/start`, `/help`, `/events`, `/use EVENT_ID`, `/status`, `/pdf`, `/connections`, `/connect PROVIDER`, `/reconnect PROVIDER`, `/disconnect PROVIDER`, `/pending`, `/review ACTION_ID`, `/reminders`, `/cancel REMINDER_ID`, `/snooze REMINDER_ID ISO_TIMESTAMP`. Providers: gmail, calendar, drive, tally.

Set the webhook after HTTPS is reachable. The following reads secrets from the environment and prints only success, not the token-bearing URL:

```bash
node --env-file=.env --input-type=module <<'JS'
const result = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: 'POST',
  headers: {'Content-Type':'application/json'},
  body: JSON.stringify({
    url: `${process.env.PUBLIC_BASE_URL}/telegram/webhook`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message','callback_query']
  })
});
const response = await result.json();
if (!result.ok || response.ok !== true) throw new Error('Webhook registration failed');
console.log('Webhook registration acknowledged');
JS
```

This command contacts Telegram: run it only for your intended deployment. Test `/start` and `/connections`. User input is stored in a durable inbox. It is **not automatically sent to an invented WorkBuddy cloud API**. In WorkBuddy, ask the configured coordinator to consume `inbox_list`. After initial interactive verification, you can configure a native WorkBuddy Automation to check the inbox while the desktop is running. That automation is not installed by this repository.

## Google OAuth (operator setup once)

1. Create a Google Cloud project and enable Gmail, Calendar and Drive APIs as needed.
2. Configure OAuth consent, authorized audience/test users and required permissions. Production use may require Google verification; confirm with Google's console.
3. Create a Web application OAuth client, with exact redirect URI `https://YOUR_DOMAIN/oauth/callback`.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the backend/worker. Ordinary users connect using Telegram buttons, without developer credentials.
5. `/connect gmail`, `/connect calendar` and `/connect drive` use separate minimum capability scopes plus OpenID/email to verify the account. The app uses the maintained Google OAuth library, PKCE, one-use state, a short-lived secure browser cookie and encrypted token storage.
6. Return to Telegram `/pending` and `/review ACTION_ID`. Connecting never approves sending.

Gmail requests `gmail.send` only; no inbox reading. Calendar requests `calendar.events`; no general calendar administration. Drive requests `drive.file`; uploads are private. Tokens refresh before an action; missing scopes/expired access require reconnect. Disconnect deletes local credentials and attempts Google revocation. Google may revoke related grants for the same OAuth client; reconnect other affected services as needed.

## Tally

Use [Tally's official API documentation](https://developers.tally.so/) to create an API key in your Tally account. `/connect tally` opens a short-lived HTTPS password-entry form. The server verifies it via read-only `GET /forms`, then encrypts it. It is never requested in Telegram chat. Tally keys inherit the account's access; use a dedicated organizer account if appropriate. Disconnect removes the stored key; revoke it separately in Tally when required.

A persistent reservation prevents repeated form creation after uncertainty. Reconcile any `UNCERTAIN` action with the Tally account before an operator deliberately releases its reservation. There is intentionally no automatic force-retry button.

## Reminder verification with laptop off

1. Deploy both processes on the chosen always-on host.
2. Start a private chat with the bot; through WorkBuddy create a reminder a few minutes ahead, using an offset-aware timestamp and your timezone.
3. Confirm its ID and `scheduled` state using `/reminders`.
4. Shut down the laptop; leave the cloud services running.
5. Confirm the phone receives the message; inspect `op_delivery_attempts` for the returned Telegram message ID and timestamp.
6. Restart the worker and confirm the same occurrence does not resend. Test recurring reminders independently.

This test was **not performed** during implementation. Local mocked acknowledgment tests are not cloud-runtime evidence.

## Official references

[Telegram API](https://core.telegram.org/bots/api), [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail send](https://developers.google.com/workspace/gmail/api/guides/sending), [Calendar creation](https://developers.google.com/workspace/calendar/api/guides/create-events), [Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads).
