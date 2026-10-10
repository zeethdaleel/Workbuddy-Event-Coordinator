import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { createRuntime,type Runtime } from '../operations/runtime.js';
import { prepareStructuredWorkflow,structuredEventSchema } from '../core/structured-event.js';
import { OperationsStore,hash } from '../operations/store.js';
import { Vault } from '../operations/connect.js';
import { TelegramClient,DeliveryError } from '../operations/telegram.js';
import { tick } from '../operations/worker.js';
import { createHttpServer } from '../operations/http.js';

const plan=()=>({request:{title:'AI networking',eventType:'networking',attendeeCount:50,budgetLimit:1500,currency:'MYR',date:'2026-10-20',startTime:'16:00',endTime:'18:00',timezone:'Asia/Kuala_Lumpur',location:"Taylor's University"},budget:[{item:'Refreshments',amount:600,status:'estimate',note:'Planning estimate; supplier quotation pending'},{item:'Materials',amount:125.50,status:'estimate',note:'Planning estimate'}],assumptions:['Venue is not booked.']});
const mockTelegram=(requests:unknown[]=[]):typeof fetch=>async(_url,init)=>{
  requests.push(init?.body);
  const chat=typeof init?.body==='string' ? JSON.parse(init.body).chat_id : (init?.body as FormData).get('chat_id');
  return new Response(JSON.stringify({ok:true,result:{message_id:123,chat:{id:Number(chat)},document:{file_id:'test-file'}}}),{status:200});
};
async function withRuntime(run:(runtime:Runtime,dir:string)=>Promise<void>,transport=mockTelegram()) {
  const dir=await mkdtemp(join(tmpdir(),'darling-ops-'));
  const runtime=createRuntime({dataDirectory:dir,telegramToken:'test-token',encryptionKey:'ab'.repeat(32),publicUrl:'https://example.com'},transport);
  runtime.store.user('101','101');runtime.store.user('202','202');
  try {await run(runtime,dir);} finally {runtime.close();await rm(dir,{recursive:true,force:true});}
}
async function event(runtime:Runtime,owner='101') {
  const result=await runtime.dispatch(owner,'event_create',plan()) as {ok:boolean;value:{event:{id:string}}};assert.equal(result.ok,true);return result.value.event.id;
}

test('structured WorkBuddy plans preserve different events, exact decimals and validation',()=>{
  const first=prepareStructuredWorkflow(structuredEventSchema.parse(plan()));assert.equal(first.total,725.50);assert.equal(first.remainingBudget,774.50);
  const second=plan();second.request.title='Robotics competition';second.request.eventType='competition';second.request.attendeeCount=120;second.request.budgetLimit=400;
  const result=prepareStructuredWorkflow(structuredEventSchema.parse(second));assert.equal(result.request.title,'Robotics competition');assert.equal(result.status,'blocked');
  assert.throws(()=>structuredEventSchema.parse({...plan(),request:{...plan().request,attendeeCount:-1}}));
  assert.throws(()=>structuredEventSchema.parse({...plan(),budget:[{item:'Bad',amount:NaN,status:'estimate',note:'Bad'}]}));
  assert.throws(()=>structuredEventSchema.parse({...plan(),request:{...plan().request,timezone:'Not/AZone'}}));
});

test('owned event, context and schema survive reopen; other users cannot access',async()=>{
  await withRuntime(async(runtime,dir)=>{
    const id=await event(runtime);
    await assert.rejects(runtime.dispatch('202','event_get',{eventId:id}),/denied/);
    const reopened=new OperationsStore(join(dir,'events.sqlite'));
    try {assert.equal(reopened.current('101'),id);assert.deepEqual(reopened.events('202'),[]);assert.throws(()=>reopened.own('202',id));}
    finally {reopened.close();}
  });
});

