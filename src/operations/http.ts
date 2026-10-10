import { createServer,type IncomingMessage,type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { hash } from './store.js';
import { operationNames,type Runtime } from './runtime.js';
import { providers,type Provider } from './connect.js';

export function secretEquals(actual:unknown,expected:string) {return typeof actual==='string' && actual.length===expected.length && timingSafeEqual(Buffer.from(actual),Buffer.from(expected));}
async function body(req:IncomingMessage) {let data='';for await(const chunk of req) {data+=chunk;if(Buffer.byteLength(data)>128000) throw new Error('Request too large');}return data;}
const user=z.object({id:z.number().int().positive(),is_bot:z.boolean().optional()});
const chat=z.object({id:z.number().int(),type:z.string()});
const updateSchema=z.object({update_id:z.number().int(),message:z.object({from:user,chat,text:z.string().max(10000).optional()}).optional(),callback_query:z.object({id:z.string(),from:user,data:z.string().max(100),message:z.object({chat}).optional()}).optional()});
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function createHttpServer(runtime:Runtime,config:{webhookSecret:string;agentToken:string;agentOwner:string}) {
  if(config.webhookSecret.length<32 || config.agentToken.length<32 || !/^\d+$/.test(config.agentOwner)) throw new Error('Strong webhook/agent secrets and a Telegram owner ID are required');
  const rates=new Map<string,{start:number;count:number}>();
  const inFlight=new Set<Promise<void>>();
  const handle=async(req:IncomingMessage,res:ServerResponse)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    const html=(text:string)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Darling Connect</title><body><h1>Darling Connect</h1>${text}</body></html>`);};
    try {
      const url=new URL(req.url ?? '/',runtime.connections.config.publicUrl);
      if(req.method==='GET' && url.pathname==='/health') {runtime.store.db.prepare('SELECT 1').get();return json(200,{status:'ok',workbuddyCloud:'NOT_VERIFIED'});}
      const address=req.socket.remoteAddress ?? 'unknown',now=Date.now(),rate=rates.get(address);
      if(rates.size>10000) for(const [key,value] of rates) if(now-value.start>60000) rates.delete(key);
      if(!rate || now-rate.start>60000) rates.set(address,{start:now,count:1});else if(++rate.count>120) return json(429,{error:'rate_limited'});
      if(req.method==='POST' && url.pathname==='/agent') {
        if(!secretEquals(req.headers.authorization,`Bearer ${config.agentToken}`)) return json(401,{error:'unauthorized'});
        const input=z.object({operation:z.enum(operationNames),input:z.unknown(),requestId:z.uuid()}).strict().parse(JSON.parse(await body(req)));
        runtime.store.chat(config.agentOwner);
        const claim=runtime.store.request(config.agentOwner,input.requestId,hash(JSON.stringify({operation:input.operation,input:input.input})));
        if(!claim.claimed) return json(200,{ok:true,result:claim.result});
        try {
          const result=await runtime.dispatch(config.agentOwner,input.operation,input.input);
          runtime.store.requestFinished(config.agentOwner,input.requestId,result);return json(200,{ok:true,result});
        } catch {
          const result={status:'FAILED_OR_UNCERTAIN',requestId:input.requestId,next:'Inspect saved state before using a new request ID.'};
          runtime.store.requestFinished(config.agentOwner,input.requestId,result);return json(400,result);
        }
      }
      if(req.method==='POST' && url.pathname==='/telegram/webhook') {
        if(!secretEquals(req.headers['x-telegram-bot-api-secret-token'],config.webhookSecret)) return json(401,{error:'unauthorized'});
        const update=updateSchema.parse(JSON.parse(await body(req)));
        const sender=update.message?.from ?? update.callback_query?.from,destination=update.message?.chat ?? update.callback_query?.message?.chat;
        if(!sender || sender.is_bot || !destination || destination.type!=='private' || String(sender.id)!==String(destination.id)) return json(200,{ignored:'private_chat_required'});
        const owner=String(sender.id);runtime.store.user(owner,String(destination.id));
        const text=update.message?.text ?? update.callback_query?.data ?? '';
        if(!runtime.store.enqueue(update.update_id,owner,text)) return json(200,{duplicate:true});
        // Durable inbox is committed before acknowledgment. WorkBuddy consumes natural language later.
        json(200,{accepted:true});
        try {
          await handleTelegram(runtime,owner,text,Boolean(update.callback_query));
          if(text.startsWith('/') || update.callback_query) runtime.store.db.prepare("UPDATE op_inbox SET status='completed' WHERE id=?").run(update.update_id);
        }
        catch {runtime.store.audit(owner,'telegram.command_failed',String(update.update_id));await runtime.telegram.sendMessage(owner,'This operation could not be completed. Check its saved status before retrying; reconnect if needed.').catch(()=>{});}
        return;
      }
      if(req.method==='GET' && url.pathname.startsWith('/connect/')) {
        const token=url.searchParams.get('session') ?? '',session=runtime.connections.session(token);
        if(url.pathname!==`/connect/${session.provider}`) return json(400,{error:'invalid_provider'});
        res.setHeader('Set-Cookie',`darling_connect=${hash(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
        if(session.provider==='tally') return html(`<p>Enter your Tally API key. It is encrypted on this server.</p><p><a href="https://developers.tally.so/">Official API-key instructions</a></p><form method="post" action="/connect/tally"><input type="hidden" name="session" value="${escape(token)}"><label>API key <input type="password" name="key" required autocomplete="off"></label><button>Connect Tally</button></form>`);
        res.writeHead(302,{Location:runtime.connections.authorizeUrl(token)});res.end();return;
      }
      if((req.method==='GET' && url.pathname==='/oauth/callback') || (req.method==='POST' && url.pathname==='/connect/tally')) {
        const form=req.method==='POST' ? new URLSearchParams(await body(req)) : url.searchParams;
        const token=form.get(req.method==='POST' ? 'session':'state') ?? '';
        const cookie=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('darling_connect='))?.split('=')[1];
        if(!secretEquals(cookie,hash(token))) return json(403,{error:'invalid_browser_session'});
        const session=req.method==='POST' ? await runtime.connections.tally(token,form.get('key') ?? '') : await runtime.connections.callback(token,form.get('code') ?? '');
        res.setHeader('Set-Cookie','darling_connect=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
        html('<p>Account connected. Return to Telegram to review your pending actions. Nothing has been sent or published.</p>');
        await runtime.telegram.sendMessage(runtime.store.chat(session.owner),`${providers[session.provider].name} connected. Use /pending to resume an action and review its exact contents.`).catch(()=>{});return;
      }
      json(404,{error:'not_found'});
    } catch {
      // Never return raw provider/validation errors: they can contain credentials or private payloads.
      if(!res.headersSent) json(400,{error:'request_failed',next:'Check inputs, connection status and saved action status.'});else if(!res.writableEnded) res.end();
    }
  };
  const server=createServer((req,res)=>{const task=handle(req,res);inFlight.add(task);void task.finally(()=>inFlight.delete(task));});
  server.requestTimeout=30000;server.headersTimeout=15000;return Object.assign(server,{async drain(){await Promise.allSettled([...inFlight]);}});
}
async function handleTelegram(runtime:Runtime,owner:string,text:string,callback:boolean) {
  const send=(message:string)=>runtime.telegram.sendMessage(owner,message.slice(0,4000));
  if(callback) {
    const match=text.match(/^(a|r):([0-9a-f-]{36}):([0-9a-f]{16})$/);if(!match) return;
    runtime.store.decide(owner,match[2],match[1]==='a' ? 'approve':'reject',match[3]);
    if(match[1]==='a') {const action=await runtime.actions.execute(owner,match[2]);await send(`${action.status}: ${action.evidence ?? action.error ?? action.id}`);}
    else await send('Action rejected.');return;
  }
  const [command,arg,...rest]=text.trim().split(/\s+/);
  if(command==='/start' || command==='/help') {await send('DarlingAgent operations connected. Commands: /join TOKEN, /accept TASK_ID, /decline TASK_ID, /tasks, /events, /use EVENT_ID, /status, /connections, /connect gmail|calendar|drive|tally, /reconnect PROVIDER, /disconnect PROVIDER, /pending, /review ACTION_ID, /reminders, /cancel REMINDER_ID, /snooze REMINDER_ID ISO_TIME, /pdf. Natural-language requests are saved for your WorkBuddy coordinator. Cloud AI execution is not connected.');return;}
  if(command==='/join') {await send(JSON.stringify(runtime.team.join(owner,arg)));return;}
  if(command==='/accept' || command==='/decline') {await send(JSON.stringify(runtime.team.respond(owner,arg,command==='/accept')));return;}
  if(command==='/tasks') {const event=runtime.store.current(owner);if(!event) throw new Error('Select an event first');await send(JSON.stringify(runtime.team.list(owner,event)));return;}
  if(command==='/connections') {await send(JSON.stringify(runtime.connections.list(owner),null,2));return;}
  if(command==='/connect' || command==='/reconnect' || command==='/disconnect') {
    if(!Object.hasOwn(providers,arg)) {await send('Choose gmail, calendar, drive or tally.');return;}
    if(command==='/disconnect') {await send(JSON.stringify(await runtime.connections.disconnect(owner,arg as Provider)));return;}
    const url=await runtime.connections.begin(owner,arg as Provider);
    await runtime.telegram.sendMessage(owner,`Connect ${providers[arg as Provider].name} on the secure page. Never send credentials in chat.`,{inline_keyboard:[[{text:`Connect ${providers[arg as Provider].name}`,url}]]});return;
  }
  if(command==='/pending') {await send(JSON.stringify(runtime.store.db.prepare("SELECT id,kind,status,error FROM op_actions WHERE owner=? AND status!='COMPLETED' ORDER BY created_at DESC LIMIT 20").all(owner),null,2));return;}
  if(command==='/review') {await runtime.actions.review(owner,arg);return;}
  if(command==='/events') {await send(JSON.stringify(runtime.store.events(owner)));return;}
  if(command==='/use') {runtime.store.select(owner,arg);await send(`Selected ${arg}`);return;}
  if(command==='/reminders') {await send(JSON.stringify(runtime.store.reminders(owner),null,2));return;}
  if(command==='/cancel' || command==='/snooze') {runtime.store.changeReminder(owner,arg,command==='/snooze' ? rest[0] : undefined);await send('Reminder updated.');return;}
  if(command==='/status' || command==='/pdf') {
    const event=runtime.store.current(owner);if(!event) {await send('No current event. Create one through WorkBuddy or use /use EVENT_ID.');return;}
    if(command==='/status') {const summary=await runtime.dispatch(owner,'event_get',{eventId:event});await send(JSON.stringify(summary));return;}
    const doc=await runtime.documents.proposal(owner,event);await runtime.dispatch(owner,'document_deliver',{documentId:doc.id});return;
  }
  await send('Request saved for WorkBuddy. The desktop coordinator must be running and explicitly consume the inbox; autonomous cloud execution is not available.');
}
