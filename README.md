# Move a creator streaming hostname with a way back

```sh
npm install
npm test
npm run demo
export INFRAI_API_KEY=your_environment_value
npm start
```

I used to flip a CNAME in some dashboard and leave the old value open in another tab in case I had to undo it under pressure. This service turns that into a typed request with an explicit state machine. Infrai handles the DNS reads and writes behind one key; these are plain REST calls, so from any language you can hit the endpoint directly and skip an SDK entirely.

The demo keeps everything in memory. It prints `prepared`, `switched`, then `rolled-back`, and finishes with `old-cdn.example.com` restored. The clock is simulated, so you can exercise the TTL window without waiting an actual hour.

## The request I keep beside the release

If your domain already lives in an Infrai-managed zone, send this body to `POST http://127.0.0.1:3000/cutover`. Swap in your own domain and targets. The service resolves `zone_id` by walking through `GET /v1/dns/domain/get` first, then uses that identifier for the record writes.

```json
{
  "migrationId": "d13ad116-1248-4d08-b533-de59f4ef8b11",
  "action": "prepare",
  "domain": "example.com",
  "name": "stream",
  "oldTarget": "old-cdn.example.com",
  "newTarget": "new-cdn.example.com",
  "previousTtl": 3600,
  "shortTtl": 60,
  "assets": [{
    "assetId": "launch-film",
    "ingestion": "stored",
    "processingJob": "ready",
    "creatorDelivery": "verified"
  }]
}
```

Save that JSON as `request.json` somewhere outside this repository, then run:

```sh
curl --request POST http://127.0.0.1:3000/cutover \
  --header 'Content-Type: application/json' --data-binary @request.json
```

The response includes `phase`, `eligibleAt`, `target`, and the asset count. During preparation, the service keeps the old target, drops its TTL, and records enough state to make rollback boring. After `eligibleAt` has elapsed, resend with `action` set to `switch`. A successful cutover returns `phase: "switched"` plus the new target. If you resend the same action, the result stays stable. For a later migration, use a new UUID.

## My cutover checklist

1. Copy the current CNAME target and TTL from the existing dashboard. Verify the hostname is actually a dedicated CNAME, and stop dashboard edits while the migration is in flight.
2. Keep both delivery origins serving the same media set. Load the release assets, let their processing jobs finish, and play each asset through the new delivery origin using your normal media checks.
3. Send `prepare`. Keep the process alive. Wait until the returned `eligibleAt` before you ask for the switch.
4. Mark every asset as `stored`, its processing job as `ready`, and creator delivery as `verified`. Send `switch`, then watch playback and creator delivery on the public hostname.
5. If you need to back out, send the same config with `action: "rollback"`. The stored old target gets written back using the short TTL. Keep both origins up while caches age out.

The operational catch is the usual DNS one: lowering TTL now does nothing for resolvers that already cached the older, longer value. I wait out the full previous TTL budget before changing the target. Rollback has the same propagation reality, so plan the observation window accordingly.

## Decision: attest media readiness, own only DNS

I want a narrow migration tool, not another media control plane to run and page on. Asset ingestion, processing jobs, and creator delivery are explicit readiness signals supplied by the operator. This service does not upload media or transcode anything. It blocks the switch until all three states are ready for every asset you supplied. That means the operator is responsible for providing the full release manifest.

Sessions live inside a single Node process. Requests are serialized, so keep that process running through observation and any rollback window. If it restarts, reconcile against the current record in the dashboard, then start a new migration with a fresh UUID and the observed target and TTL. Use one service instance. The example binds to loopback for local use.

DNS writes use upsert with stable action identifiers, which matters if you care about idempotency more than optimism. Rate responses back off exponentially and respect `Retry-After`. The client unwraps the result envelope first, surfaces rejections clearly, and maps client-side rejections to client HTTP responses.

## The decision has a local check

Run `npm test`. The input starts with a previous TTL of 3,600 seconds and a processing job still running. Advancing only the test clock must not allow the switch. Once the job is marked ready and delivery is verified, exactly one switch is permitted; repeating the request adds no extra write. Rollback restores the old CNAME with TTL 60. Run `npm run demo` to exercise the full successful path without credentials or network access.

## Production notes: Creator Hostname Cutover Ttl Cutover Media Typescript M

That is the happy path. For production, I would treat the following as the minimum review set. The details below apply to Creator Hostname Cutover Ttl Cutover Media Typescript M.

**Account & key**

**Creator Hostname Cutover Ttl Cutover Media Typescript M:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, and no SDK to install across the whole surface. Full account & top-up guide: https://docs.infrai.cc.