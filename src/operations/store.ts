import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';

export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const instant = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
export const reminderSchema = z.object({
  message: z.string().trim().min(1).max(3500), nextAt: instant,
  timezone: z.string().refine(zone => DateTime.now().setZone(zone).isValid, 'Invalid timezone'),
  recurrence: z.enum(['once', 'daily', 'weekly']).default('once'),
  kind: z.enum(['message', 'progress']).default('message'), eventId: z.string().optional()
}).strict();
export interface Reminder {
  id: string; owner: string; chat_id: string; event_id: string | null; message: string;
  next_at: string; timezone: string; recurrence: 'once' | 'daily' | 'weekly'; kind: 'message' | 'progress';
  status: 'scheduled' | 'sending' | 'delivered' | 'cancelled' | 'uncertain' | 'failed';
  attempts: number; claim: string | null; claimed_at: string | null; last_at: string | null;
  evidence: string | null; error: string | null;
}
export interface Action {
  id: string; owner: string; event_id: string; kind: string; payload: string; payload_hash: string;
  status: string; expires_at: string; evidence: string | null; error: string | null;
}

/** Additive, versioned operational tables share the existing SQLite event database. */
export class OperationsStore {
  readonly db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 5000'); this.db.pragma('journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS operations_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    this.db.transaction(() => {
      if(this.db.prepare('SELECT 1 FROM operations_migrations WHERE version=1').get()) return;
      this.db.exec(`
        CREATE TABLE op_users (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE op_members (event_id TEXT NOT NULL REFERENCES events(id), user_id TEXT NOT NULL REFERENCES op_users(id), role TEXT NOT NULL CHECK(role IN ('owner','member')), PRIMARY KEY(event_id,user_id));
        CREATE TABLE op_context (user_id TEXT PRIMARY KEY REFERENCES op_users(id), event_id TEXT NOT NULL REFERENCES events(id));
        CREATE TABLE op_inbox (id INTEGER PRIMARY KEY, owner TEXT NOT NULL REFERENCES op_users(id), text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL);
        CREATE TABLE op_reminders (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES op_users(id), chat_id TEXT NOT NULL, event_id TEXT REFERENCES events(id), message TEXT NOT NULL, next_at TEXT NOT NULL, timezone TEXT NOT NULL, recurrence TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, claim TEXT, claimed_at TEXT, last_at TEXT, evidence TEXT, error TEXT);
        CREATE INDEX op_reminders_due ON op_reminders(status,next_at);
        CREATE TABLE op_delivery_attempts (id TEXT PRIMARY KEY, reminder_id TEXT NOT NULL REFERENCES op_reminders(id), started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, evidence TEXT, error TEXT);
        CREATE TABLE op_actions (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES op_users(id), event_id TEXT NOT NULL REFERENCES events(id), kind TEXT NOT NULL, payload TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL, evidence TEXT, error TEXT, created_at TEXT NOT NULL);
        CREATE TABLE op_connections (owner TEXT NOT NULL REFERENCES op_users(id), provider TEXT NOT NULL, encrypted TEXT NOT NULL, status TEXT NOT NULL, account TEXT, verified_at TEXT, PRIMARY KEY(owner,provider));
        CREATE TABLE op_sessions (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES op_users(id), provider TEXT NOT NULL, verifier TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE op_documents (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES op_users(id), event_id TEXT NOT NULL REFERENCES events(id), path TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, pages INTEGER NOT NULL, event_revision INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE op_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, operation TEXT NOT NULL, resource TEXT NOT NULL, timestamp TEXT NOT NULL, detail TEXT NOT NULL);
      `);
      this.db.prepare('INSERT INTO operations_migrations VALUES(1,?)').run(new Date().toISOString());
    }).immediate();
    this.db.transaction(()=>{
      if(this.db.prepare('SELECT 1 FROM operations_migrations WHERE version=2').get()) return;
      this.db.exec('CREATE TABLE op_requests (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES op_users(id), payload_hash TEXT NOT NULL, result TEXT)');
      this.db.prepare('INSERT INTO operations_migrations VALUES(2,?)').run(new Date().toISOString());
    }).immediate();
    this.db.transaction(()=>{
      if(this.db.prepare('SELECT 1 FROM operations_migrations WHERE version=3').get()) return;
      this.db.exec("CREATE TABLE op_task_expectations (task_id TEXT PRIMARY KEY REFERENCES tasks(id), output_kind TEXT NOT NULL CHECK(output_kind IN ('document','action','budget')), evidence TEXT)");
      this.db.prepare('INSERT INTO operations_migrations VALUES(3,?)').run(new Date().toISOString());
    }).immediate();
    this.db.transaction(()=>{
      if(this.db.prepare('SELECT 1 FROM operations_migrations WHERE version=4').get()) return;
      this.db.exec(`
        CREATE TABLE op_task_details (
          task_id TEXT PRIMARY KEY REFERENCES tasks(id), description TEXT NOT NULL DEFAULT '', workstream TEXT NOT NULL DEFAULT '',
          owner_id TEXT REFERENCES op_users(id), assignment_status TEXT NOT NULL DEFAULT 'unassigned' CHECK(assignment_status IN ('unassigned','assigned','accepted','declined')),
          deadline TEXT, priority INTEGER NOT NULL DEFAULT 2 CHECK(priority BETWEEN 0 AND 3), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE op_task_notes (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), author TEXT NOT NULL REFERENCES op_users(id), text TEXT NOT NULL, document_id TEXT REFERENCES op_documents(id), created_at TEXT NOT NULL);
        CREATE TABLE op_task_history (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id), actor TEXT NOT NULL REFERENCES op_users(id), operation TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE op_team_invites (token_hash TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), user_id TEXT NOT NULL REFERENCES op_users(id), expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
      `);
      this.db.prepare('INSERT INTO operations_migrations VALUES(4,?)').run(new Date().toISOString());
    }).immediate();
  }
  request(owner:string,id:string,payloadHash:string): {result?:unknown;claimed:boolean} {
    return this.db.transaction(()=>{
      const prior=this.db.prepare('SELECT * FROM op_requests WHERE id=?').get(id) as {owner:string;payload_hash:string;result:string|null}|undefined;
      if(prior) {
        if(prior.owner!==owner || prior.payload_hash!==payloadHash) throw new Error('Idempotency key conflict');
        return {claimed:false,result:prior.result ? JSON.parse(prior.result) : {status:'IN_PROGRESS_OR_UNCERTAIN',requestId:id}};
      }
      this.db.prepare('INSERT INTO op_requests VALUES(?,?,?,NULL)').run(id,owner,payloadHash);return {claimed:true};
    }).immediate();
  }
  requestFinished(owner:string,id:string,result:unknown) {this.db.prepare('UPDATE op_requests SET result=? WHERE owner=? AND id=?').run(JSON.stringify(result),owner,id);}
  close() { this.db.close(); }
  audit(owner: string, operation: string, resource: string, detail: unknown = {}) {
    this.db.prepare('INSERT INTO op_audit(owner,operation,resource,timestamp,detail) VALUES(?,?,?,?,?)').run(owner, operation, resource, new Date().toISOString(), JSON.stringify(detail));
  }
  user(id: string, chat: string) {
    if (!/^\d+$/.test(id) || id !== chat) throw new Error('Private verified Telegram identity required');
    this.db.prepare('INSERT INTO op_users VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id').run(id, chat, new Date().toISOString());
  }
  chat(owner: string): string {
    const row = this.db.prepare('SELECT chat_id FROM op_users WHERE id=?').get(owner) as { chat_id: string } | undefined;
    if (!row) throw new Error('Start a private chat with the operations bot first');
    return row.chat_id;
  }
  own(owner: string, event: string) {
    // Claim only a newly created event; existing ownership is immutable here.
    this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM op_members WHERE event_id=?').get(event)) throw new Error('Event already owned');
      this.db.prepare("INSERT INTO op_members VALUES(?,?,'owner')").run(event, owner);
      this.db.prepare('INSERT INTO op_context VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET event_id=excluded.event_id').run(owner, event);
    })();
  }
  authorize(owner: string, event: string, level: 'owner'|'member' = 'owner') {
    if (!this.db.prepare("SELECT 1 FROM op_members WHERE event_id=? AND user_id=? AND (?='member' OR role='owner')").get(event, owner, level)) throw new Error('Event access denied');
  }
  events(owner: string) { return this.db.prepare('SELECT event_id FROM op_members WHERE user_id=? ORDER BY event_id').all(owner) as { event_id: string }[]; }
  current(owner: string): string | undefined { return (this.db.prepare('SELECT event_id FROM op_context WHERE user_id=?').get(owner) as { event_id: string } | undefined)?.event_id; }
  select(owner: string, event: string) { this.authorize(owner, event, 'member'); this.db.prepare('INSERT INTO op_context VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET event_id=excluded.event_id').run(owner,event); }
  enqueue(updateId: number, owner: string, text: string) {
    return this.db.prepare('INSERT OR IGNORE INTO op_inbox(id,owner,text,created_at) VALUES(?,?,?,?)').run(updateId,owner,text,new Date().toISOString()).changes === 1;
  }
  schedule(owner: string, input: z.input<typeof reminderSchema>, now = new Date()) {
    const value = reminderSchema.parse(input);
    if (new Date(value.nextAt) <= now) throw new Error('Reminder must be in the future');
    if (value.eventId) this.authorize(owner, value.eventId, 'member');
    if (value.kind === 'progress' && !value.eventId) throw new Error('Progress reminders require an event');
    const id = randomUUID();
    this.db.prepare("INSERT INTO op_reminders(id,owner,chat_id,event_id,message,next_at,timezone,recurrence,kind,status) VALUES(?,?,?,?,?,?,?,?,?,'scheduled')")
      .run(id,owner,this.chat(owner),value.eventId ?? null,value.message,value.nextAt,value.timezone,value.recurrence,value.kind);
    this.audit(owner,'reminder.scheduled',id); return this.reminder(owner,id)!;
  }
  reminder(owner: string,id: string) { return this.db.prepare('SELECT * FROM op_reminders WHERE owner=? AND id=?').get(owner,id) as Reminder | undefined; }
  reminders(owner: string) { return this.db.prepare('SELECT * FROM op_reminders WHERE owner=? ORDER BY next_at').all(owner) as Reminder[]; }
  changeReminder(owner: string,id: string,nextAt?: string) {
    const at = nextAt === undefined ? undefined : instant.parse(nextAt);
    if (at && new Date(at) <= new Date()) throw new Error('Reminder must be in the future');
    const changed = at
      ? this.db.prepare("UPDATE op_reminders SET next_at=?, status='scheduled',attempts=0,error=NULL WHERE owner=? AND id=? AND status IN ('scheduled','failed','delivered')").run(at,owner,id)
      : this.db.prepare("UPDATE op_reminders SET status='cancelled' WHERE owner=? AND id=? AND status IN ('scheduled','failed','uncertain')").run(owner,id);
    if (!changed.changes) throw new Error('Reminder missing or delivery already in progress');
    this.audit(owner,at ? 'reminder.rescheduled' : 'reminder.cancelled',id);
  }
  recover(now = new Date()) {
    // A crash after network acceptance cannot safely be retried: Telegram has no idempotency key.
    const cutoff = new Date(now.getTime()-120000).toISOString();
    this.db.transaction(() => {
      this.db.prepare("UPDATE op_delivery_attempts SET status='uncertain',finished_at=?,error='worker_interrupted' WHERE status='sending' AND started_at<?").run(now.toISOString(),cutoff);
      this.db.prepare("UPDATE op_reminders SET status='uncertain',error='worker_interrupted' WHERE status='sending' AND claimed_at<?").run(cutoff);
    })();
  }
  claim(now = new Date()): Reminder | undefined {
    return this.db.transaction(() => {
      const reminder = this.db.prepare("SELECT * FROM op_reminders WHERE status='scheduled' AND next_at<=? ORDER BY next_at LIMIT 1").get(now.toISOString()) as Reminder | undefined;
      if (!reminder) return undefined;
      const token = randomUUID();
      this.db.prepare("UPDATE op_reminders SET status='sending',claim=?,claimed_at=?,attempts=attempts+1 WHERE id=? AND status='scheduled'").run(token,now.toISOString(),reminder.id);
      this.db.prepare("INSERT INTO op_delivery_attempts(id,reminder_id,started_at,status) VALUES(?,?,?,'sending')").run(token,reminder.id,now.toISOString());
      return { ...reminder, status: 'sending',claim:token,claimed_at:now.toISOString(), attempts:reminder.attempts+1 } as Reminder;
    }).immediate();
  }
  finish(reminder: Reminder, outcome: { evidence?: unknown; error?: string; retryAfter?: number; uncertain?: boolean }, now = new Date()) {
    this.db.transaction(() => {
      let status = outcome.evidence ? 'delivered' : outcome.uncertain ? 'uncertain' : 'failed';
      let next = reminder.next_at;
      if (outcome.evidence && reminder.recurrence !== 'once') {
        let date = DateTime.fromISO(reminder.next_at).setZone(reminder.timezone);
        // Skip missed occurrences; do not spam after downtime. Calendar arithmetic preserves local time across DST.
        do { date = date.plus(reminder.recurrence === 'daily' ? { days:1 } : { weeks:1 }); } while (date.toMillis() <= now.getTime());
        next = date.toUTC().toISO()!; status = 'scheduled';
      } else if (outcome.retryAfter !== undefined && reminder.attempts < 5) {
        next = new Date(now.getTime()+Math.max(1000,outcome.retryAfter)).toISOString(); status = 'scheduled';
      }
      const evidence = outcome.evidence ? JSON.stringify(outcome.evidence) : null;
      const changed = this.db.prepare("UPDATE op_reminders SET status=?,next_at=?,last_at=?,evidence=?,error=?,claim=NULL,attempts=? WHERE id=? AND claim=? AND status='sending'")
        .run(status,next,now.toISOString(),evidence,outcome.error ?? null,outcome.evidence ? 0 : reminder.attempts,reminder.id,reminder.claim);
      if (!changed.changes) throw new Error('Stale reminder claim');
      this.db.prepare('UPDATE op_delivery_attempts SET finished_at=?,status=?,evidence=?,error=? WHERE id=?').run(now.toISOString(),outcome.evidence ? 'acknowledged' : outcome.uncertain ? 'uncertain' : 'failed',evidence,outcome.error ?? null,reminder.claim);
    })();
  }
  action(owner: string,event: string,kind: string,payload: unknown) {
    this.authorize(owner,event);
    const id = randomUUID(), body = JSON.stringify(payload);
    if (Buffer.byteLength(body)>100000) throw new Error('Action too large');
    this.db.prepare("INSERT INTO op_actions(id,owner,event_id,kind,payload,payload_hash,status,expires_at,created_at) VALUES(?,?,?,?,?,?,'WAITING_FOR_APPROVAL',?,?)")
      .run(id,owner,event,kind,body,hash(body),new Date(Date.now()+3600000).toISOString(),new Date().toISOString());
    this.audit(owner,'action.prepared',id,{ kind, hash:hash(body) }); return this.getAction(owner,id)!;
  }
  getAction(owner: string,id: string) { return this.db.prepare('SELECT * FROM op_actions WHERE owner=? AND id=?').get(owner,id) as Action | undefined; }
  decide(owner: string,id: string,decision: 'approve'|'reject',expectedHash: string) {
    const changed = this.db.prepare("UPDATE op_actions SET status=? WHERE id=? AND owner=? AND status='WAITING_FOR_APPROVAL' AND expires_at>? AND substr(payload_hash,1,16)=?")
      .run(decision === 'approve' ? 'READY' : 'CANCELLED',id,owner,new Date().toISOString(),expectedHash);
    if (!changed.changes) throw new Error('Approval missing, expired or already decided');
    this.audit(owner,`action.${decision}`,id);
  }
  claimAction(owner: string,id: string) {
    return this.db.transaction(() => {
      const action = this.getAction(owner,id);
      if (!action || action.status !== 'READY' || action.expires_at <= new Date().toISOString() || hash(action.payload)!==action.payload_hash) throw new Error('Exact, unexpired approval required');
      this.authorize(owner,action.event_id);
      this.db.prepare("UPDATE op_actions SET status='RUNNING' WHERE id=?").run(id);
      return action;
    }).immediate();
  }
}