test('event update enforces revision and cancels old approvals',async()=>{
  await withRuntime(async runtime=>{
    const id=await event(runtime),action=runtime.store.action('101',id,'gmail',{subject:'Original'});
    await runtime.dispatch('101','event_update',{...plan(),request:{...plan().request,attendeeCount:100},eventId:id,expectedRevision:0});
    assert.equal(runtime.store.getAction('101',action.id)?.status,'CANCELLED');
    await assert.rejects(runtime.dispatch('101','event_update',{...plan(),eventId:id,expectedRevision:0}),/revision/);
    assert.equal((await runtime.events.getEvent(id)).ok,true);
  });
});

test('task start waits for dependencies and rejects cross-event dependencies',async()=>{
  await withRuntime(async runtime=>{
    const id=await event(runtime),other=await event(runtime);
    const first=await runtime.events.createTask({id:'one',eventId:id,title:'First',status:'queued'});assert.equal(first.ok,true);
    await runtime.events.createTask({id:'two',eventId:id,title:'Second',status:'queued'},['one']);
    assert.deepEqual(await runtime.events.transitionTask('two',0,'in_progress'),{ok:false,reason:'dependency_unmet'});
    assert.deepEqual(await runtime.events.createTask({id:'bad',eventId:other,title:'Bad',status:'queued'},['one']),{ok:false,reason:'not_found'});
  });
});

test('PDF is real, multipage, owned, hashed and immutable',async()=>{
  await withRuntime(async runtime=>{
    const input=plan();input.assumptions=Array.from({length:80},(_,i)=>`Assumption ${i}: Venue and supplier availability remain unverified; this proposal is a draft for organizer review.`);
    const result=await runtime.dispatch('101','event_create',input) as {value:{event:{id:string}}};
    const doc=await runtime.documents.proposal('101',result.value.event.id);
    assert.ok(doc.pages>1);
    const bytes=await runtime.documents.read('101',doc.id);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
    const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),doc.pages);
    await assert.rejects(runtime.documents.read('202',doc.id),/denied/);
    await runtime.dispatch('101','document_deliver',{documentId:doc.id});
    const audit=runtime.store.db.prepare("SELECT * FROM op_audit WHERE operation='document.telegram_acknowledged'").all();assert.equal(audit.length,1);
    const path=(runtime.store.db.prepare('SELECT path FROM op_documents WHERE id=?').get(doc.id) as {path:string}).path;
    await writeFile(path,'corrupted');await assert.rejects(runtime.documents.read('101',doc.id),/integrity/);
  });
});

test('reminder claim is exclusive across connections and delivery survives worker restart',async()=>{
  await withRuntime(async(runtime,dir)=>{
    const now=new Date('2030-01-01T00:00:00Z');
    const reminder=runtime.store.schedule('101',{message:'Review',nextAt:'2030-01-01T01:00:00+00:00',timezone:'Asia/Kuala_Lumpur'},now);
    const second=new OperationsStore(join(dir,'events.sqlite'));
    try {
      const claimed=runtime.store.claim(new Date('2030-01-01T01:00:01Z'))!;assert.equal(claimed.id,reminder.id);assert.equal(second.claim(new Date('2030-01-01T01:00:01Z')),undefined);
      second.recover(new Date('2030-01-01T01:03:01Z'));assert.equal(second.reminder('101',reminder.id)?.status,'uncertain');
      assert.equal(second.claim(new Date('2030-01-01T02:00:00Z')),undefined);
    } finally {second.close();}
  });
});

test('daily recurrence preserves local time across DST and skips missed occurrences',async()=>{
  await withRuntime(async runtime=>{
    const reminder=runtime.store.schedule('101',{message:'Daily',nextAt:'2030-03-09T09:00:00-05:00',timezone:'America/New_York',recurrence:'daily'},new Date('2030-03-08T00:00:00Z'));
    await tick(runtime.store,runtime.telegram,runtime.events,new Date('2030-03-09T14:00:01Z'));
    const saved=runtime.store.reminder('101',reminder.id)!;assert.equal(saved.next_at,'2030-03-10T13:00:00.000Z');assert.equal(saved.status,'scheduled');assert.ok(saved.evidence?.includes('messageId'));
    await tick(runtime.store,runtime.telegram,runtime.events,new Date('2030-03-15T14:00:01Z'));
    assert.equal(runtime.store.reminder('101',reminder.id)?.next_at,'2030-03-16T13:00:00.000Z');
  });
});

