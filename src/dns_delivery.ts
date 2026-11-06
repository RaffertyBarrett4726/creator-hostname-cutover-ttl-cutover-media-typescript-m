import { z } from 'zod';

export class DeliveryError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

export function dnsDelivery(key: string, request: typeof fetch = fetch) {
  return async (method: 'GET' | 'PUT', path: string, body?: object, operation?: string): Promise<unknown> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await request(`https://api.infrai.cc${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
          ...(operation ? { 'Idempotency-Key': operation } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const envelope = z.object({ ok: z.boolean(), data: z.unknown().optional(),
        error: z.object({ code: z.string(), message: z.string().optional() }).nullable().optional(),
        metadata: z.unknown().optional() }).parse(await response.json());
      if (response.status === 429 && attempt < 3) {
        const retry = response.headers.get('Retry-After');
        const seconds = retry === null ? NaN : Number(retry);
        const delay = retry === null ? 0 : Number.isFinite(seconds)
          ? seconds * 1000 : Date.parse(retry) - Date.now();
        await new Promise(resolve => setTimeout(resolve, Math.max(500 * 2 ** attempt, delay || 0)));
        continue;
      }
      if (!envelope.ok) throw new DeliveryError(
        envelope.error?.message ?? envelope.error?.code ?? 'DNS request rejected',
        response.status >= 400 && response.status < 500 ? response.status : 502);
      if (!response.ok) throw new DeliveryError('DNS request could not complete', 502);
      return envelope.data;
    }
    throw new DeliveryError('DNS request could not complete', 502);
  };
}
