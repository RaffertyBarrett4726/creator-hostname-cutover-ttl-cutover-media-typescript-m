import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutoverBody, mediaCutover } from '../src/media_cutover.ts';

test('old TTL and creator readiness both gate switching; rollback restores the saved target', async () => {
  let clock = 0;
  const writes: object[] = [];
  const migrate = mediaCutover(async (method, path, body) => {
    if (method === 'PUT') writes.push(body!);
    return { zone_id: 'zone-123' };
  }, () => clock);
  const input = cutoverBody.parse({ migrationId: 'd13ad116-1248-4d08-b533-de59f4ef8b11', action: 'prepare',
    domain: 'example.com', name: 'stream', oldTarget: 'old.example.com', newTarget: 'new.example.com',
    previousTtl: 3600, shortTtl: 60,
    assets: [{ assetId: 'film', ingestion: 'stored', processingJob: 'running', creatorDelivery: 'pending' }] });
  await migrate(input);
  await assert.rejects(migrate({ ...input, action: 'switch' }), /previous TTL/);
  clock = 3600000;
  await assert.rejects(migrate({ ...input, action: 'switch' }), /creator asset/);
  const ready = cutoverBody.parse({ ...input, action: 'switch',
    assets: [{ assetId: 'film', ingestion: 'stored', processingJob: 'ready', creatorDelivery: 'verified' }] });
  assert.equal((await migrate(ready)).target, 'new.example.com');
  await migrate(ready);
  assert.equal((await migrate({ ...input, action: 'rollback' })).target, 'old.example.com');
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[2], { zone_id: 'zone-123', record_type: 'CNAME', name: 'stream', content: 'old.example.com', ttl: 60 });
});