test('one-time reminder retries explicit rate limits but not uncertain sends',async()=>{
  await withRuntime(async runtime=>{
    const start=new Date('2030-01-01T00:00:00Z'),due=new Date('2030-01-01T01:00:01Z');
    const reminder=runtime.store.schedule('101',{message:'Once',nextAt:'2030-01-01T01:00:00Z',timezone:'UTC'},start);
    const rate=new TelegramClient('token',async()=>new Response(JSON.stringify({ok:false,parameters:{retry_after:10}}),{status:429}));
    await tick(runtime.store,rate,runtime.events,due);assert.equal(runtime.store.reminder('101',reminder.id)?.next_at,'2030-01-01T01:00:11.000Z');
    const uncertain=new TelegramClient('token',async()=>{throw new Error('network token secret must never escape');});
    await tick(runtime.store,uncertain,runtime.events,new Date('2030-01-01T01:00:12Z'));
    assert.equal(runtime.store.reminder('101',reminder.id)?.status,'uncertain');assert.equal(runtime.store.claim(new Date('2030-02-01T00:00:00Z')),undefined);
    assert.throws(()=>runtime.store.changeReminder('202',reminder.id));
    runtime.store.changeReminder('101',reminder.id);assert.equal(runtime.store.reminder('101',reminder.id)?.status,'cancelled');
  });
});

test('approval is owner-, content-, expiry- and single-execution-bound',async()=>{
  await withRuntime(async runtime=>{
    const id=await event(runtime),action=runtime.store.action('101',id,'gmail',{to:'person@example.com',body:'Approved content'}),digest=action.payload_hash.slice(0,16);
    assert.throws(()=>runtime.store.decide('202',action.id,'approve',digest));assert.throws(()=>runtime.store.decide('101',action.id,'approve','bad'));
    assert.throws(()=>runtime.store.claimAction('101',action.id));runtime.store.decide('101',action.id,'approve',digest);
    assert.equal(runtime.store.claimAction('101',action.id).id,action.id);assert.throws(()=>runtime.store.claimAction('101',action.id));
    const expired=runtime.store.action('101',id,'gmail',{});runtime.store.db.prepare("UPDATE op_actions SET expires_at='2000-01-01' WHERE id=?").run(expired.id);
    assert.throws(()=>runtime.store.decide('101',expired.id,'approve',expired.payload_hash.slice(0,16)));
  });
});

test('AES-GCM detects tampering and prevents cross-account credential substitution',()=>{
  const vault=new Vault('ab'.repeat(32)),sealed=vault.seal({refresh_token:'private'},'101:gmail');
  assert.ok(!sealed.includes('private'));assert.deepEqual(vault.open(sealed,'101:gmail'),{refresh_token:'private'});
  assert.throws(()=>vault.open(sealed,'202:gmail'));assert.throws(()=>new Vault('short'));
});

test('request journal prevents duplicate execution and detects changed payloads',async()=>{
  await withRuntime(async runtime=>{
    const id=randomUUID();assert.equal(runtime.store.request('101',id,'hash').claimed,true);
    assert.equal(runtime.store.request('101',id,'hash').claimed,false);
    assert.throws(()=>runtime.store.request('101',id,'changed'));assert.throws(()=>runtime.store.request('202',id,'hash'));
    runtime.store.requestFinished('101',id,{eventId:'saved'});assert.deepEqual(runtime.store.request('101',id,'hash').result,{eventId:'saved'});
  });
});

