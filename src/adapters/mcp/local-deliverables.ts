import { dirname, join, resolve } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { EventApplicationService } from '../../core/event-application-service.js';
import type { RegistrationSpec } from '../../core/registration.js';
import { proposalSchema, type ProposalContent } from '../../core/proposal.js';
import { OperationsStore } from '../../operations/store.js';
import { DocumentService } from '../../operations/documents.js';
import { TeamService } from '../../operations/team.js';

/** Local OS account is the trust boundary; no Telegram token or network backend. */
export function registerLocalDeliverables(server:McpServer,service:EventApplicationService,databasePath:string) {
  const store=new OperationsStore(databasePath),owner='1',directory=resolve(dirname(databasePath),'deliverables');
  store.user(owner,owner);
  store.db.exec('CREATE TABLE IF NOT EXISTS local_proposals(event_id TEXT PRIMARY KEY REFERENCES events(id),revision INTEGER NOT NULL,content TEXT NOT NULL)');
  store.db.exec('CREATE TABLE IF NOT EXISTS local_registration_drafts(event_id TEXT PRIMARY KEY REFERENCES events(id),spec TEXT NOT NULL)');
  const documents=new DocumentService(store,service,directory),team=new TeamService(store);
  const id=z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  async function access(eventId:string) {
    if(!(await service.getEvent(eventId)).ok) throw new Error('Event missing');
    if(!store.db.prepare('SELECT 1 FROM op_members WHERE event_id=?').get(eventId)) store.own(owner,eventId);
    store.authorize(owner,eventId);
  }
  const reply=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],structuredContent:{ok:true,value}});
  server.registerTool('event_list',{description:'List locally saved events so a later conversation can retrieve an existing event.',inputSchema:z.object({})},async()=>reply(store.db.prepare('SELECT id,revision FROM events ORDER BY rowid DESC LIMIT 100').all()));
  server.registerTool('proposal_save',{description:'Save WorkBuddy-authored objectives, agenda, proposed assignments, sourced vendor findings and an UNSENT email draft. No network actions. expectedRevision is 0 for the first save; returned revision is required for later edits.',inputSchema:z.object({eventId:id,expectedRevision:z.number().int().nonnegative(),content:proposalSchema})},async({eventId,expectedRevision,content})=>{
    await access(eventId);
    store.db.transaction(()=>{
      const row=store.db.prepare('SELECT revision FROM local_proposals WHERE event_id=?').get(eventId) as {revision:number}|undefined;
      if((row?.revision??0)!==expectedRevision) throw new Error('Proposal revision conflict');
      store.db.prepare('INSERT INTO local_proposals VALUES(?,?,?) ON CONFLICT(event_id) DO UPDATE SET revision=excluded.revision,content=excluded.content').run(eventId,expectedRevision+1,JSON.stringify(content));
      store.audit(owner,'local.proposal_saved',eventId);
    }).immediate();return reply({eventId,revision:expectedRevision+1});
  });
  server.registerTool('proposal_get',{description:'Retrieve saved proposal sections, vendor sources and invitation draft.',inputSchema:z.object({eventId:id})},async({eventId})=>{await access(eventId);const row=store.db.prepare('SELECT revision,content FROM local_proposals WHERE event_id=?').get(eventId) as {revision:number;content:string}|undefined;return reply(row?{revision:row.revision,content:JSON.parse(row.content)}:{revision:0,content:null});});
  server.registerTool('document_generate',{description:'Generate, reopen and hash-check a real local proposal PDF from saved event, tasks and proposal content. Returns absolute path, hash and pages, plus a local JSON task tracker and unsent invitation text path. No external delivery.',inputSchema:z.object({eventId:id})},async({eventId})=>{
    await access(eventId);
    const row=store.db.prepare('SELECT content FROM local_proposals WHERE event_id=?').get(eventId) as {content:string}|undefined;
    const content:ProposalContent|undefined=row?proposalSchema.parse(JSON.parse(row.content)):undefined;
    const draft=store.db.prepare('SELECT spec FROM local_registration_drafts WHERE event_id=?').get(eventId) as {spec:string}|undefined;
    const document=await documents.proposal(owner,eventId,content,draft?JSON.parse(draft.spec) as RegistrationSpec:undefined);await documents.read(owner,document.id);
    const path=(store.db.prepare('SELECT path FROM op_documents WHERE id=?').get(document.id) as {path:string}).path;
    const registered=await service.registerArtifact({id:document.id,eventId,artifact:{type:'event_plan',path,status:'draft'}},async()=>{await documents.read(owner,document.id);return true;});
    if(!registered.ok) throw new Error('PDF written but artifact metadata could not be saved');
    await mkdir(directory,{recursive:true});
    const summary=await service.getSummary(eventId),trackerPath=join(directory,`${eventId}-${randomUUID()}-tracker.json`);
    await writeFile(trackerPath,JSON.stringify({summary,taskDetails:team.list(owner,eventId),proposal:content,registrationDraft:draft?JSON.parse(draft.spec):null},null,2),{mode:0o600,flag:'wx'});
    let invitationPath:string|undefined;
    if(content?.invitation) {invitationPath=join(directory,`${document.id}-invitation.txt`);await writeFile(invitationPath,`UNSENT DRAFT\nTo: ${content.invitation.to.join(', ')}\nSubject: ${content.invitation.subject}\n\n${content.invitation.body}`,{mode:0o600,flag:'wx'});}
    return reply({...document,path,trackerPath,invitationPath,verified:true});
  });
  server.registerTool('task_update',{description:'Edit local task description, workstream, priority and deadline using the current task revision. Use task_transition separately for status; never mark external execution complete from generated text.',inputSchema:z.object({eventId:id,taskId:id,expectedRevision:z.number().int().nonnegative(),description:z.string().max(5000).optional(),workstream:z.string().max(100).optional(),deadline:z.string().datetime({offset:true}).nullable().optional(),priority:z.number().int().min(0).max(3).optional()})},async({eventId,...input})=>{await access(eventId);const row=store.db.prepare('SELECT event_id FROM tasks WHERE id=?').get(input.taskId) as {event_id:string}|undefined;if(row?.event_id!==eventId) throw new Error('Task event mismatch');return reply(team.edit(owner,input));});
  return store;
}
