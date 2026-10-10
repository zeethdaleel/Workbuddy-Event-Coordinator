import { createRuntime,configFromEnv } from '../operations/runtime.js';
import { createHttpServer } from '../operations/http.js';
const runtime=createRuntime(configFromEnv());
const server=createHttpServer(runtime,{webhookSecret:process.env.TELEGRAM_WEBHOOK_SECRET ?? '',agentToken:process.env.DARLING_AGENT_TOKEN ?? '',agentOwner:process.env.DARLING_AGENT_OWNER ?? ''});
const port=Number(process.env.PORT ?? 3000);
server.listen(port,'0.0.0.0',()=>console.error(`DarlingAgent backend listening on ${port}`));
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>server.close(async()=>{await server.drain();runtime.close();process.exit(0);}));