test('HTTP rejects forged webhooks, duplicate updates and unscoped agent access',async()=>{
  await withRuntime(async runtime=>{
    const server=createHttpServer(runtime,{webhookSecret:'w'.repeat(32),agentToken:'a'.repeat(32),agentOwner:'101'});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address() as {port:number},url=`http://127.0.0.1:${address.port}`;
    try {
      assert.equal((await fetch(`${url}/health`)).status,200);
      const update={update_id:1,message:{from:{id:101},chat:{id:101,type:'private'},text:'Create an event'}};
      assert.equal((await fetch(`${url}/telegram/webhook`,{method:'POST',body:JSON.stringify(update)})).status,401);
      const post=()=>fetch(`${url}/telegram/webhook`,{method:'POST',headers:{'x-telegram-bot-api-secret-token':'w'.repeat(32)},body:JSON.stringify(update)});
      assert.equal((await post()).status,200);assert.deepEqual(await (await post()).json(),{duplicate:true});
      const input={operation:'event_create',input:plan(),requestId:randomUUID()};
      assert.equal((await fetch(`${url}/agent`,{method:'POST',body:JSON.stringify(input)})).status,401);
      const agent=()=>fetch(`${url}/agent`,{method:'POST',headers:{Authorization:`Bearer ${'a'.repeat(32)}`},body:JSON.stringify(input)});
      assert.equal((await agent()).status,200);assert.equal((await agent()).status,200);assert.equal(runtime.store.events('101').length,1);
      assert.equal((await fetch(`${url}/oauth/callback?state=forged&code=anything`)).status,403);
    } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error ? reject(error):resolve()));}
  });
});

test('Gmail exact approval sends once and records provider acknowledgment (mocked)',async()=>{
  await withRuntime(async runtime=>{
    const id=await event(runtime);
    runtime.store.db.prepare("INSERT INTO op_connections VALUES(?,? ,?,'CONNECTED',?,?)").run('101','gmail',runtime.connections.vault.seal({access_token:'mock'},'101:gmail'),'organizer@example.com',new Date().toISOString());
    let calls=0,raw='';
    runtime.connections.google=async()=>({request:async(options:{data:{raw:string}})=>{calls++;raw=Buffer.from(options.data.raw,'base64url').toString();return {data:{id:'gmail-message',threadId:'thread'}};}} as never);
    const action=await runtime.actions.prepare('101',id,'gmail',{to:['recipient@example.com'],subject:'Invitation',body:'Exact approved invitation',documentIds:[]});
    await assert.rejects(runtime.actions.execute('101',action.id),/approval/i);assert.equal(calls,0);
    const stored=runtime.store.getAction('101',action.id)!;runtime.store.decide('101',action.id,'approve',stored.payload_hash.slice(0,16));
    const sent=await runtime.actions.execute('101',action.id);assert.equal(sent.status,'COMPLETED');assert.match(sent.evidence!,/gmail-message/);
    assert.match(raw,/To: recipient@example.com/);assert.ok(raw.includes(Buffer.from('Exact approved invitation').toString('base64')));
    await assert.rejects(runtime.actions.execute('101',action.id));assert.equal(calls,1);
  });
});

test('connection resumption preserves pending draft and requires new approval',async()=>{
  await withRuntime(async runtime=>{
    const id=await event(runtime),action=await runtime.actions.prepare('101',id,'gmail',{to:['recipient@example.com'],subject:'Pending',body:'Keep this content'});
    assert.equal(action.status,'WAITING_FOR_CONNECTION');
    runtime.store.db.prepare("INSERT INTO op_connections VALUES(?,?,?,'CONNECTED',?,?)").run('101','gmail',runtime.connections.vault.seal({},'101:gmail'),'organizer@example.com',new Date().toISOString());
    const reviewed=await runtime.actions.review('101',action.id);assert.equal(reviewed.status,'WAITING_FOR_APPROVAL');
    assert.match(reviewed.payload,/Keep this content/);assert.throws(()=>runtime.store.claimAction('101',action.id));
  });
});

