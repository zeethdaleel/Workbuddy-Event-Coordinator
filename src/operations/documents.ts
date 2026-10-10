import { buildRegistrationSpec, type RegistrationSpec } from '../core/registration.js';
import type { ProposalContent } from '../core/proposal.js';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OperationsStore, hash } from './store.js';
import type { EventApplicationService } from '../core/event-application-service.js';

export class DocumentService {
  constructor(private store: OperationsStore,private events: EventApplicationService,private directory: string) {}
  async proposal(owner: string,eventId: string,content?:ProposalContent,registrationDraft?:RegistrationSpec) {
    this.store.authorize(owner,eventId);
    const result = await this.events.getSummary(eventId);
    if (!result.ok) throw new Error('Event missing');
    const { event,tasks,facts } = result.value, request = event.workflow.request;
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica),bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page = pdf.addPage([595,842]),y = 780;
    // Built-in fonts have limited glyph coverage: fail explicitly rather than silently dropping event text.
    const paragraph = (text: string,heading = false) => {
      if(heading && y<110) { page=pdf.addPage([595,842]); y=780; }
      const font = heading ? bold : regular,size = heading ? 15 : 10;
      font.encodeText(text);
      const words = text.split(/\s+/); let line = '';
      const draw = () => {
        if (y<65) { page = pdf.addPage([595,842]); y=780; }
        page.drawText(line,{x:48,y,size,font,color:heading ? rgb(.1,.25,.36) : rgb(.15,.18,.22)}); y-=heading ? 24 : 15;
      };
      for(const word of words) {
        if(font.widthOfTextAtSize(word,size)>495) {
          if(line) { draw(); line=''; }
          for(const character of word) { if(font.widthOfTextAtSize(line+character,size)>495) {draw();line='';} line+=character; }
          draw(); line=''; continue;
        }
        if(line && font.widthOfTextAtSize(`${line} ${word}`,size)>495) {draw();line='';}
        line += (line ? ' ' : '')+word;
      }
      if(line) draw(); y-=7;
    };
    paragraph('DARLINGAGENT | EVENT PROPOSAL',true);
    paragraph(request.title,true); paragraph('DRAFT - planning document; not a booking or institutional approval.');
    paragraph('Event details',true);
    for(const [label,value] of Object.entries({Date:request.date,Time:request.startTime && `${request.startTime} - ${request.endTime ?? 'TBC'}`,Timezone:request.timezone,Location:request.location,Venue:request.venue,Organizer:request.organizer,Attendance:request.attendeeCount})) paragraph(`${label}: ${value ?? 'Not confirmed'}`);
    if(request.description) paragraph(request.description);
    paragraph('Objectives',true);
    for(const item of content?.objectives ?? ['Objectives not yet recorded.']) paragraph(item);
    paragraph('Proposed agenda',true);
    for(const item of content?.agenda ?? []) paragraph(`${item.time}: ${item.activity}`);
    if(!content?.agenda.length) paragraph('Agenda pending organizer confirmation.');
    paragraph('Itemized budget',true);
    for(const line of event.workflow.budget) paragraph(`${line.item}: ${request.currency ?? 'MYR'} ${line.amount.toFixed(2)} [${line.status}] - ${line.note}`);
    paragraph(`Total: ${request.currency} ${event.workflow.total.toFixed(2)} | Remaining: ${event.workflow.remainingBudget?.toFixed(2) ?? 'Not verified'}`);
    paragraph('Organizer checklist',true);
    if(!tasks.length) paragraph('No organizer tasks recorded.');
    for(const task of tasks) paragraph(`${task.title} [${task.status}]${task.dependencies.length ? ` - depends on ${task.dependencies.join(', ')}` : ''}`);
    for(const item of content?.assignments ?? []) paragraph(`${item.task}: ${item.assignee} [${item.status}]`);
    paragraph('Registration',true);
    const forms=this.store.db.prepare('SELECT form_url,status FROM registration_forms WHERE event_id=?').all(eventId) as {form_url:string;status:string}[];
    if(!forms.length) {
      paragraph('Not published. Registration draft requires explicit approval and a configured Tally connection.');
      const draft=registrationDraft ?? buildRegistrationSpec(event);
      paragraph(`Proposed capacity: ${draft.capacity ?? 'Not set'}. Requested deadline: ${draft.deadline ?? 'Not set'}. Automatic deadline closing is not configured.`);
      for(const field of draft.fields) paragraph(`${field.label} (${field.kind}, ${field.required?'required':'optional'})`);
    }
    for(const form of forms) paragraph(`${form.status}: ${form.form_url}`);
    paragraph('Vendor research',true);
    if(!content?.vendors.length) paragraph('No source-reviewed vendors recorded. Budget figures remain planning estimates.');
    for(const vendor of content?.vendors ?? []) paragraph(`${vendor.name} [${vendor.verification}, checked ${vendor.checkedAt}]. ${vendor.services}. Contact: ${vendor.contact ?? 'Not found'}. Published price: ${vendor.publishedPrice ?? 'Not found; request a quotation'}. Source: ${vendor.source}`);
    paragraph('Pending approvals',true);
    for(const item of content?.pendingApprovals ?? ['No approval decisions recorded in this proposal.']) paragraph(item);
    if(content?.invitation) {paragraph('Invitation email - UNSENT DRAFT',true);paragraph(`To: ${content.invitation.to.join(', ') || 'Recipients not selected'}`);paragraph(`Subject: ${content.invitation.subject}`);for(const line of content.invitation.body.split(/\n/)) {if(line.trim()) paragraph(line);else y-=5;}}
    if(facts.length) paragraph('Facts and evidence',true);
    for(const fact of facts) paragraph(`${fact.field}: ${fact.value} [${fact.status}]. Source: ${fact.evidence}`);
    paragraph('Assumptions and outstanding work',true);
    for(const item of [...event.workflow.assumptions,...result.value.unresolvedIssues,...(content?.unresolvedIssues ?? [])]) paragraph(item);
    const pages = pdf.getPages();
    pages.forEach((p,index) => p.drawText(`DarlingAgent | Event ${eventId} | Revision ${event.revision} | ${index+1} / ${pages.length}`,{x:48,y:30,size:8,font:regular}));
    const bytes = await pdf.save();
    const verified = await PDFDocument.load(bytes);
    if(!verified.getPageCount()) throw new Error('PDF verification failed');
    const id=randomUUID(); await mkdir(this.directory,{recursive:true,mode:0o700});
    const path=join(this.directory,`${id}.pdf`); await writeFile(path,bytes,{mode:0o600,flag:'wx'});
    const digest=hash(await readFile(path));
    this.store.db.prepare('INSERT INTO op_documents VALUES(?,?,?,?,?,?,?,?,?)').run(id,owner,eventId,path,digest,bytes.length,pages.length,event.revision,new Date().toISOString());
    this.store.audit(owner,'document.generated',id,{sha256:digest,pages:pages.length});
    return {id,sha256:digest,bytes:bytes.length,pages:pages.length,eventRevision:event.revision};
  }
  async read(owner: string,id: string) {
    const row = this.store.db.prepare('SELECT * FROM op_documents WHERE id=? AND owner=?').get(id,owner) as {path:string;sha256:string;event_id:string}|undefined;
    if(!row) throw new Error('Document access denied');
    this.store.authorize(owner,row.event_id);
    const path=resolve(row.path),root=resolve(this.directory)+sep;
    if(!path.startsWith(root)) throw new Error('Invalid document path');
    const bytes=await readFile(path); if(hash(bytes)!==row.sha256) throw new Error('Document integrity check failed');
    return bytes;
  }
}
