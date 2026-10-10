import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OperationsStore, hash, instant } from './store.js';

const editSchema=z.object({taskId:z.string(),expectedRevision:z.number().int().nonnegative(),description:z.string().max(5000).optional(),workstream:z.string().max(100).optional(),assignee:z.string().regex(/^\d+$/).nullable().optional(),deadline:instant.nullable().optional(),priority:z.number().int().min(0).max(3).optional()}).strict();
interface Task {id:string;event_id:string;revision:number;status:string;owner_id:string|null;assignment_status:string;}
export class TeamService {
  constructor(private store:OperationsStore) {}
  private task(actor:string,id:string,level:'owner'|'member'='owner') {
    const task=this.store.db.prepare('SELECT t.*,d.owner_id,d.assignment_status FROM tasks t LEFT JOIN op_task_details d ON d.task_id=t.id WHERE t.id=?').get(id) as Task|undefined;
    if(!task) throw new Error('Task missing');this.store.authorize(actor,task.event_id,level);return task;
  }
  list(actor:string,event:string) {
    this.store.authorize(actor,event,'member');
    return this.store.db.prepare('SELECT t.*,d.description,d.workstream,d.owner_id,d.assignment_status,d.deadline,d.priority FROM tasks t LEFT JOIN op_task_details d ON d.task_id=t.id WHERE t.event_id=? ORDER BY d.deadline,t.id').all(event);
  }
  private record(actor:string,id:string,operation:string) {
    const snapshot=this.store.db.prepare('SELECT t.*,d.description,d.workstream,d.owner_id,d.assignment_status,d.deadline,d.priority FROM tasks t LEFT JOIN op_task_details d ON d.task_id=t.id WHERE t.id=?').get(id);
    this.store.db.prepare('INSERT INTO op_task_history(task_id,actor,operation,snapshot,created_at) VALUES(?,?,?,?,?)').run(id,actor,operation,JSON.stringify(snapshot),new Date().toISOString());
    this.store.audit(actor,operation,id);
  }
  edit(actor:string,input:unknown) {
    const value=editSchema.parse(input);
    return this.store.db.transaction(()=>{
      const task=this.task(actor,value.taskId);
      if(value.assignee) this.store.authorize(value.assignee,task.event_id,'member');
      if(!this.store.db.prepare('UPDATE tasks SET revision=revision+1 WHERE id=? AND revision=?').run(task.id,value.expectedRevision).changes) throw new Error('Task revision conflict');
      const now=new Date().toISOString();
      this.store.db.prepare('INSERT OR IGNORE INTO op_task_details(task_id,created_at,updated_at) VALUES(?,?,?)').run(task.id,now,now);
      for(const [field,column] of [['description','description'],['workstream','workstream'],['deadline','deadline'],['priority','priority']] as const) {
        if(value[field]!==undefined) this.store.db.prepare(`UPDATE op_task_details SET ${column}=? WHERE task_id=?`).run(value[field],task.id);
      }
      if(value.assignee!==undefined && value.assignee!==(task.owner_id ?? null)) this.store.db.prepare('UPDATE op_task_details SET owner_id=?,assignment_status=? WHERE task_id=?').run(value.assignee,value.assignee?'assigned':'unassigned',task.id);
      this.store.db.prepare('UPDATE op_task_details SET updated_at=? WHERE task_id=?').run(now,task.id);
      this.record(actor,task.id,'task.edited');return this.list(actor,task.event_id);
    }).immediate();
  }
  invite(actor:string,event:string,user:string) {
    this.store.authorize(actor,event);this.store.chat(user);
    const token=randomBytes(24).toString('hex');
    this.store.db.prepare('INSERT INTO op_team_invites VALUES(?,?,?,?,0)').run(hash(token),event,user,new Date(Date.now()+86400000).toISOString());
    this.store.audit(actor,'team.invited',event,{user});return {joinCommand:`/join ${token}`,expiresInHours:24,recipient:user};
  }
  join(actor:string,token:string) {
    return this.store.db.transaction(()=>{
      const invite=this.store.db.prepare('SELECT event_id FROM op_team_invites WHERE token_hash=? AND user_id=? AND used=0 AND expires_at>?').get(hash(token),actor,new Date().toISOString()) as {event_id:string}|undefined;
      if(!invite) throw new Error('Invitation missing or expired');
      this.store.db.prepare("INSERT OR IGNORE INTO op_members VALUES(?,?,'member')").run(invite.event_id,actor);
      this.store.db.prepare('UPDATE op_team_invites SET used=1 WHERE token_hash=?').run(hash(token));
      this.store.audit(actor,'team.joined',invite.event_id);return {eventId:invite.event_id};
    }).immediate();
  }
  respond(actor:string,id:string,accept:boolean) {
    return this.store.db.transaction(()=>{
      const task=this.task(actor,id,'member');
      if(task.owner_id!==actor || task.assignment_status!=='assigned' || ['completed','cancelled'].includes(task.status)) throw new Error('Pending assignment required');
      this.store.db.prepare('UPDATE op_task_details SET assignment_status=?,updated_at=? WHERE task_id=?').run(accept?'accepted':'declined',new Date().toISOString(),id);
      this.store.db.prepare('UPDATE tasks SET revision=revision+1 WHERE id=?').run(id);
      this.record(actor,id,accept?'task.accepted':'task.declined');return {taskId:id,accepted:accept};
    }).immediate();
  }
  note(actor:string,input:unknown) {
    const value=z.object({taskId:z.string(),text:z.string().trim().min(1).max(5000),documentId:z.uuid().optional()}).strict().parse(input);
    return this.store.db.transaction(()=>{
      const task=this.task(actor,value.taskId,'member');
      if(value.documentId && !this.store.db.prepare('SELECT 1 FROM op_documents WHERE id=? AND event_id=?').get(value.documentId,task.event_id)) throw new Error('Document must belong to this event');
      const id=randomUUID();this.store.db.prepare('INSERT INTO op_task_notes VALUES(?,?,?,?,?,?)').run(id,task.id,actor,value.text,value.documentId??null,new Date().toISOString());
      this.record(actor,task.id,'task.note_added');return {id};
    }).immediate();
  }
  history(actor:string,id:string) {
    this.task(actor,id,'member');return {changes:this.store.db.prepare('SELECT * FROM op_task_history WHERE task_id=? ORDER BY id').all(id),notes:this.store.db.prepare('SELECT * FROM op_task_notes WHERE task_id=? ORDER BY created_at').all(id)};
  }
}