test('connection sessions expire, are provider bound and cannot be replayed',async()=>{
  await withRuntime(async runtime=>{
    const link=await runtime.connections.begin('101','tally'),token=new URL(link).searchParams.get('session')!;
    assert.equal(runtime.connections.session(token).owner,'101');
    assert.throws(()=>runtime.connections.authorizeUrl(token),/Wrong/);
    runtime.store.db.prepare('UPDATE op_sessions SET used=1 WHERE token_hash=?').run(hash(token));assert.throws(()=>runtime.connections.session(token),/expired or used/);
    const second=new URL(await runtime.connections.begin('101','tally')).searchParams.get('session')!;
    runtime.store.db.prepare("UPDATE op_sessions SET expires_at='2000-01-01' WHERE token_hash=?").run(hash(second));assert.throws(()=>runtime.connections.session(second));
  });
});

test('Telegram rejects misleading acknowledgments and never leaks token-bearing network failures',async()=>{
  const client=new TelegramClient('secret',async()=>new Response(JSON.stringify({ok:true,result:{message_id:1,chat:{id:999}}}),{status:200}));
  await assert.rejects(client.sendMessage('101','Hello'),(error:unknown)=>error instanceof DeliveryError && error.kind==='uncertain');
  const network=new TelegramClient('secret',async()=>{throw new Error('https://api.telegram.org/botsecret/sendMessage');});
  await assert.rejects(network.sendMessage('101','Hello'),(error:unknown)=>error instanceof Error && !error.message.includes('secret'));
});

test('Google OAuth validates identity, scopes and PKCE before encrypted persistence (mocked)',async()=>{
  await withRuntime(async runtime=>{
    let observedVerifier='';
    runtime.connections.client=()=>({
      generateCodeVerifierAsync:async()=>({codeVerifier:'test-pkce-verifier'}),
      getToken:async(input:{codeVerifier:string})=>{observedVerifier=input.codeVerifier;return {tokens:{access_token:'private-access',refresh_token:'private-refresh',id_token:'private-id'}};},
      verifyIdToken:async()=>({getPayload:()=>({email_verified:true,email:'verified@example.com'})}),
      getTokenInfo:async()=>({scopes:['https://www.googleapis.com/auth/gmail.send']})
    } as never);
    const link=await runtime.connections.begin('101','gmail'),token=new URL(link).searchParams.get('session')!;
    await runtime.connections.callback(token,'authorization-code');assert.equal(observedVerifier,'test-pkce-verifier');
    assert.ok(JSON.stringify(runtime.connections.list('101')).includes('verified@example.com'));
    const stored=runtime.store.db.prepare('SELECT encrypted FROM op_connections WHERE owner=?').get('101') as {encrypted:string};
    assert.ok(!stored.encrypted.includes('private'));assert.throws(()=>runtime.connections.credential('202','gmail'));
    await assert.rejects(runtime.connections.callback(token,'replayed'));
  });
});

