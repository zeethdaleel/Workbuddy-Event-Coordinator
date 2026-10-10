import { z } from 'zod';

const acknowledgement = z.object({ ok: z.literal(true), result: z.object({
  message_id: z.number().int(), chat: z.object({ id: z.number().int() }),
  document: z.object({ file_id: z.string() }).optional()
}) });
export class DeliveryError extends Error {
  constructor(readonly kind: 'rejected'|'uncertain'|'rate_limited', readonly retryAfter?: number) { super(`telegram_${kind}`); }
}
/** Never put token-bearing URLs or provider response bodies in logs. */
export class TelegramClient {
  constructor(private token: string,private transport: typeof fetch = fetch) {
    if (!token.trim()) throw new Error('TELEGRAM_BOT_TOKEN is required');
  }
  async sendMessage(chat: string,text: string,buttons?: unknown) {
    if (text.length>4096) throw new Error('Telegram message exceeds 4096 characters');
    return this.call('sendMessage',chat,JSON.stringify({ chat_id:chat,text,...(buttons ? { reply_markup:buttons } : {}) }));
  }
  async sendDocument(chat: string,bytes: Uint8Array,name: string) {
    if (!bytes.length || bytes.length>49*1024*1024) throw new Error('Document exceeds safe Telegram upload limit');
    const body = new FormData(); body.set('chat_id',chat); body.set('document',new Blob([Buffer.from(bytes)],{type:'application/pdf'}),name);
    const result = await this.call('sendDocument',chat,body);
    if (!result.fileId) throw new DeliveryError('uncertain');
    return result;
  }
  private async call(method: string,chat: string,body: string|FormData) {
    let response: Response;
    try {
      response = await this.transport(`https://api.telegram.org/bot${this.token}/${method}`,{
        method:'POST',body,headers: typeof body === 'string' ? {'Content-Type':'application/json'} : undefined,
        signal:AbortSignal.timeout(20000)
      });
    } catch { throw new DeliveryError('uncertain'); }
    let data: unknown;
    try { data = await response.json(); } catch { throw new DeliveryError('uncertain'); }
    if (response.status === 429) {
      const retry = z.object({ parameters:z.object({retry_after:z.number().positive().max(86400)}) }).safeParse(data);
      throw new DeliveryError('rate_limited',(retry.success ? retry.data.parameters.retry_after : 60)*1000);
    }
    if (response.status>=500) throw new DeliveryError('uncertain');
    const parsed = acknowledgement.safeParse(data);
    if (!response.ok || !parsed.success) throw new DeliveryError(response.ok ? 'uncertain' : 'rejected');
    if (String(parsed.data.result.chat.id)!==chat) throw new DeliveryError('uncertain');
    return { messageId:parsed.data.result.message_id,chatId:chat,fileId:parsed.data.result.document?.file_id,acknowledgedAt:new Date().toISOString() };
  }
}
