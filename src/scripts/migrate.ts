import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SqlitePersistence } from '../adapters/sqlite/sqlite-persistence.js';
import { OperationsStore } from '../operations/store.js';
const directory=process.env.DARLING_DATA_DIR;if(!directory) throw new Error('DARLING_DATA_DIR required');
mkdirSync(directory,{recursive:true,mode:0o700});
const path=join(directory,'events.sqlite'),base=new SqlitePersistence(path),operations=new OperationsStore(path);
operations.close();base.close();console.error('Database migrations applied.');