test('calendar and Drive adapters retain provider IDs and private-upload policy (mocked)',async()=>{
  await withRuntime(async runtime=>{
    const eventId=await event(runtime),doc=await runtime.documents.proposal('101',eventId),requests:{url:string;params?:unknown;data?:unknown}[]=[];
    for(const provider of ['calendar','drive']) runtime.store.db.prepare("INSERT INTO op_connections VALUES(?,?,?,'CONNECTED',?,?)").run('101',provider,runtime.connections.vault.seal({},`101:${provider}`),'organizer@example.com',new Date().toISOString());
    runtime.connections.google=async()=>({request:async(options:{url:string;params?:unknown;data?:unknown})=>{requests.push(options);return {data:{id:'provider-id',htmlLink:'https://calendar.google.com/event'}};}} as never);
    for(const [kind,payload] of [
      ['calendar',{summary:'Planning',start:'2030-01-01T16:00:00+08:00',end:'2030-01-01T18:00:00+08:00',timezone:'Asia/Kuala_Lumpur'}],
      ['drive',{documentId:doc.id}]
    ] as const) {
      const prepared=await runtime.actions.prepare('101',eventId,kind,payload),saved=runtime.store.getAction('101',prepared.id)!;
      runtime.store.decide('101',prepared.id,'approve',saved.payload_hash.slice(0,16));
      const result=await runtime.actions.execute('101',prepared.id);assert.equal(result.status,'COMPLETED');assert.match(result.evidence!,/provider-id/);
      if(kind==='drive') assert.match(result.evidence!,/private/);
    }
    assert.deepEqual(requests[0]?.params,{sendUpdates:'none'});
    assert.ok(!requests.some(request=>request.url.includes('permissions')));
  });
});

test('approved Gmail network ambiguity is held and never automatically sent again (mocked)',async()=>{
  await withRuntime(async runtime=>{
    const eventId=await event(runtime);let sends=0;
    runtime.store.db.prepare("INSERT INTO op_connections VALUES(?,?,?,'CONNECTED',?,?)").run('101','gmail',runtime.connections.vault.seal({},'101:gmail'),'organizer@example.com',new Date().toISOString());
    runtime.connections.google=async()=>({request:async()=>{sends++;throw new Error('lost acknowledgment');}} as never);
    const prepared=await runtime.actions.prepare('101',eventId,'gmail',{to:['recipient@example.com'],subject:'Once',body:'Do not duplicate'}),saved=runtime.store.getAction('101',prepared.id)!;
    runtime.store.decide('101',prepared.id,'approve',saved.payload_hash.slice(0,16));
    assert.equal((await runtime.actions.execute('101',prepared.id)).status,'UNCERTAIN');
    await assert.rejects(runtime.actions.execute('101',prepared.id));assert.equal(sends,1);
  });
});

test('tool-verifiable task completion unlocks dependents and rejects invented evidence',async()=>{
  await withRuntime(async runtime=>{
    const eventId=await event(runtime);
    const first=await runtime.dispatch('101','task_create',{eventId,title:'Validate budget',outputKind:'budget'}) as {value:{id:string}};
    const second=await runtime.dispatch('101','task_create',{eventId,title:'Generate proposal',outputKind:'document',dependencyIds:[first.value.id]}) as {value:{id:string}};
    await runtime.dispatch('101','task_start',{taskId:first.value.id,expectedRevision:0});
    const completed=await runtime.dispatch('101','task_complete',{taskId:first.value.id,expectedRevision:1}) as {ok:boolean};assert.equal(completed.ok,true);
    assert.equal((await runtime.dispatch('101','task_start',{taskId:second.value.id,expectedRevision:0}) as {ok:boolean}).ok,true);
    await assert.rejects(runtime.dispatch('101','task_complete',{taskId:second.value.id,expectedRevision:1,evidenceId:'made-up'}));
    const doc=await runtime.documents.proposal('101',eventId);
    assert.equal((await runtime.dispatch('101','task_complete',{taskId:second.value.id,expectedRevision:1,evidenceId:doc.id}) as {ok:boolean}).ok,true);
  });
});

