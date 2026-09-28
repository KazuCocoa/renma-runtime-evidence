# Additional local operational experiments

Implementation and evidence: [PR #27](https://github.com/KazuCocoa/renma-runtime-evidence/pull/27).

This follow-up completes the five requested **local experiment areas** after PR #26. It measures concrete configurations and failure controls; it does not certify an unspecified production deployment. All new runs used **zero model turns**. Authored synthetic load/fault fixtures, actual CLI metadata, and previous provider observations remain separate.

## Completion audit

| Requirement              | Current evidence                                                                                                                                             | Result                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation/coexistence | [CLI plugin report](results/20260928-plugins.json): two isolated plugins, occupied port, update, remove                                                      | Both connect; the second plugin stays connected after the first is removed. The original exporter endpoint and JSON protocol remain in the isolated config. A second listener fails with address-in-use without disturbing the receiver.                                    |
| Delivery durability      | [Durability report](results/20260928-durability.json): actual sender/backend SIGKILL, socket outage, acknowledgement loss, real Docker Collector replacement | Sender reloads its one pending record; backend reload deduplicates its retry. Eight records accepted by a persistent Collector survive container kill/removal/recreation and arrive after recovery. Queue saturation returns 503 for the excess.                            |
| TLS/authentication       | [Security report](results/20260928-security.json): real local HTTPS, temporary CA, credential rotation and timeout                                           | Unknown CA and hostname mismatch fail before storage. Missing/wrong/revoked credentials return 401. The new credential works. Timeout after storage and retry keep one unique record.                                                                                       |
| Scale/bounds             | [Load report](results/20260928-load.json): actual Renma catalogs and HTTP/file persistence                                                                   | 20 authored Git repositories / 1,000 Skills; 8 concurrent requests, 4,096 distinct fixture observations. The indexed load prototype preserves all 1,000 identities; capacity overflow is rejected. The earlier sender/backend separately reject their own 256/1,024 limits. |
| Aggregation/dashboard    | [Computed cases](results/20260928-aggregation.json), [browser checks](results/20260928-ui.json), [screenshot](results/dashboard-overlap.png)                 | Observed zero, absent data, delayed/out-of-order arrivals, gaps, exact duplicates, overlapping intervals and mixed versions all have verified counts/states. The dashboard now explicitly displays interval gaps.                                                           |

## Durability and backpressure

The first three phases use real child OS processes around the **existing** bounded sender/backend. After a 503, the sender is SIGKILLed and restarted with the same queue file. The backend stores the reduced record but drops its acknowledgement. The backend is then SIGKILLed; an actual send while its socket is down keeps the sender's record pending. After backend restart, the retry is removed as an exact duplicate: one stored record, one duplicate, zero pending. This advances PR #26's object-reinitialization test to process restart.

The Docker experiment uses `otel/opentelemetry-collector-contrib:0.161.0`, its `file_storage` extension, `fsync: true`, a bind-mounted state directory, and a persistent exporter queue. The resolved image digest is saved. While the backend rejects traffic, eight posts return HTTP 200. The Collector is forcibly killed, its container removed, and a new container uses the same state directory. All eight records arrive; together with the preceding sender test the backend has nine unique records. Recovery is bounded to 20 seconds, not an unlimited eventual-delivery assertion.

A second phase sets the Collector queue size to four and sends 16 distinct requests during an outage. Four return 200 and 12 return 503. All four accepted requests arrive after recovery. The experiment does not retry the rejected inputs, so it establishes backpressure and accepted-record recovery, not end-to-end delivery of all 16. A real sender must retain/retry a retryable rejection.

**Limits:** process termination is not host power loss or filesystem corruption. The tested source is an authored reduced envelope, not the Codex exporter. Authentication failures and permanent storage limits must not be treated as endlessly retryable. Persistent Collector storage cannot restore observations that never reached it.

References: [version-pinned file storage configuration](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.161.0/extension/storage/filestorage/README.md), [version-pinned exporter queue configuration](https://github.com/open-telemetry/opentelemetry-collector/blob/v0.161.0/exporter/exporterhelper/README.md).

## Local TLS and credentials

A temporary local CA signs a localhost/127.0.0.1 server certificate. Node's HTTPS client always keeps certificate verification enabled; neither global trust nor system certificates are modified. The HTTPS ingress validates credentials, reconstructs the allowlisted observation and forwards it to the existing local backend. Temporary keys/certificates and ephemeral credentials are removed after the run and never included in reports.

The saved nine phases distinguish unknown trust, wrong hostname, absent credentials, wrong credentials, authenticated delivery, revocation of the old credential, use of the new credential, a response timeout **after storage**, and successful retry. Four authorized requests yield one unique record and three exact duplicates. This is a Node HTTPS client/local OTLP envelope test, not proof of Codex or Collector TLS configuration, enterprise proxies, remote endpoint policy, or automated credential distribution.

## Load and capacity findings

The run creates 20 actual Git repository roots, each with 50 authored Skills and canonical `metadata["renma.id"]`, then executes the real Renma catalog command on every root. All 1,000 expected IDs are checked. Catalog construction took 3,171 ms in the saved macOS arm64 / Node 24.18.0 run.

An **explicitly separate indexed-envelope load prototype** uses those exact identities as its allowlist. Eight concurrent clients send 64 batches × 64 observations over real HTTP; the server reconstructs each record and atomically persists the reduced set with file fsync before acknowledgement. The 4,096 unique records retain all 1,000 Skill identities; saved payload size is 274,777 bytes. The measured request phase took 317 ms (batch p50 36 ms, p95 64 ms). These are short local measurements, not sustained throughput or production sizing. Collector buffering, model context load, and per-Skill Codex activation at this scale are not measured.

The 65 repeated records do not increase unique storage. An unknown asset is rejected. Authored contamination is included in new incoming records, discarded before persistence, and absent from the saved file. Record 4,097 receives 507 without changing storage.

The prior two-Skill observation schema is **not generalized by this experiment**. Its existing sender and backend are tested separately: enqueue 257 is rejected after 256 pending records; record 1,025 receives HTTP 400 after 1,024 stored records. These are experimental implementation ceilings. The latter response is not a transient retry signal; a full production backend needs an intentional quota/retention and error contract. The load prototype establishes a bounded configurable-inventory approach, not readiness of the earlier fixed fixture schema for arbitrary portfolios.

## Plugin coexistence findings

CLI 0.157.1 installs two authored MCP plugins into an isolated home through the plugin-creator helpers. Their distinct MCP keys avoid the earlier duplicate-name failure. They share an already provisioned receiver and do not attempt to own its port. A separate collision control really attempts to bind that occupied port.

Both plugin connections remain identifiable through the first plugin's update. After removing it, the fresh thread has zero entries for it and the peer stays connected; the old thread's status listing also omits it in this run. **Status-list absence does not prove process termination** and does not supersede the earlier process-heartbeat evidence. The receiver stays healthy throughout.

The existing exporter endpoint/protocol are verified in the isolated file at every checkpoint. These metadata-only runs deliberately emit no model calls and make no new assertion about provider traffic using that configuration; the earlier [live coexistence reports](../codex-telemetry-coexistence/README.md) cover that separate observation. Arbitrary third-party cooperation and a zero-setup installer remain unsupported.

## Aggregation and browser results

All timestamps in these cases are authored synthetic values. They are never included in real provider counts.

| Case                 | Expected/displayed alpha count | Distinction                                                                                              |
| -------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Observed zero        | 0                              | One valid sample, no positive increase; last increase remains absent                                     |
| Missing              | Unknown                        | No sample is not zero                                                                                    |
| Delayed/out of order | 3                              | Disjoint intervals sum despite reversed arrival/input order; timeline uses receipt UTC                   |
| Gap                  | 2                              | Only received increments; an explicit gap label and unknown completeness                                 |
| Exact duplicate      | 1                              | Identical reduced record does not double the count                                                       |
| Overlap              | Unknown                        | Different receipts with overlapping metric intervals cannot be resolved without retained series identity |
| Mixed deployment     | 2                              | Count can be supported while the content/version candidate remains ambiguous                             |

Beta remains unobserved/unknown in all seven cases. API assertions and actual browser checks cover all cases; the existing dashboard's synthetic selector keeps them separate from actual observations. The dedicated case servers are disposable; the normal saved-provider dashboard remains unchanged except for the new gap label.

## Reproduction and privacy

From the repository root, after installing dependencies:

```sh
npm run build
node .build/experiments/telemetry-hardening/src/run-durability.js
node .build/experiments/telemetry-hardening/src/run-security.js
node .build/experiments/telemetry-hardening/src/run-load.js /absolute/path/to/renma/dist/index.js
node .build/experiments/telemetry-hardening/src/run-plugins.js \
  /absolute/path/to/plugin-creator/scripts /absolute/path/to/python3
node .build/experiments/telemetry-hardening/src/run-dashboard.js
npm run check
```

Durability requires Docker, the official contrib image, a shared checkout mount and `host.docker.internal`. The runner uses disposable named containers and owned state directories. TLS requires OpenSSL. Plugin checks require Codex, Node and Python with PyYAML. Renma is read/executed only. No API key, provider login or new model call is needed.

The first four runners emit only reduced reports on stdout; save them separately. The dashboard runner saves its computed synthetic case report, starts ports 18582–18588, and prints their mapping. Select synthetic data in each page; SIGTERM cleans up all case servers and temporary report directories. Browser-check evidence is generated separately from actual observed UI state, not claimed by the API runner.

All observations are reconstructed from explicit fixture identities, bounded counters and finite phase/status values. Runtime prompts, responses, reasoning, transcripts, tool contents, real user identifiers and credentials are prohibited. Reports retain no temporary installation paths. This is operational telemetry experimentation, not task evaluation or automatic archival policy.
