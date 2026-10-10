import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,rm,readFile,mkdir,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { PDFDocument } from 'pdf-lib';

test('real stdio process persists two different events, tasks, budgets, proposals and usable PDFs across restart',async()=>{
  const dir=process.env.DARLING_ACCEPTANCE_DIR ? resolve(process.env.DARLING_ACCEPTANCE_DIR) : await mkdtemp(join(tmpdir(),'darling-local-mvp-'));
  await mkdir(dir,{recursive:true});
  const evidence:unknown[]=[];
  async function connect() {
    const client=new Client({name:'local-acceptance',version:'1.0.0'});
    await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/scripts/run-mcp.js')],env:{CAMPUS_EVENT_DB_PATH:join(dir,'events.sqlite'),TALLY_API_KEY:''},stderr:'pipe'}));return client;
  }
  let client=await connect();
  async function call(name:string,args:Record<string,unknown>) {const result=await client.callTool({name,arguments:args});assert.equal(result.isError,undefined,JSON.stringify(result));return (result.structuredContent as {value:any}).value;}
  try {
    for(const [eventId,title,count,ceiling,amount] of [['network','AI networking',50,1500,725.50],['robotics','Robotics workshop',120,5000,4500]] as const) {
      await call('event_create_structured',{eventId,request:{title,attendeeCount:count,budgetLimit:ceiling,currency:'MYR',date:'2026-10-20',timezone:'Asia/Kuala_Lumpur',location:"Taylor's University"},budget:[{item:'Planning estimate',amount,status:'estimate',note:'Not a supplier quote'}],assumptions:['Venue pending']});
      await call('task_create',{eventId,taskId:`${eventId}-plan`,title:'Prepare plan'});
      await call('task_create',{eventId,taskId:`${eventId}-publish`,title:'Publish registration',dependencyIds:[`${eventId}-plan`]});
      await call('task_update',{eventId,taskId:`${eventId}-plan`,expectedRevision:0,description:'Draft planning output',priority:1});
      const stale=await client.callTool({name:'task_update',arguments:{eventId,taskId:`${eventId}-plan`,expectedRevision:0,priority:0}});assert.equal(stale.isError,true);
      const validation=await call('budget_validate',{eventId,validationId:`${eventId}-budget`});assert.ok(validation.checks.every((c:any)=>c.status==='passed'));
      const draft=await call('registration_draft',{eventId,includeDietary:true,deadline:'2026-10-18'});assert.equal(draft.capacity,count);
      const denied=await client.callTool({name:'registration_create',arguments:{eventId,registrationId:`${eventId}-form`,confirmed:false}});assert.equal(denied.isError,true);
      assert.equal((await call('registration_get',{eventId})).forms.length,0);
      await call('proposal_save',{eventId,expectedRevision:0,content:{objectives:['Connect participants'],agenda:[{time:'Proposed 14:00',activity:'Welcome and introductions'}],assignments:[{task:'Venue',assignee:'Organizer - to confirm',status:'proposed'}],vendors:[],pendingApprovals:['Publish registration'],unresolvedIssues:['Room unconfirmed'],invitation:{to:[],subject:`Invitation: ${title}`,body:'Join our event.\\nRegistration link pending publication.',status:'draft'}}});
      const doc=await call('document_generate',{eventId});assert.equal(doc.verified,true);assert.ok((await PDFDocument.load(await readFile(doc.path))).getPageCount()>0);assert.match(await readFile(doc.invitationPath,'utf8'),/UNSENT DRAFT/);assert.match(await readFile(doc.trackerPath,'utf8'),/Publish registration/);
      const tracker=JSON.parse(await readFile(doc.trackerPath,'utf8'));assert.deepEqual(tracker.registrationDraft,draft);assert.equal(tracker.taskDetails.length,2);assert.doesNotMatch(await readFile(doc.invitationPath,'utf8'),/\\n/);
      const summary=await call('event_get',{eventId});assert.equal(summary.event.workflow.total,amount);assert.equal(summary.tasks.length,2);evidence.push({eventId,title,count,budget:summary.event.workflow.total,taskCount:summary.tasks.length,document:doc,registrationStatus:'draft_only'});
    }
    await client.close();client=await connect();
    assert.equal((await call('event_list',{})).length,2);
    assert.equal((await call('event_get',{eventId:'network'})).event.workflow.request.attendeeCount,50);
    assert.equal((await call('proposal_get',{eventId:'robotics'})).revision,1);
    if(process.env.DARLING_ACCEPTANCE_DIR) await writeFile(join(dir,'verification.json'),JSON.stringify({mode:'real_stdio_test_not_WorkBuddy',events:evidence,restartVerified:true},null,2));
  } finally {await client.close();if(!process.env.DARLING_ACCEPTANCE_DIR) await rm(dir,{recursive:true,force:true});}
});

test('Expert manifest resolves required official fields, agent, skill and stdio declaration',async()=>{
  const root=resolve('packages/darlingagent-expert');
  const manifest=JSON.parse(await readFile(join(root,'.codebuddy-plugin/plugin.json'),'utf8'));
  for(const key of ['name','version','description','author','agents','expertType','agentName','displayName','profession','displayDescription','avatar','categoryId','defaultInitPrompt','plugin','tags','quickPrompts']) assert.ok(manifest[key],key);
  assert.equal(manifest.expertType,'agent');assert.equal(manifest.name,manifest.plugin);assert.equal(manifest.tags.length,3);assert.equal(manifest.quickPrompts.length,3);assert.deepEqual(manifest.defaultInitPrompt,manifest.quickPrompts[0]);
  assert.ok(manifest.displayDescription.zh.length>=40 && manifest.displayDescription.zh.length<=50);
  const agent=await readFile(join(root,manifest.agents[0]),'utf8');assert.match(agent,/name: darlingagent/);assert.doesNotMatch(agent,/^tools:/m);
  for(const path of manifest.skills) await readFile(join(root,path,'SKILL.md'));
  const avatar=await readFile(join(root,manifest.avatar));assert.ok(avatar.length<500000);assert.equal(avatar.readUInt32BE(16),512);assert.equal(avatar.readUInt32BE(20),512);
  const mcp=JSON.parse(await readFile(join(root,manifest.dependencies.mcpServers),'utf8'));assert.equal(mcp.mcpServers['darlingagent-local'].command,'node');
});