test('team invitations bind identity and task assignments require recipient acceptance',async()=>{
  await withRuntime(async runtime=>{
    const id=await event(runtime);
    await runtime.events.createTask({id:'team-task',eventId:id,title:'Book venue',status:'queued'});
    assert.throws(()=>runtime.team.edit('101',{taskId:'team-task',expectedRevision:0,assignee:'202'}),/denied/);
    const invitation=runtime.team.invite('101',id,'202'),token=invitation.joinCommand.split(' ')[1];
    assert.throws(()=>runtime.team.join('101',token));runtime.team.join('202',token);assert.throws(()=>runtime.team.join('202',token));
    runtime.team.edit('101',{taskId:'team-task',expectedRevision:0,assignee:'202',deadline:'2027-01-01T10:00:00Z',priority:0});
    assert.throws(()=>runtime.team.respond('101','team-task',true));
    runtime.team.respond('202','team-task',true);
    assert.throws(()=>runtime.team.edit('101',{taskId:'team-task',expectedRevision:1,description:'Stale'}),/revision/);
    assert.throws(()=>runtime.team.edit('202',{taskId:'team-task',expectedRevision:2,description:'Unauthorized'}),/denied/);
    runtime.team.note('202',{taskId:'team-task',text:'Venue quote requested'});
    assert.equal(runtime.team.history('101','team-task').notes.length,1);
    const cancelled=await runtime.dispatch('101','task_cancel',{taskId:'team-task',expectedRevision:2}) as {ok:boolean};assert.equal(cancelled.ok,true);
    assert.equal((await runtime.persistence.tasks.get('team-task'))?.status,'cancelled');
    const reopened=await runtime.dispatch('101','task_reopen',{taskId:'team-task',expectedRevision:3}) as {ok:boolean};assert.equal(reopened.ok,true);
    assert.equal((await runtime.persistence.tasks.get('team-task'))?.status,'queued');
  });
});

test('task table rebuild preserves dependencies, operational references and integrity triggers',async()=>{
  await withRuntime(async(runtime,dir)=>{
    const id=await event(runtime);
    await runtime.events.createTask({id:'upgrade-one',eventId:id,title:'One',status:'queued'});
    await runtime.events.createTask({id:'upgrade-two',eventId:id,title:'Two',status:'queued'},['upgrade-one']);
    runtime.team.edit('101',{taskId:'upgrade-one',expectedRevision:0,description:'Keep this'});
    runtime.store.db.prepare('DELETE FROM schema_migrations WHERE version=2').run();
    const {SqlitePersistence}=await import('../adapters/sqlite/sqlite-persistence.js');
    const upgraded=new SqlitePersistence(join(dir,'events.sqlite'));
    try {
      assert.equal(upgraded.schemaVersion(),2);
      assert.equal((await upgraded.tasks.get('upgrade-one'))?.revision,1);
      assert.equal((runtime.team.list('101',id)[0] as {description:string}).description,'Keep this');
      const start=await runtime.events.transitionTask('upgrade-two',0,'in_progress');assert.equal(start.ok,false);
      assert.deepEqual(runtime.store.db.pragma('foreign_key_check'),[]);
      assert.equal((await runtime.dispatch('101','task_cancel',{taskId:'upgrade-one',expectedRevision:1}) as {ok:boolean}).ok,true);
    } finally {upgraded.close();}
  });
});

test('progress reports show overdue assignments and omit cancelled tasks',async()=>{
  const requests:unknown[]=[];
  await withRuntime(async runtime=>{
    const id=await event(runtime);
    await runtime.events.createTask({id:'overdue',eventId:id,title:'Venue booking',status:'queued'});
    await runtime.events.createTask({id:'cancelled-report',eventId:id,title:'Removed task',status:'queued'});
    runtime.team.edit('101',{taskId:'overdue',expectedRevision:0,deadline:'2020-01-01T00:00:00Z'});
    await runtime.dispatch('101','task_cancel',{taskId:'cancelled-report',expectedRevision:0});
    runtime.store.schedule('101',{message:'Weekly review',eventId:id,kind:'progress',nextAt:'2020-01-02T00:00:00Z',timezone:'UTC'},new Date('2020-01-01'));
    await tick(runtime.store,runtime.telegram,runtime.events,new Date('2020-01-03'));
    const body=JSON.parse(requests[0] as string);assert.match(body.text,/OVERDUE/);assert.match(body.text,/unassigned/);assert.doesNotMatch(body.text,/Removed task/);
  },mockTelegram(requests));
});
