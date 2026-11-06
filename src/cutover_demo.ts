import { cutoverBody, mediaCutover } from './media_cutover.ts';
let clock = 0;
const migrate = mediaCutover(async (method, path, body) => {
  console.log(JSON.stringify({ method, path, body }));
  return { zone_id: 'demo-zone' };
}, () => clock);
const input = cutoverBody.parse({ migrationId: 'd13ad116-1248-4d08-b533-de59f4ef8b11',
  action: 'prepare', domain: 'example.com', name: 'stream',
  oldTarget: 'old-cdn.example.com', newTarget: 'new-cdn.example.com', previousTtl: 3600, shortTtl: 60,
  assets: [{ assetId: 'launch-film', ingestion: 'stored', processingJob: 'ready', creatorDelivery: 'verified' }] });
console.log(await migrate(input));
clock = 3600000;
console.log(await migrate({ ...input, action: 'switch' }));
console.log(await migrate({ ...input, action: 'rollback' }));
