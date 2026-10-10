import { OperationsStore } from './store.js';
import { DeliveryError, TelegramClient } from './telegram.js';
import type { EventApplicationService } from '../core/event-application-service.js';

export async function tick(store: OperationsStore,telegram: TelegramClient,service: EventApplicationService,now = new Date()) {
  store.recover(now);
  const reminder = store.claim(now);
  if (!reminder) return false;
  try {
    let text = reminder.message;
    if (reminder.event_id) store.authorize(reminder.owner,reminder.event_id,'member');
    if (reminder.kind === 'progress') {
      const result = await service.getSummary(reminder.event_id!);
      if (!result.ok) throw new Error('Event unavailable');
      const pending = result.value.tasks.filter(task => task.status !== 'completed' && task.status !== 'cancelled');
      const details=store.db.prepare('SELECT t.id,d.owner_id,d.assignment_status,d.deadline FROM tasks t LEFT JOIN op_task_details d ON d.task_id=t.id WHERE t.event_id=?').all(reminder.event_id) as {id:string;owner_id:string|null;assignment_status:string|null;deadline:string|null}[];
      const rows=pending.map(task=>{
        const detail=details.find(row=>row.id===task.id);
        const overdue=detail?.deadline && new Date(detail.deadline)<now;
        return `${task.title}: ${task.status}; ${detail?.owner_id ? `owner ${detail.owner_id} (${detail.assignment_status})` : 'unassigned'}${detail?.deadline ? `; due ${detail.deadline}${overdue?' OVERDUE':''}`:''}`;
      });
      text = `${reminder.message}\n${result.value.event.workflow.request.title}\n${pending.length} pending tasks:\n${rows.join('\n')}`.slice(0,4000);
    }
    const evidence = await telegram.sendMessage(reminder.chat_id,text);
    store.finish(reminder,{evidence},now);
  } catch(error) {
    store.finish(reminder,error instanceof DeliveryError
      ? {error:error.message,uncertain:error.kind==='uncertain',retryAfter:error.retryAfter}
      : {error:'internal_delivery_failure'},now);
  }
  return true;
}
