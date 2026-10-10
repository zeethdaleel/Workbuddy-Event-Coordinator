import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationsStore,hash,type Action } from './store.js';
import { Connections,type Provider } from './connect.js';
import { DocumentService } from './documents.js';
import { TelegramClient } from './telegram.js';
import { TallyClient } from '../adapters/tally/tally-client.js';
import { buildRegistrationSpec,tallyBlocksFromSpec,tallyFormUrl,registrationSpecHash } from '../core/registration.js';
import type { EventApplicationService } from '../core/event-application-service.js';
import type { SqlitePersistence } from '../adapters/sqlite/sqlite-persistence.js';

export const emailSchema=z.object({to:z.array(z.email()).min(1).max(30),subject:z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/),body:z.string().min(1).max(50000),documentIds:z.array(z.uuid()).max(10).default([])}).strict();
export const calendarSchema=z.object({summary:z.string().min(1).max(500),description:z.string().max(10000).default(''),location:z.string().max(1000).default(''),start:z.iso.datetime({offset:true}),end:z.iso.datetime({offset:true}),timezone:z.string().refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}})}).strict().refine(v=>Date.parse(v.end)>Date.parse(v.start),'End must follow start');
export class Actions {
  constructor(readonly store:OperationsStore,readonly connections:Connections,readonly documents:DocumentService,readonly telegram:TelegramClient,readonly events:EventApplicationService,readonly persistence:SqlitePersistence,readonly tallyFactory:(key:string)=>TallyClient=key=>new TallyClient({apiKey:key})) {}
  async prepare(owner:string,event:string,kind:string,input:unknown) {
    this.store.authorize(owner,event);
    let payload:unknown;
    if(kind==='gmail') {
      const email=emailSchema.parse(input);
      const attachments=[];let totalBytes=Buffer.byteLength(email.body);
      for(const id of email.documentIds) { const bytes=await this.documents.read(owner,id); totalBytes+=bytes.length; attachments.push({id,sha256:hash(bytes)}); }
      if(totalBytes>18*1024*1024) throw new Error('Email attachments exceed safe MIME size limit');
      payload={...email,attachments};
    } else if(kind==='tally') {
      const options=z.object({capacity:z.number().int().positive().max(1000000),deadline:z.iso.datetime({offset:true}),includeAccessibility:z.boolean().default(false)}).strict().parse(input);
      if(Date.parse(options.deadline)<=Date.now()) throw new Error('Registration deadline must be in the future');
      const existing=this.store.db.prepare("SELECT 1 FROM op_actions WHERE event_id=? AND kind='tally' AND status IN ('RUNNING','COMPLETED','UNCERTAIN','READY','WAITING_FOR_APPROVAL','WAITING_FOR_CONNECTION')").get(event);
      if(existing || (await this.persistence.registrationForms.listByEvent(event)).length) throw new Error('Registration action already exists; inspect its status before retrying');
      const result=await this.events.getEvent(event);if(!result.ok) throw new Error('Event missing');
      const spec=buildRegistrationSpec(result.value,options);payload={spec,blocks:tallyBlocksFromSpec(spec)};
    } else if(kind==='calendar') payload=calendarSchema.parse(input);
    else if(kind==='drive') {
      const data=z.object({documentId:z.uuid()}).strict().parse(input);const bytes=await this.documents.read(owner,data.documentId); if(bytes.length>5*1024*1024) throw new Error('Drive multipart upload requires a document at most 5 MiB');payload={...data,sha256:hash(bytes)};
    } else throw new Error('Unsupported capability');
    const snapshot=await this.events.getEvent(event);if(!snapshot.ok) throw new Error('Event missing');
    payload={...(payload as Record<string,unknown>),eventRevision:snapshot.value.revision};
    const action=this.store.action(owner,event,kind,payload);
    this.store.db.prepare("UPDATE op_actions SET status='WAITING_FOR_CONNECTION' WHERE id=?").run(action.id);
    return this.review(owner,action.id);
  }
  async review(owner:string,id:string) {
    const action=this.store.getAction(owner,id);if(!action) throw new Error('Action missing');
    if(!['WAITING_FOR_CONNECTION','WAITING_FOR_APPROVAL'].includes(action.status)) return action;
    const connection=this.connections.list(owner).find(c=>c.provider===action.kind) as {status?:string;account?:string}|undefined;
    if(connection?.status!=='CONNECTED') {
      this.store.db.prepare("UPDATE op_actions SET status='WAITING_FOR_CONNECTION' WHERE id=?").run(id);
      return {...action,status:'WAITING_FOR_CONNECTION',next:`Use /connect ${action.kind}, then /review ${id}. Connection never sends this action.`};
    }
    const payload=JSON.parse(action.payload);
    payload.account=connection.account;
    if(action.kind==='tally') payload.connectionFingerprint=hash(this.connections.credential<{key:string}>(owner,'tally').key);
    const body=JSON.stringify(payload);
    this.store.db.prepare("UPDATE op_actions SET payload=?,payload_hash=?,status='WAITING_FOR_APPROVAL',expires_at=? WHERE id=?").run(body,hash(body),new Date(Date.now()+3600000).toISOString(),id);
    const preview=action.kind==='gmail' ? `From account: ${payload.account}\nTo: ${payload.to.join(', ')}\nSubject: ${payload.subject}\n\n${payload.body}\nAttachments: ${payload.attachments.map((v:{id:string})=>v.id).join(', ') || 'none'}`
      : action.kind==='tally' ? `Account: ${payload.account}\nPublish registration:\n${JSON.stringify(payload.spec,null,2)}\nDeadline is recorded for review only; automatic closing is not implemented.`
      : `Account: ${payload.account}\n${action.kind}: ${JSON.stringify(payload,null,2)}`;
    // Review full exact content in ordered chunks; buttons appear only after all chunks are acknowledged.
    for(let i=0;i<preview.length;i+=3500) await this.telegram.sendMessage(this.store.chat(owner),preview.slice(i,i+3500));
    await this.telegram.sendMessage(this.store.chat(owner),`Action ${id}\nApprove the exact preview above? Expires in one hour.`,{inline_keyboard:[[{text:'Approve',callback_data:`a:${id}:${hash(body).slice(0,16)}`},{text:'Reject',callback_data:`r:${id}:${hash(body).slice(0,16)}`}]]});
    return this.store.getAction(owner,id)!;
  }
  async execute(owner:string,id:string) {
    const pending=this.store.getAction(owner,id);if(!pending) throw new Error('Action missing');
    // Check connection and immutable file bytes before claiming any external operation.
    const payload=JSON.parse(pending.payload);
    const connection=this.connections.list(owner).find(c=>c.provider===pending.kind) as {status?:string;account?:string}|undefined;
    if(connection?.status!=='CONNECTED' || connection.account!==payload.account) throw new Error('Connection changed; prepare a fresh approval');
    if(pending.kind==='tally' && payload.connectionFingerprint!==hash(this.connections.credential<{key:string}>(owner,'tally').key)) throw new Error('Tally account key changed; request a fresh review');
    let google;
    if(pending.kind!=='tally') google=await this.connections.google(owner,pending.kind as Exclude<Provider,'tally'>);
    const attachments: {id:string;bytes:Buffer}[]=[];
    for(const attachment of payload.attachments ?? []) {
      const bytes=await this.documents.read(owner,attachment.id);if(hash(bytes)!==attachment.sha256) throw new Error('Attachment changed');attachments.push({id:attachment.id,bytes});
    }
    const driveBytes=pending.kind==='drive' ? await this.documents.read(owner,payload.documentId) : undefined;
    if(driveBytes && hash(driveBytes)!==payload.sha256) throw new Error('Document changed');
    const action=this.store.claimAction(owner,id);
    try {
      let evidence:unknown;
      if(action.kind==='gmail') {
        const boundary=`darling-${randomUUID()}`;
        const mime=[`To: ${payload.to.join(', ')}`,`Subject: =?UTF-8?B?${Buffer.from(payload.subject).toString('base64')}?=`,`MIME-Version: 1.0`,`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(payload.body).toString('base64').match(/.{1,76}/g)!.join('\r\n')];
        for(const attachment of attachments) mime.push(`--${boundary}`,'Content-Type: application/pdf',`Content-Disposition: attachment; filename="${attachment.id}.pdf"`,'Content-Transfer-Encoding: base64','',attachment.bytes.toString('base64').match(/.{1,76}/g)!.join('\r\n'));
        mime.push(`--${boundary}--`,'');
        const response=await google!.request<{id?:string;threadId?:string}>({url:'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',method:'POST',data:{raw:Buffer.from(mime.join('\r\n')).toString('base64url')},retry:false,timeout:20000});
        if(!response.data.id) throw new Error('Missing Gmail acknowledgment');
        evidence={messageId:response.data.id,threadId:response.data.threadId,status:'accepted_by_gmail',payloadHash:action.payload_hash};
      } else if(action.kind==='tally') {
        const {key}=this.connections.credential<{key:string}>(owner,'tally'),tally=this.tallyFactory(key);
        if(!await this.persistence.registrationForms.reserveCreation(action.event_id,id)) throw new Error("Registration already attempted; reconcile first");
        const created=await tally.createForm(payload.blocks,payload.spec.capacity);if(!created.ok) throw new Error('Tally create not verified');
        // Save the external ID immediately, even if follow-up verification fails.
        this.store.db.prepare('UPDATE op_actions SET evidence=? WHERE id=?').run(JSON.stringify({formId:created.form.id}),id);
        const verified=await tally.getForm(created.form.id);
        if(!verified.ok || verified.form.id!==created.form.id || verified.form.status!=='PUBLISHED' || verified.form.isClosed) throw new Error('Tally verification failed');
        const now=new Date().toISOString();
        const stored=await this.persistence.registrationForms.create({id,revision:0,eventId:action.event_id,tallyFormId:created.form.id,formUrl:tallyFormUrl(created.form.id),status:'live',specHash:registrationSpecHash(payload.spec),createdAt:now,updatedAt:now});
        if(!stored.ok) throw new Error('Registration persistence failed');
        evidence={formId:created.form.id,url:stored.record.formUrl,verifiedAt:now,deadlineEnforced:false};
      } else if(action.kind==='calendar') {
        const response=await google!.request<{id?:string;htmlLink?:string}>({url:'https://www.googleapis.com/calendar/v3/calendars/primary/events',method:'POST',params:{sendUpdates:'none'},data:{summary:payload.summary,description:payload.description,location:payload.location,start:{dateTime:payload.start,timeZone:payload.timezone},end:{dateTime:payload.end,timeZone:payload.timezone}},retry:false,timeout:20000});
        if(!response.data.id) throw new Error('Missing Calendar acknowledgment');evidence={eventId:response.data.id,url:response.data.htmlLink};
      } else {
        const boundary=`darling-${randomUUID()}`;
        const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name:`${payload.documentId}.pdf`})}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`),driveBytes!,Buffer.from(`\r\n--${boundary}--`)]);
        const response=await google!.request<{id?:string}>({url:'https://www.googleapis.com/upload/drive/v3/files',method:'POST',params:{uploadType:'multipart',fields:'id'},headers:{'Content-Type':`multipart/related; boundary=${boundary}`},data:body,retry:false,timeout:20000});
        if(!response.data.id) throw new Error('Missing Drive acknowledgment');evidence={fileId:response.data.id,sharing:'private',sha256:payload.sha256};
      }
      this.store.db.prepare("UPDATE op_actions SET status='COMPLETED',evidence=? WHERE id=? AND status='RUNNING'").run(JSON.stringify(evidence),id);
      this.store.audit(owner,'action.completed',id,evidence);return this.store.getAction(owner,id)!;
    } catch {
      // Provider may have accepted a mutation. Retain any known ID and never blindly retry.
      this.store.db.prepare("UPDATE op_actions SET status='UNCERTAIN',error='external_result_requires_reconciliation' WHERE id=?").run(id);
      this.store.audit(owner,'action.uncertain',id);return this.store.getAction(owner,id)!;
    }
  }
}
