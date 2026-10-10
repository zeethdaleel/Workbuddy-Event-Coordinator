#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { operationNames } from '../operations/runtime.js';
const url=process.env.DARLING_BACKEND_URL,token=process.env.DARLING_AGENT_TOKEN;
if(!url || new URL(url).protocol!=='https:' || !token || token.length<32) throw new Error('HTTPS DARLING_BACKEND_URL and DARLING_AGENT_TOKEN required');
serveStdio(()=>{
  const server=new McpServer({name:'darling-operations',version:'0.2.0'});
  server.registerTool('darling_operations',{
    title:'DarlingAgent event operations',
    description:'Authenticated backend for one configured Telegram owner. WorkBuddy interprets and plans. Call inbox_list to retrieve saved requests, event_create with structured request/budget/assumptions, event_get before changes. Mutations require the user request. External actions are only prepared; human approval comes through Telegram, never this tool. Read docs/OPERATIONS.md for operation inputs. No cloud WorkBuddy execution is claimed.',
    inputSchema:z.object({requestId:z.uuid().describe("Fresh UUID per logical operation; reuse exactly on transport retry."),operation:z.enum(operationNames),input:z.record(z.string(),z.unknown()).default({})})
  },async input=>{
    try {
      const response=await fetch(`${url.replace(/\/$/,'')}/agent`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(60000)});
      const data=await response.json();
      return {isError:!response.ok,content:[{type:'text' as const,text:JSON.stringify(data)}]};
    } catch {return {isError:true,content:[{type:'text' as const,text:'Backend response unavailable. Inspect persisted status before repeating a mutation.'}]};}
  });return server;
});
