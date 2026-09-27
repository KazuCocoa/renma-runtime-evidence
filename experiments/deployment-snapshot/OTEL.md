# Experimental OTLP projection and consumer boundary

This experiment validates a minimized projection, loopback transport, and
protobuf schema compatibility using **synthetic provider input**. It cannot be
switched into a production/runtime mode. Its version is
`renma.experimental-presence-deployment-otlp.v2`; it is not an OpenTelemetry
semantic convention or a public package export.

Run its deterministic checks after building:

```sh
npm run build
node --test .build/experiments/deployment-snapshot/test/otel-projection.test.js \
  .build/experiments/deployment-snapshot/test/otlp-decoder.test.js
```

The test binds deployment A before creating a dedicated Codex presence collector.
It then changes a synthetic latest pointer to B, sends a known metric fixture
through the actual collector, drains it, and projects the reduced snapshot.
A second loopback listener compares received bytes against that explicit
projection without retaining incoming request bodies. The exported deployment
remains A, including the actual non-null Git commit and digest from the isolated
Git fixture. Neither commit appears in the provider group. Other tests cover
collisions, missing rows/presence, unknown labels, malformed provider semantics,
extra properties, and later input or output mutation. No authentication or
analytics is required.

## Transport and meaning

The projection uses OTLP/HTTP JSON `ExportLogsServiceRequest`, sent by the test
as `POST /v1/logs` with `Content-Type: application/json`, following the
[OTLP specification](https://opentelemetry.io/docs/specs/otlp/) and
[pinned Logs protobuf structure](https://github.com/open-telemetry/opentelemetry-proto/blob/700dafd2e89ad6266049000c616a589d884523d4/opentelemetry/proto/logs/v1/logs.proto).
It represents one reduced snapshot, **not a synthesized Skill lifecycle event**.

Version 1 in [PR #13](https://github.com/KazuCocoa/renma-runtime-evidence/pull/13)
used two separate records without a correlation ID. Their relationship would be
lost if a backend split or reordered the batch. Version 2 puts both provenance
groups inside the same record's structured `body.kvlistValue`, under the keys
`provider` and `deployment`. Record splitting/reordering therefore cannot by
itself separate those two groups. No new identifier is required, and the groups
retain their distinct source and meaning. This does not prove that an arbitrary
backend retains or indexes structured log bodies correctly.

The output has no trace/span/session ID, occurrence count, identifying host/user
resource, timestamp, run label, arbitrary log body, path, or original metric
magnitude. The sender emits no Codex OTel logs; it creates a minimized snapshot
record, and existing Codex runners still disable runtime logs.

## Independent schema validation

The four official proto files needed for Logs requests and their Apache-2.0
license are vendored without edits from commit
`700dafd2e89ad6266049000c616a589d884523d4`. `vendor/opentelemetry-proto/UPSTREAM.json`
records per-file SHA-256 checksums, checked by the test. Schema imports resolve
only against these fixed local files. Tests and CI need no network schema fetch.

The exact development dependency `protobufjs@8.8.0` validates the generated JSON,
encodes it to protobuf, decodes it, and verifies exact object equality after
conversion back. This also catches fields silently dropped due to misspellings.
A malformed boolean confirms the independent verifier rejects an invalid type.
Two synthetic snapshots with actual A/B Git commits are split/reordered at the
record boundary and decoded; each retains its own provider facts and deployment
commit/digest. The ordinary loopback test also runs with the v2 record shape.

This establishes compatibility of these fixture messages with the pinned
protobuf schema, not full OTLP conformance or deployed-backend interoperability.
The loopback receiver is still only a byte comparator. There is no production
exporter, retry queue, relay, arbitrary endpoint API, or backend persistence test.
The decoder and vendored schemas are test-only and excluded from the runtime
package surface.

## Versioned experiment field contract

The instrumentation scope is `renma.experiment.presence-deployment`, version `2`.
The record and both nested groups have these fixed attributes:

- `renma.experiment.schema = renma.experimental-presence-deployment-otlp.v2`
- `renma.evidence.class = synthetic-fixture`
- `renma.record.meaning = snapshot-not-lifecycle-event`

The structured `provider` group has:

| Attribute                                    | Allowed meaning/value                          |
| -------------------------------------------- | ---------------------------------------------- |
| `renma.provenance`                           | `synthetic-provider-projection`                |
| `renma.provider`                             | `codex`                                        |
| `renma.provider.signal`                      | `skill-injected`                               |
| `renma.provider.scope`                       | `collector-lifetime`                           |
| `renma.provider.skill_name`                  | The one exact synthetic fixture name           |
| `renma.provider.presence_observed`           | Boolean; false is not proof of runtime absence |
| `renma.provider.unrecognized_label_observed` | Boolean only; unknown labels are discarded     |

The separate structured `deployment` group has:

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

Provider facts never acquire wrapper commit/digest fields. Wrapper facts never
acquire provider-presence fields. No chosen identity, digest, or commit is
exported for ambiguous, missing, or unobserved candidates. Every call rebuilds
output from validated primitives; caller objects are never serialized.

## Consumption and next decision

The only supported private package API remains
`createCodexSkillEvidenceCollector`, with the existing
`CodexSkillPresenceSnapshot` schema version 1. Consumers can use that API for
provider-specific collector-lifetime presence. They must not use this
experiment-only projection as a supported Renma integration or runtime binding.
Its source is deliberately excluded from the packed package.

A possible future sequence, not a released contract:

1. A plugin syncs a reviewed revision and verifies exact file content.
2. Before launching one isolated runtime and its dedicated collector, a wrapper
   resolves only explicit allowed Renma IDs/names and freezes deployment state.
3. The collector reduces provider input using its separate allowlist.
4. The wrapper reports deployment candidates alongside provider facts, without
   claiming injected bytes from a name-only signal.

The fixture uses explicit wiring; it does not verify that arbitrary consumers
pair the correct collector and manifest. Run ownership, concurrent runs,
actual Renma adapters, support-file digests, backend interoperability, and
remote-host lifecycle/cache signals need separate characterization before a
production API decision. A preserved record is not proof of correct attribution.

Renma retains static identities and contracts. A future plugin may own sync.
This repository owns provider reduction and the evidence boundary. No fixture
adds task evaluation, threat detection, orchestration, or a universal lifecycle
schema. The runtime phases of Issue #10 remain open.

## Related real-runtime boundary

The [CLI mid-turn experiment](../codex-model-freshness/MIDTURN.md) now provides a
real example of why the wrapper snapshot must stay frozen: the fixture was B on
disk before a tool returned, while the later artifact matched A. Its provider
metric still identified only the Skill name. That result does not validate an
injected revision or turn the synthetic OTLP projection here into runtime or
backend evidence. Never attach the final checkout's digest as a provider fact.

A separate [runtime-fed projection](../codex-model-freshness/RUNTIME-OTEL.md)
now binds the known barrier fixture before its real CLI collector starts and
projects the collector's actual reduced snapshot. It has its own experimental
schema and does not change this synthetic-only v2 fixture. Live provider input,
synthetic Skill content, wrapper provenance, and saved-record schema validation
are explicitly distinguished. Neither experiment establishes deployed-backend
interoperability or promotes the projection to the public package API.
