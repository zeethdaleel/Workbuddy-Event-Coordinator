import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { z } from 'zod';
import { SqlitePersistence } from '../adapters/sqlite/sqlite-persistence.js';
import { EventApplicationService } from '../core/event-application-service.js';
import { prepareStructuredWorkflow,structuredEventSchema } from '../core/structured-event.js';
import { OperationsStore,reminderSchema } from './store.js';
import { Connections,Vault } from './connect.js';
import { TelegramClient } from './telegram.js';
import { DocumentService } from './documents.js';
import { TeamService } from './team.js';
import { Actions } from './actions.js';

export const operationNames=['inbox_list','inbox_complete','event_create','event_get','event_list','event_select','event_update','team_invite','task_list','task_edit','task_note','task_history','task_cancel','task_reopen','task_create','task_start','task_record_result','task_complete','document_generate','document_deliver','reminder_create','reminder_list','reminder_cancel','reminder_reschedule','connections_list','action_prepare','action_get'] as const;
export type Operation = typeof operationNames[number];
const id=z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export interface RuntimeConfig {dataDirectory:string;telegramToken:string;encryptionKey:string;publicUrl:string;googleClientId?:string;googleClientSecret?:string;}
export function createRuntime(config:RuntimeConfig,transport:typeof fetch=fetch) {
  mkdirSync(config.dataDirectory,{recursive:true,mode:0o700});
  const persistence=new SqlitePersistence(join(config.dataDirectory,'events.sqlite'));
  const events=new EventApplicationService(persistence),store=new OperationsStore(join(config.dataDirectory,'events.sqlite'));
  const telegram=new TelegramClient(config.telegramToken,transport);
  const connections=new Connections(store,new Vault(config.encryptionKey),config);
  const documents=new DocumentService(store,events,join(config.dataDirectory,'documents'));
  const team=new TeamService(store);
  const actions=new Actions(store,connections,documents,telegram,events,persistence);
  async function dispatch(owner:string,operation:Operation,input:unknown) {
    store.chat(owner);
    if(operation==='inbox_list') return store.db.prepare("SELECT id,text,status,created_at FROM op_inbox WHERE owner=? AND status='queued' ORDER BY id LIMIT 30").all(owner);
    if(operation==='inbox_complete') {
      const value=z.object({updateId:z.number().int()}).strict().parse(input);
      store.db.prepare("UPDATE op_inbox SET status='completed' WHERE owner=? AND id=?").run(owner,value.updateId);return {updated:true};
    }
    if(operation==='event_list') return store.events(owner);
    if(operation==='connections_list') return connections.list(owner);
    if(operation==='reminder_list') return store.reminders(owner);
    if(operation==='event_create') {
      const value=structuredEventSchema.parse(input),eventId=randomUUID(),workflow=prepareStructuredWorkflow(value);
      store.db.transaction(()=>{
        store.db.prepare('INSERT INTO events VALUES(?,0,?)').run(eventId,JSON.stringify({value:workflow,undefinedPaths:[]}));
        store.own(owner,eventId);store.audit(owner,'event.created',eventId);
      })();
      return events.getSummary(eventId);
    }
    if(operation==='event_update') {
      const value=structuredEventSchema.extend({eventId:id,expectedRevision:z.number().int().nonnegative()}).parse(input);store.authorize(owner,value.eventId);
      const {eventId: _eventId,expectedRevision: _revision,...plan}=value;
      const workflow=prepareStructuredWorkflow(plan);
      store.db.transaction(()=>{
        const changed=store.db.prepare('UPDATE events SET workflow_json=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify({value:workflow,undefinedPaths:[]}),value.eventId,value.expectedRevision);
        if(!changed.changes) throw new Error('Event revision conflict');
        store.db.prepare("UPDATE op_actions SET status='CANCELLED',error='event_changed_reapproval_required' WHERE event_id=? AND status IN ('READY','WAITING_FOR_APPROVAL','WAITING_FOR_CONNECTION')").run(value.eventId);
        store.audit(owner,'event.updated',value.eventId,{priorRevision:value.expectedRevision,outdated:'Previously generated documents and externally published resources must be reviewed'});
      })();
      return {summary:await events.getSummary(value.eventId),warning:'Existing documents and published resources may be outdated. Regenerate or request a new approval; external resources were not updated.'};
    }
    if(operation==='event_get' || operation==='event_select' || operation==='document_generate') {
      const {eventId}=z.object({eventId:id}).strict().parse(input);store.authorize(owner,eventId);
      if(operation==='event_select') {store.select(owner,eventId);return {eventId};}
      return operation==='event_get' ? events.getSummary(eventId) : documents.proposal(owner,eventId);
    }
    if(operation==='document_deliver') {
      const {documentId}=z.object({documentId:z.uuid()}).strict().parse(input);
      const bytes=await documents.read(owner,documentId);
      // At most one delivery attempt per request is made; ambiguous errors must be reconciled by the user.
      const evidence=await telegram.sendDocument(store.chat(owner),bytes,`${documentId}.pdf`);
      store.audit(owner,'document.telegram_acknowledged',documentId,evidence);return evidence;
    }
    if(operation==='reminder_create') return store.schedule(owner,reminderSchema.parse(input));
    if(operation==='reminder_cancel' || operation==='reminder_reschedule') {
      const value=z.object({reminderId:z.uuid(),nextAt:z.string().optional()}).strict().parse(input);
      if(operation==='reminder_reschedule' && !value.nextAt) throw new Error('nextAt required');
      store.changeReminder(owner,value.reminderId,operation==='reminder_cancel' ? undefined : value.nextAt);return store.reminder(owner,value.reminderId);
    }
    if(operation==='team_invite') {const v=z.object({eventId:id,userId:z.string().regex(/^\d+$/)}).strict().parse(input);return team.invite(owner,v.eventId,v.userId);}
    if(operation==='task_list') {const v=z.object({eventId:id}).strict().parse(input);return team.list(owner,v.eventId);}
    if(operation==='task_edit') return team.edit(owner,input);
    if(operation==='task_note') return team.note(owner,input);
    if(operation==='task_history') {const v=z.object({taskId:id}).strict().parse(input);return team.history(owner,v.taskId);}
    if(operation==='task_cancel' || operation==='task_reopen') {
      const v=z.object({taskId:id,expectedRevision:z.number().int().nonnegative()}).strict().parse(input);
      const task=await persistence.tasks.get(v.taskId);if(!task) throw new Error('Task missing');store.authorize(owner,task.eventId);
      if(operation==='task_reopen' && !['completed','cancelled','failed'].includes(task.status)) throw new Error('Only closed tasks can be reopened');
      const result=await events.transitionTask(task.id,v.expectedRevision,operation==='task_cancel'?'cancelled':'queued');
      if(result.ok) {store.db.prepare('UPDATE op_task_expectations SET evidence=NULL WHERE task_id=?').run(task.id);store.audit(owner,operation,task.id);}
      return result;
    }
    if(operation==='task_create') {
      const value=z.object({eventId:id,title:z.string().min(1).max(300),dependencyIds:z.array(id).max(50).default([]),outputKind:z.enum(['document','action','budget']).optional()}).strict().parse(input);
      store.authorize(owner,value.eventId);
      const created=await events.createTask({id:randomUUID(),eventId:value.eventId,title:value.title,status:'queued'},value.dependencyIds);
      if(created.ok && value.outputKind) store.db.prepare('INSERT INTO op_task_expectations(task_id,output_kind) VALUES(?,?)').run(created.value.id,value.outputKind);
      return created;
    }
    if(operation==='task_complete') {
      const value=z.object({taskId:id,expectedRevision:z.number().int().nonnegative(),evidenceId:id.optional()}).strict().parse(input);
      const task=await persistence.tasks.get(value.taskId);if(!task) throw new Error('Task missing');store.authorize(owner,task.eventId);
      const expected=store.db.prepare('SELECT output_kind FROM op_task_expectations WHERE task_id=?').get(task.id) as {output_kind:string}|undefined;
      if(!expected) throw new Error('This task has no tool-verifiable output contract');
      let evidence:unknown;
      if(expected.output_kind==='document') {
        const record=store.db.prepare('SELECT id,sha256,event_revision FROM op_documents WHERE id=? AND event_id=? AND owner=?').get(value.evidenceId,task.eventId,owner) as {id:string;sha256:string;event_revision:number}|undefined;
        const event=await events.getEvent(task.eventId);
        if(!record || !event.ok || event.value.revision!==record.event_revision) throw new Error('Current event document evidence required');
        await documents.read(owner,record.id);evidence=record;
      } else if(expected.output_kind==='action') {
        const action=store.getAction(owner,value.evidenceId ?? '');
        if(!action || action.event_id!==task.eventId || action.status!=='COMPLETED' || !action.evidence) throw new Error('Completed action evidence required');
        const current=await events.getEvent(task.eventId);
        if(!current.ok || JSON.parse(action.payload).eventRevision!==current.value.revision) throw new Error('Action belongs to an older event revision');
        evidence={actionId:action.id,result:JSON.parse(action.evidence)};
      } else {
        const event=await events.getEvent(task.eventId);
        if(!event.ok || !event.value.workflow.budget.length || event.value.workflow.validation.some(check=>check.status!=='passed')) throw new Error('Passing itemized budget required');
        evidence={eventRevision:event.value.revision,total:event.value.workflow.total,validation:event.value.workflow.validation};
      }
      const result=await events.transitionTask(task.id,value.expectedRevision,'completed');
      if(result.ok) {store.db.prepare('UPDATE op_task_expectations SET evidence=? WHERE task_id=?').run(JSON.stringify(evidence),task.id);store.audit(owner,'task.verified_complete',task.id,evidence);}
      return result;
    }
    if(operation==='task_start' || operation==='task_record_result') {
      const value=z.object({taskId:id,expectedRevision:z.number().int().nonnegative(),result:z.record(z.string(),z.unknown()).optional(),evidence:z.array(z.string().max(2000)).max(100).default([])}).strict().parse(input);
      const task=await persistence.tasks.get(value.taskId);if(!task) throw new Error('Task missing');store.authorize(owner,task.eventId);
      if(operation==='task_start') return events.transitionTask(task.id,value.expectedRevision,'in_progress');
      // Agent-authored text is a result submission, never independent evidence of tool completion.
      return events.submitSpecialistResult({id:randomUUID(),eventId:task.eventId,taskId:task.id,specialist:'WorkBuddy',result:value.result ?? {},evidence:value.evidence,unresolvedIssues:['Agent-submitted result; external completion requires separate tool evidence.']});
    }
    if(operation==='action_prepare') {
      const value=z.object({eventId:id,kind:z.enum(['gmail','tally','calendar','drive']),payload:z.unknown()}).strict().parse(input);
      return actions.prepare(owner,value.eventId,value.kind,value.payload);
    }
    if(operation==='action_get') {const value=z.object({actionId:z.uuid()}).strict().parse(input);return store.getAction(owner,value.actionId) ?? {status:'NOT_FOUND'};}
    throw new Error('Unsupported operation');
  }
  return {persistence,events,store,telegram,connections,documents,actions,team,dispatch,close(){store.close();persistence.close();}};
}
export type Runtime=ReturnType<typeof createRuntime>;
export function configFromEnv(env:NodeJS.ProcessEnv=process.env):RuntimeConfig {
  for(const key of ['DARLING_DATA_DIR','TELEGRAM_BOT_TOKEN','CREDENTIAL_ENCRYPTION_KEY','PUBLIC_BASE_URL']) if(!env[key]) throw new Error(`${key} is required`);
  return {dataDirectory:env.DARLING_DATA_DIR!,telegramToken:env.TELEGRAM_BOT_TOKEN!,encryptionKey:env.CREDENTIAL_ENCRYPTION_KEY!,publicUrl:env.PUBLIC_BASE_URL!.replace(/\/$/,''),googleClientId:env.GOOGLE_CLIENT_ID,googleClientSecret:env.GOOGLE_CLIENT_SECRET};
}
