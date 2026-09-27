# Experimental OTLP projection and consumer boundary

This experiment validates a minimized projection and loopback transport using
**synthetic provider input**. It cannot be switched into a production/runtime
mode. Its version is `renma.experimental-presence-deployment-otlp.v1`; it is not
an OpenTelemetry semantic convention or a public package export.

Run its deterministic checks after building:

```sh
npm run build
node --test .build/experiments/deployment-snapshot/test/otel-projection.test.js
```

The test binds deployment A before creating a dedicated Codex presence collector.
It then changes a synthetic latest pointer to B, sends a known metric fixture
through the actual collector, drains it, and projects the reduced snapshot.
A second loopback listener compares received bytes against that explicit
projection without retaining incoming request bodies. The exported deployment
remains A, including the actual non-null Git commit and digest from the isolated
Git fixture; the later B commit is not exported and neither commit appears in
the provider record. Other tests cover collisions, missing rows, missing presence, unknown
labels, malformed provider semantics, extra caller properties, and later input
or output mutation. No authentication or analytics is required.

## Transport and meaning

The projection uses OTLP/HTTP JSON `ExportLogsServiceRequest`, sent by the test
as `POST /v1/logs` with `Content-Type: application/json`, following the
[OTLP specification](https://opentelemetry.io/docs/specs/otlp/) and
[Logs protobuf structure](https://github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/logs/v1/logs.proto).
It represents a pair of reduced snapshots, **not a synthesized Skill lifecycle
event**. This is a custom loopback wire test, not validation against a deployed
OpenTelemetry Collector, backend, or protobuf decoder. No backend compatibility
claim, retrying exporter, relay, persistent queue, or arbitrary endpoint API is
provided. The test bounds requests and send time; it retains only a comparison
boolean at the receiver.

The projection deliberately has no trace/span/session ID, occurrence count,
resource identifying a user/host, timestamp, run label, arbitrary log body,
path, or original metric magnitude. Ordering of the two records has no runtime
ordering meaning. There is no correlation ID: a backend that splits batches or
reorders records cannot reconstruct the relationship between these records.
The HTTP request comparison does not test backend correlation. A future design
would need a separately reviewed correlation mechanism or a single snapshot
record with explicitly separate provenance fields. No identifier is added here
to imply that this problem has been solved. The sender emits no Codex OTel logs; these are wrapper-created
snapshot records, and the existing Codex runners still disable runtime logs.

## Versioned experiment field contract

Each record has the same three fixed attributes:

- `renma.experiment.schema = renma.experimental-presence-deployment-otlp.v1`
- `renma.evidence.class = synthetic-fixture`
- `renma.record.meaning = snapshot-not-lifecycle-event`

The `renma.experiment.provider-presence` instrumentation scope has one record:

| Attribute                                    | Allowed meaning/value                          |
| -------------------------------------------- | ---------------------------------------------- |
| `renma.provenance`                           | `synthetic-provider-projection`                |
| `renma.provider`                             | `codex`                                        |
| `renma.provider.signal`                      | `skill-injected`                               |
| `renma.provider.scope`                       | `collector-lifetime`                           |
| `renma.provider.skill_name`                  | The one exact synthetic fixture name           |
| `renma.provider.presence_observed`           | Boolean; false is not proof of runtime absence |
| `renma.provider.unrecognized_label_observed` | Boolean only; unknown labels are discarded     |

The `renma.experiment.deployment` scope has one separate record:

| Attribute                               | Allowed meaning/value                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `renma.provenance`                      | `experiment-wrapper`                                                              |
| `renma.deployment.repository`           | Fixed fixture repository alias                                                    |
| `renma.deployment.candidate_resolution` | `unique-deployment-candidate`, `ambiguous`, `unmapped`, or `no-provider-presence` |
| `renma.deployment.injected_revision`    | Always `unsupported`                                                              |
| `renma.deployment.asset_id`             | Allowed fixture ID; only for one candidate with provider presence                 |
| `renma.deployment.skill_name`           | Exact fixture name; only for that candidate                                       |
| `renma.deployment.content_digest`       | One of the two known fixture SHA-256 digests; only for that candidate             |
| `renma.deployment.digest_scope`         | `exact-skill-md-bytes`; only for that candidate                                   |
| `renma.deployment.local_state`          | Existing finite reference-comparison state; only for that candidate               |
| `renma.deployment.commit_verification`  | `caller-supplied-unverified`; only for that candidate                             |
| `renma.deployment.commit`               | Optional validated pre-bound Git commit; only for that candidate                  |

Provider records never acquire wrapper commit/digest fields. Wrapper records
never acquire provider-presence fields. No chosen identity, digest, or commit is
exported for ambiguous, missing, or unobserved candidates. Each call reconstructs
new output from validated primitives; caller objects are never serialized.

## Consumption and next decision

The only supported private package API remains
`createCodexSkillEvidenceCollector`, with the existing
`CodexSkillPresenceSnapshot` schema version 1. Consumers can use that API today
for provider-specific collector-lifetime presence. They must not use the
experiment-only projection as a supported Renma integration or runtime binding.
The experimental source is deliberately excluded from the packed package.

A possible future integration sequence, not a released contract:

1. A plugin syncs a reviewed repository revision and verifies exact file content.
2. Before launching one isolated runtime and its dedicated collector, a wrapper
   resolves only explicit allowed Renma IDs/names and freezes deployment state.
3. The collector reduces provider input using its separate allowlist.
4. The wrapper may report deployment candidates alongside provider facts. It
   cannot claim injected bytes from name-only evidence, even with one candidate.

The current fixture tests the projection with explicit wiring; it does not
verify that an arbitrary consumer pairs the correct collector and manifest.
No session ID or heuristic attribution is introduced to hide that limitation.
Actual identity adaptation, run ownership, multiple simultaneous runs, support
file digests, exporter/backend interoperability, and remote-host lifecycle/cache
signals require separate characterization before a production API decision.

Renma retains static identities and contracts. A future plugin may own sync.
This repository owns provider reduction and the evidence boundary. Neither
fixture adds task evaluation, threat detection, orchestration, or a universal
lifecycle schema. The runtime phases of Issue #10 remain open.
