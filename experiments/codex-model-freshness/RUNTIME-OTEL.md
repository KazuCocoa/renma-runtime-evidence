# Runtime-fed experimental OTLP record

The existing [deployment-snapshot v2 projection](../deployment-snapshot/OTEL.md)
remains synthetic-only. This separately versioned experiment uses the live
Codex collector's reduced presence snapshot from the [barrier comparison](MIDTURN.md):

```sh
npm run build
node .build/experiments/codex-model-freshness/src/run.js --use-chatgpt-login --allow-codex-analytics --midturn-capability --emit-runtime-otel
```

The optional output is `runtimeOtel` in each condition's bounded report. Each
value is an OTLP/HTTP JSON `ExportLogsServiceRequest` containing one structured
log record. The command **constructs the record**; it does not send it to an
arbitrary endpoint or claim deployed-backend interoperability. This is not a
production exporter, a public package API, or an OpenTelemetry semantic convention.

## Source and ownership

For each condition, the runner verifies the known fixture A bytes, binds a copied
projection snapshot, and only then starts that condition's dedicated collector
and CLI server. After the server stops, the collector drains received requests;
its real reduced snapshot is projected directly. The code does not reconstruct
provider metrics from a report or replay synthetic metrics into the live collector.

The real model operates on synthetic, repository-authored Skill/tool content.
Those two facts are distinct: `renma.evidence.class` is
`real-runtime-reduced-snapshot`, while `renma.fixture.synthetic_content` is true.
Unit tests instead explicitly select `synthetic-test`, with
`synthetic-provider-projection` provenance. Neither mode authenticates arbitrary
callers; provenance depends on the reviewed runner wiring. The module is excluded
from the packed runtime API.

The fixed experiment schema is `renma.experimental-codex-runtime-presence.v1`,
with instrumentation scope `renma.experiment.codex-runtime-presence`, version `1`.
Its name, known A/B bytes and digest vocabulary are deliberately restricted to
this fixture; it does not accept arbitrary repository metadata or hashes.

## Field meanings

The record's structured `body.kvlistValue` contains two groups:

| Group        | Source                                       | Fields                                                                                                                                    |
| ------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`   | `provider-runtime-reduction` in the real run | Fixed Codex provider/signal/scope/fixture name, presence boolean, unknown-label boolean                                                   |
| `deployment` | `experiment-wrapper`                         | Before-collector binding, candidate resolution, always-unsupported injected revision, and conditional known-fixture digest/scope/revision |

A present fixture label permits a **known wrapper deployment candidate**. It
never proves that the provider loaded or injected those bytes. A missing fixture
label emits `no-provider-presence` and omits the candidate digest and revision;
it does not prove runtime absence. Unknown names become a boolean and are not
exported. The projection validates input semantics and reconstructs every field
from allowlisted primitives, discarding extra properties.

Provider fields never acquire a wrapper digest. Both groups remain within one
record, so splitting or reordering a batch at record boundaries preserves their
pairing. The record has no timestamp, trace/span/session ID, occurrence count,
path, user/host metadata, raw body, original metric magnitude, or Git commit.
The deployment revision A/B is a **fixture revision**, not a provider body revision
or a verified Renma source revision.

## Consumer boundary

An experimental consumer may read the provider presence boolean and separately
present the wrapper candidate's pre-bound state. It must retain both provenance
labels and the unsupported injected-revision marker. It must not substitute the
latest checkout, infer a lifecycle order, upgrade presence to execution, or treat
an unknown/missing label as proof of absence. Pairing within a record is not
proof that arbitrary consumers supplied the correct run's deployment.

The supported private API remains `createCodexSkillEvidenceCollector` and its
version-1 provider-specific presence snapshot. No Renma integration or universal
lifecycle contract is introduced. Tool completion and wrapper artifacts stay in
the separate experiment report; this OTel record does not imply either.

The pinned official protobuf schema verifies/encodes/decodes the format in tests.
That confirms representational compatibility, not a remote backend's indexing,
retention, or processing semantics. Remote-host read/cache/TTL signals and a
real deployed OTel consumer require separate evidence.

## CLI 0.157.1 live-input observation, 2026-09-27

The [bounded report with OTLP records](results/20260927-cli-0.157.1-runtime-otel.json)
is a new real two-condition run with the optional projection enabled. Both turns
and both exact tool calls completed. The direct condition emitted no fixture
presence and no candidate digest/revision. The Skill condition emitted presence,
verified B before its tool reply, and produced an A artifact. Its OTLP wrapper
group retained the pre-bound A digest while the experiment's later wrapper
deployment was B. The provider group contained no digest.

Tests also encode/decode these saved, already-reduced real records with the pinned
protobuf schema. Those tests are **record replay/format validation**, not another
model run or an actual backend deployment. Both the live observation and the
synthetic unit tests preserve unsupported injected revision and separate source
labels. No claim is made about remote backend ingestion or indexing.
