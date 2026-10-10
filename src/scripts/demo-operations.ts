import { mkdtemp,copyFile,rm,mkdir,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createRuntime } from '../operations/runtime.js';
const output=resolve(process.argv[2] ?? 'artifacts/operations');await mkdir(output,{recursive:true});
const data=await mkdtemp(join(tmpdir(),'darling-demo-'));
const runtime=createRuntime({dataDirectory:data,telegramToken:'unused-offline-demo',encryptionKey:'ab'.repeat(32),publicUrl:'https://offline.example'},async()=>{throw new Error('Offline demonstration must never call external services');});
runtime.store.user('101','101');
const evidence=[];
try {
  for(const scenario of [
    {name:'networking',title:'AI networking event',eventType:'networking',attendeeCount:50,budgetLimit:1500,items:[['Refreshments',600],['Materials',150],['Venue allowance',350],['Contingency',150]]},
    {name:'robotics',title:'Student robotics competition',eventType:'competition',attendeeCount:120,budgetLimit:5000,items:[['Equipment allowance',1800],['Refreshments',1440],['Prizes',600],['Printing',160],['Contingency',500]]}
  ]) {
    const created=await runtime.dispatch('101','event_create',{
      request:{title:scenario.title,eventType:scenario.eventType,attendeeCount:scenario.attendeeCount,budgetLimit:scenario.budgetLimit,currency:'MYR',date:'2026-10-20',startTime:'16:00',endTime:'18:00',timezone:'Asia/Kuala_Lumpur',location:"Taylor's University"},
      budget:scenario.items.map(([item,amount])=>({item,amount,status:'estimate',note:'Offline demonstration planning estimate; not a vendor quotation.'})),
      assumptions:['Offline verification scenario. No WorkBuddy agent, live vendor research, registration publication or message delivery occurred.','Venue, suppliers and organizer assignments require confirmation.']
    }) as {value:{event:{id:string}}};
    const id=created.value.event.id;
    for(const title of ['Confirm venue availability','Review budget with organizer','Approve registration form','Review invitation recipients','Confirm setup and safety arrangements','Assign event-day check-in owners']) await runtime.dispatch('101','task_create',{eventId:id,title});
    const document=await runtime.documents.proposal('101',id);
    await copyFile(join(data,'documents',`${document.id}.pdf`),join(output,`${scenario.name}-proposal.pdf`));
    const summary=await runtime.events.getSummary(id);evidence.push({scenario:scenario.name,eventId:id,document,summary,verification:'LOCAL_EXECUTION_ONLY'});
  }
  await writeFile(join(output,'verification.json'),JSON.stringify(evidence,null,2));
  console.log(`Created two offline proposals and verification.json in ${output}`);
} finally {runtime.close();await rm(data,{recursive:true,force:true});}
