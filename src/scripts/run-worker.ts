import { createRuntime,configFromEnv } from '../operations/runtime.js';
import { tick } from '../operations/worker.js';
const runtime=createRuntime(configFromEnv());
let stopping=false;
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{stopping=true;});
try {
  while(!stopping) {
    try {await tick(runtime.store,runtime.telegram,runtime.events);} catch {console.error('Worker iteration failed; inspect persisted jobs.');}
    if(!stopping) await new Promise(resolve=>setTimeout(resolve,1000));
  }
} finally {runtime.close();}
