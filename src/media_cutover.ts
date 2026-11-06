import { z } from 'zod';
import { DeliveryError } from './dns_delivery.ts';

const target = z.string().min(1).regex(/^[a-zA-Z0-9.-]+$/);
export const cutoverBody = z.object({
  migrationId: z.string().uuid(), action: z.enum(['prepare', 'switch', 'rollback']),
  domain: target, name: target, oldTarget: target, newTarget: target,
  previousTtl: z.number().int().min(60).max(86400),
  shortTtl: z.number().int().min(60).max(300),
  assets: z.array(z.object({ assetId: z.string().min(1),
    ingestion: z.enum(['received', 'stored']),
    processingJob: z.enum(['queued', 'running', 'ready']),
    creatorDelivery: z.enum(['pending', 'verified']) }).strict()).min(1)
}).strict().refine(value => value.oldTarget !== value.newTarget && value.shortTtl <= value.previousTtl,
  'Use distinct targets and lower or equal TTL');
export type Cutover = z.infer<typeof cutoverBody>;
type Session = { config: string; zone: string; eligibleAt: number; phase: 'prepared' | 'switched' | 'rolled-back' };
type DnsCall = (method: 'GET' | 'PUT', path: string, body?: object, operation?: string) => Promise<unknown>;

export function mediaCutover(call: DnsCall, now = Date.now) {
  const sessions = new Map<string, Session>();
  return async (input: Cutover) => {
    const config = JSON.stringify([input.domain, input.name, input.oldTarget, input.newTarget,
      input.previousTtl, input.shortTtl]);
    let session = sessions.get(input.migrationId);
    if (session && session.config !== config) throw new DeliveryError('Migration settings changed');
    if (!session) {
      if (input.action !== 'prepare') throw new DeliveryError('Prepare this migration first');
      const zone = z.object({ zone_id: z.string().min(1) }).parse(await call('GET',
        `/v1/dns/domain/get?domain=${encodeURIComponent(input.domain)}`));
      await call('PUT', '/v1/dns/record/upsert', { zone_id: zone.zone_id, record_type: 'CNAME',
        name: input.name, content: input.oldTarget, ttl: input.shortTtl }, `${input.migrationId}:prepare`);
      session = { config, zone: zone.zone_id, eligibleAt: now() + input.previousTtl * 1000, phase: 'prepared' };
      sessions.set(input.migrationId, session);
    }
    if (input.action === 'switch' && session.phase !== 'switched') {
      if (session.phase !== 'prepared') throw new DeliveryError('Start a new migration after rollback');
      if (now() < session.eligibleAt) throw new DeliveryError('Wait for the previous TTL window');
      if (!input.assets.every(asset => asset.ingestion === 'stored' && asset.processingJob === 'ready'
        && asset.creatorDelivery === 'verified')) throw new DeliveryError('Verify every creator asset before switching');
      await call('PUT', '/v1/dns/record/upsert', { zone_id: session.zone, record_type: 'CNAME',
        name: input.name, content: input.newTarget, ttl: input.shortTtl }, `${input.migrationId}:switch`);
      session.phase = 'switched';
    }
    if (input.action === 'rollback' && session.phase !== 'rolled-back') {
      await call('PUT', '/v1/dns/record/upsert', { zone_id: session.zone, record_type: 'CNAME',
        name: input.name, content: input.oldTarget, ttl: input.shortTtl }, `${input.migrationId}:rollback`);
      session.phase = 'rolled-back';
    }
    return { migrationId: input.migrationId, phase: session.phase,
      eligibleAt: new Date(session.eligibleAt).toISOString(),
      target: session.phase === 'switched' ? input.newTarget : input.oldTarget,
      assets: input.assets.length };
  };
}
