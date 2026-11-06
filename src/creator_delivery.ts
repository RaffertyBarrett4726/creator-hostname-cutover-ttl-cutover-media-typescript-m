import { createServer } from 'node:http';
import { ZodError } from 'zod';
import { dnsDelivery, DeliveryError } from './dns_delivery.ts';
import { cutoverBody, mediaCutover } from './media_cutover.ts';

const key = process.env.INFRAI_API_KEY;
if (!key) throw new Error('Set INFRAI_API_KEY');
const migrate = mediaCutover(dnsDelivery(key));
let pending: Promise<unknown> = Promise.resolve();
// Plain REST keeps the DNS boundary small; there is no SDK to install.
createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method !== 'POST' || req.url !== '/cutover') {
      res.writeHead(404).end(JSON.stringify({ error: 'Use POST /cutover' }));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) throw new DeliveryError('Request body too large', 413);
      chunks.push(Buffer.from(chunk));
    }
    const input = cutoverBody.parse(JSON.parse(Buffer.concat(chunks).toString()));
    const result = pending.then(() => migrate(input));
    pending = result.catch(() => undefined);
    res.end(JSON.stringify(await result));
  } catch (error) {
    const status = error instanceof ZodError || error instanceof SyntaxError ? 400
      : error instanceof DeliveryError ? error.status : 502;
    res.writeHead(status).end(JSON.stringify({ error: error instanceof Error ? error.message : 'Request could not complete' }));
  }
}).listen(3000, '127.0.0.1', () => console.log('Creator delivery listening on http://127.0.0.1:3000'));
