import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { OAuth2Client,CodeChallengeMethod,type Credentials } from 'google-auth-library';
import { OperationsStore,hash } from './store.js';
import { TallyClient } from '../adapters/tally/tally-client.js';

export const providers = {
  gmail: {name:'Gmail',scope:'https://www.googleapis.com/auth/gmail.send',capabilities:['approved_email_send'],auth:'oauth'},
  calendar: {name:'Google Calendar',scope:'https://www.googleapis.com/auth/calendar.events',capabilities:['calendar_event_create'],auth:'oauth'},
  drive: {name:'Google Drive',scope:'https://www.googleapis.com/auth/drive.file',capabilities:['private_file_upload'],auth:'oauth'},
  tally: {name:'Tally',scope:'',capabilities:['registration_publish'],auth:'api_key'}
} as const;
export type Provider = keyof typeof providers;
export class Vault {
  private key: Buffer;
  constructor(key: string) {
    if (!/^[0-9a-f]{64}$/i.test(key)) throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters');
    this.key=Buffer.from(key,'hex');
  }
  seal(value: unknown,context: string) {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv); cipher.setAAD(Buffer.from(context));
    const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return [iv,cipher.getAuthTag(),data].map(b=>b.toString('base64url')).join('.');
  }
  open<T>(value: string,context: string): T {
    const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64url'));
    const decipher=createDecipheriv('aes-256-gcm',this.key,iv);decipher.setAAD(Buffer.from(context));decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8')) as T;
  }
}
export interface ConnectConfig {publicUrl:string;googleClientId?:string;googleClientSecret?:string;}
export class Connections {
  constructor(readonly store: OperationsStore,readonly vault: Vault,readonly config: ConnectConfig) {
    if (new URL(config.publicUrl).protocol!=='https:') throw new Error('PUBLIC_BASE_URL must use HTTPS');
  }
  client() {
    if(!this.config.googleClientId || !this.config.googleClientSecret) throw new Error('Google OAuth needs operator configuration');
    return new OAuth2Client(this.config.googleClientId,this.config.googleClientSecret,`${this.config.publicUrl}/oauth/callback`);
  }
  async begin(owner: string,provider: Provider) {
    this.store.chat(owner);
    const token=randomBytes(32).toString('base64url');
    const verifier=provider==='tally' ? '' : (await this.client().generateCodeVerifierAsync()).codeVerifier;
    this.store.db.prepare('INSERT INTO op_sessions VALUES(?,?,?,?,?,0)').run(hash(token),owner,provider,this.vault.seal(verifier,hash(token)),new Date(Date.now()+600000).toISOString());
    return `${this.config.publicUrl}/connect/${provider}?session=${token}`;
  }
  session(token: string) {
    const row=this.store.db.prepare('SELECT * FROM op_sessions WHERE token_hash=? AND used=0 AND expires_at>?').get(hash(token),new Date().toISOString()) as {owner:string;provider:Provider;verifier:string}|undefined;
    if(!row) throw new Error('Connection session expired or used'); return row;
  }
  authorizeUrl(token: string) {
    const session=this.session(token);if(session.provider==='tally') throw new Error('Wrong authentication flow');
    const verifier=this.vault.open<string>(session.verifier,hash(token));
    return this.client().generateAuthUrl({access_type:'offline',prompt:'consent',scope:['openid','email',providers[session.provider].scope],state:token,code_challenge:Buffer.from(hash(verifier),'hex').toString('base64url'),code_challenge_method:CodeChallengeMethod.S256});
  }
  private consume(token: string) {
    const row=this.session(token);
    if(!this.store.db.prepare('UPDATE op_sessions SET used=1 WHERE token_hash=? AND used=0').run(hash(token)).changes) throw new Error('Session already used');
    return row;
  }
  private save(owner:string,provider:Provider,value:unknown,account:string) {
    this.store.db.prepare("INSERT INTO op_connections VALUES(?,?,?,'CONNECTED',?,?) ON CONFLICT(owner,provider) DO UPDATE SET encrypted=excluded.encrypted,status=excluded.status,account=excluded.account,verified_at=excluded.verified_at")
      .run(owner,provider,this.vault.seal(value,`${owner}:${provider}`),account,new Date().toISOString());
    this.store.audit(owner,'connection.verified',provider);
  }
  async callback(token: string,code: string) {
    const session=this.consume(token); if(session.provider==='tally') throw new Error('Wrong authentication flow');
    const client=this.client();
    const {tokens}=await client.getToken({code,codeVerifier:this.vault.open<string>(session.verifier,hash(token))});
    if(!tokens.id_token || !tokens.access_token || !tokens.refresh_token) throw new Error('Offline authorization was not granted');
    const identity=(await client.verifyIdToken({idToken:tokens.id_token,audience:this.config.googleClientId})).getPayload();
    const info=await client.getTokenInfo(tokens.access_token);
    if(!identity?.email_verified || !identity.email || !info.scopes.includes(providers[session.provider].scope)) throw new Error('Required identity or permissions missing');
    this.save(session.owner,session.provider,tokens,identity.email);return session;
  }
  async tally(token: string,key: string) {
    const session=this.consume(token);if(session.provider!=='tally') throw new Error('Wrong authentication flow');
    if(key.length>1000 || !key.trim()) throw new Error('Invalid key');
    if(!(await new TallyClient({apiKey:key}).verifyConnection()).ok) throw new Error('Tally verification failed');
    this.save(session.owner,'tally',{key},'Organizer Tally account');return session;
  }
  list(owner:string) {
    return Object.entries(providers).map(([provider,metadata])=>({provider,...metadata,...(this.store.db.prepare('SELECT status,account,verified_at FROM op_connections WHERE owner=? AND provider=?').get(owner,provider) as object ?? {status:'NOT_CONNECTED'})}));
  }
  credential<T>(owner:string,provider:Provider): T {
    const row=this.store.db.prepare("SELECT encrypted FROM op_connections WHERE owner=? AND provider=? AND status='CONNECTED'").get(owner,provider) as {encrypted:string}|undefined;
    if(!row) throw new Error(`Connect ${provider} to continue`);
    return this.vault.open<T>(row.encrypted,`${owner}:${provider}`);
  }
  async google(owner:string,provider:Exclude<Provider,'tally'>) {
    const tokens=this.credential<Credentials>(owner,provider),client=this.client();client.setCredentials(tokens);
    try {
      const {token}=await client.getAccessToken(); if(!token) throw new Error('Missing token');
      const info=await client.getTokenInfo(token);
      if(!info.scopes.includes(providers[provider].scope)) throw new Error('Scope missing');
      this.store.db.prepare('UPDATE op_connections SET encrypted=?,verified_at=? WHERE owner=? AND provider=?').run(this.vault.seal({...tokens,...client.credentials},`${owner}:${provider}`),new Date().toISOString(),owner,provider);
      return client;
    } catch {
      this.store.db.prepare("UPDATE op_connections SET status='REAUTH_REQUIRED' WHERE owner=? AND provider=?").run(owner,provider);
      throw new Error(`Reconnect ${provider} to continue`);
    }
  }
  async disconnect(owner:string,provider:Provider) {
    let revokeFailed=false;
    if(provider!=='tally') {
      try {const tokens=this.credential<Credentials>(owner,provider);await this.client().revokeToken(tokens.refresh_token ?? tokens.access_token!);} catch {revokeFailed=true;}
    }
    this.store.db.transaction(()=>{
      this.store.db.prepare('DELETE FROM op_connections WHERE owner=? AND provider=?').run(owner,provider);
      this.store.db.prepare('DELETE FROM op_sessions WHERE owner=? AND provider=?').run(owner,provider);
    })();
    this.store.audit(owner,'connection.disconnected',provider,{revokeFailed});
    return {disconnected:true,revocation:provider==='tally' ? 'Revoke API key in Tally settings if needed' : revokeFailed ? 'Local credential removed; revoke app access in Google account settings' : 'Provider revocation acknowledged'};
  }
}
