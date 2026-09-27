# Continuation experiment ledger

Current completion audit: [five-track conclusion](experiment-conclusion.md).
The local bounded program now has real Git + Codex + OTLP transport evidence.
Earlier blocked/incomplete entries below describe intermediate states; remote
host and production integration questions remain explicitly unmeasured.

Scope: [Issue #10](https://github.com/KazuCocoa/renma-runtime-evidence/issues/10)
and the static/runtime boundary in
[Renma #174](https://github.com/KazuCocoa/renma/issues/174). A phase is complete
only when its stated evidence exists; fixtures cannot satisfy runtime criteria.

| Phase                      | Completion criterion                                                                                        | 2026-09-27 status                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two-Skill characterization | Three isolated real CLI rows with usable pipeline and finite result                                         | CLI 0.157.1 ChatGPT file login: three completed rows, usable OTLP, requested-skill-only                                                                  |
| Identity manifest          | Inspect actual Renma identity and test immutable deployment mapping, collisions, modifications, missing IDs | Local fixture implemented; experimental, not a public runtime contract                                                                                   |
| Lifecycle/freshness        | Real host listing/read/direct invocation and bounded A/B updates; unsupported states explicit               | Local Git, listing-only, and four real model turns after A/B replacement measured; mid-turn barrier/direct capability measured; remote behavior untested |
| Provenance/OTel            | Minimal allowlisted transport with provider and deployment provenance separate                              | Real Git + live Codex reduction + local HTTP OTLP delivery; pinned decoder checked; production backend untested                                          |
| Consumer boundary          | Document and version only demonstrated semantics                                                            | Existing provider-specific presence API retained; experimental field contract documented separately                                                      |

Baseline: remote/main `3d237e85dc61419bda92a720e8bdbd1b5710dd33`, no open PR,
clean checkout, installed CLI `0.157.1`. Baseline checks: 131 passed, 1 skipped.
The restricted shell initially prevented loopback binding and npm packing;
the same checks passed with required local permissions and a temporary npm cache.

Previous CLI `0.146.0` quota/rate-limit results remain historical. The earlier missing-key block was a runner isolation prerequisite, not a CLI requirement.
The new 0.157.1 matrix uses explicitly authorized ChatGPT file login; the runner
links authentication without reading or copying credentials.

See the [deployment experiment](../experiments/deployment-snapshot/README.md).
The immutable snapshot experiment was merged in
[PR #11](https://github.com/KazuCocoa/renma-runtime-evidence/pull/11), with both
Node 22/24 CI jobs passing (138 local tests passed, 1 skipped).
The subsequent local Git experiment distinguishes moving `origin/main` from a
pinned deployment and records point-in-time file verification under separate
wrapper provenance. Neither experiment satisfies the real-host phase.
The actual Git synchronization experiment was merged in
[PR #12](https://github.com/KazuCocoa/renma-runtime-evidence/pull/12), with both
Node 22/24 CI jobs passing (139 local tests passed, 1 skipped).
The [OTLP projection and consumer boundary](../experiments/deployment-snapshot/OTEL.md)
are tracked in [PR #13](https://github.com/KazuCocoa/renma-runtime-evidence/pull/13),
merged after both Node 22/24 CI jobs passed (143 local tests passed, 1 skipped).
A follow-up v2 experiment preserves both provenance groups within one record and
validates fixture messages using the pinned official schema and a protobuf decoder. The deployment-projection OTLP input is synthetic. A separate no-model-turn app-server
experiment now provides real listing evidence; it does not provide injection
or capability-invocation evidence.
The current run has explicit separate-analytics consent.
The existing characterization runner requires explicit analytics consent because
Codex's separate OpenAI analytics path is not controlled by the loopback exporter.
Secrets must remain in the execution environment or Codex credential storage,
never pasted into a report or committed. Authentication failures must not trigger unchanged retries.

## Earlier external boundary (superseded by the completed local sequence)

The independent filesystem, Git, and synthetic transport steps are complete as
fixtures. At that intermediate stage, the overall experiment was **not complete**. The real CLI 0.157.1 listing experiment measured cached versus forced
refresh and a body-only update with unchanged listing metadata. The two-Skill
selection matrix has now completed using ChatGPT authentication. A local mid-turn barrier and direct-capability comparison are now measured;
body-read/injection attribution and remote-host cache behavior remain unmeasured. Between-turn local A/B replacement
is now measured separately in the model-thread sequence.

The API-key and explicit ChatGPT-login modes remain separate opt-in choices.
If a runner reports authentication/quota failure, retain only the fixed category and
stop unchanged retries. If usable runtime evidence arrives, characterize only
what it exposes; lack of revision/listing/read fields must remain unsupported.
A runtime or host exposing the required listing/read signals must be identified
before any claim about remote TTL, cache scope, freshness, or invocation is made.
Keep Issue #10 open and the public provider-presence API unchanged until then.

## Real listing evidence without model authentication

[PR #14](https://github.com/KazuCocoa/renma-runtime-evidence/pull/14) merged the
single-record OTLP v2/schema-decoder fixture after both Node 22/24 CI jobs passed
(145 local tests passed, 1 skipped).

The [app-server listing experiment](../experiments/codex-listing-freshness/README.md)
then ran three final independent CLI 0.157.1 processes with isolated homes,
file-only credentials storage, disabled analytics/exporters, and no model turn.
Default listings retained A metadata after a B update, and retained B after
removal; forced reload reflected both changes. Body-only replacement changed
the wrapper's known digest but left the selected listing metadata unchanged,
even with forced reload. These are real local listing observations, separate
from the synthetic transport tests and historical injection metrics.

## Remaining-work audit after the listing experiment

The listing work is tracked in
[PR #15](https://github.com/KazuCocoa/renma-runtime-evidence/pull/15), with three
final real-runtime repetitions and 151 passing deterministic tests, 1 skipped.

- **Independent work completed:** inspected Renma identity, immutable manifest
  candidate rules, actual synthetic Git A/B synchronization, dirty/mismatch
  checks, provenance-separated OTLP v2 with independent schema decoding, and
  real no-model-turn local listing/cache/body-only characterization. Further
  repetitions of the same local fixtures would not resolve the remaining gaps.
- **Unsupported by the current evidence contract:** actual loaded/injected body
  revision, selection/execution guarantees, lifecycle ordering, and a TTL inferred
  from listing behavior. The measured listing predicates and name-only presence
  cannot supply these semantics. This is a limit of the tested evidence surfaces,
  not a claim that no runtime could ever expose another suitable signal.
- **Authentication resolved:** explicitly authorized ChatGPT file login and
  separate-analytics consent enabled the real three-row matrix. No API key was
  required in that mode. A runtime/host with explicit
  read/load and direct-invocation evidence is still needed for those distinctions;
  the current listing-only protocol does not supply them. Remote MCP freshness
  and deployed OTel backend compatibility remain untested and must not be inferred
  from local listing or protobuf-schema success.

That audit preceded the model and transport runs below. Its evidence rule still
applies: do not turn fixture results into model-run evidence or expand the
private package API to fill unsupported fields.

## ChatGPT-authenticated two-Skill matrix

The [real CLI 0.157.1 report](../experiments/codex-cli-integration/results/20260927-cli-0.157.1-chatgpt.json)
contains three completed processes with usable OTLP. Neither-requested produced
no target/control evidence or artifacts; each explicit request produced only its
own evidence and matching artifact. The fixed classifier returns
`requested-skill-only`. This single matrix does not prove a general execution,
selection, read, or revision contract. Authentication uses a temporary link to
caller-authorized file credentials; workspace and configuration homes remain
fresh, and API-key variables are not forwarded. The deterministic suite passes
154 tests with 1 skipped. The remaining lifecycle and remote-host questions are
not resolved by this result.

## Between-turn model freshness

The [CLI 0.157.1 model freshness experiment](../experiments/codex-model-freshness/README.md)
ran four real model turns in one server: initial A; B in the original thread;
B in a fresh thread; B after forced listing refresh in the original thread.
All completed, with artifact predicates A/B/B/B and listing metadata A/B/B/B.
The collector observed fixture presence across the whole server lifetime; no
per-turn or revision attribution is claimed. The default B listings differ from
the earlier listing-only cached-A result. Those sequences do not isolate why,
and neither result establishes a producer TTL. Deployment hashes and artifacts
remain wrapper evidence. The subsequent barrier experiment measures mid-turn replacement and a direct
capability condition. Explicit content-read evidence, remote freshness, and
deployed OTel integration remain incomplete.

## Mid-turn replacement and capability boundary

The [real barrier comparison](../experiments/codex-model-freshness/MIDTURN.md)
uses separate CLI 0.157.1 processes and collectors for direct-tool and
Skill-requested conditions. Both observed the exact capability request and
successful completion. The direct condition had a usable non-target metrics
pipeline without the Skill label; the Skill condition accepted the fixture label.
In the latter, B bytes were verified before the tool reply, the final listing
was B, and the artifact matched A. This distinguishes end-of-turn disk state
from observed behavior without claiming the provider injected A or that the
Skill caused the tool call. Frozen wrapper snapshots remain separate from
provider evidence. Tests: 164 passed, 1 skipped. Explicit body reads, remote
manifest freshness/TTL, and deployed OTel backend behavior are still unmeasured.

## Runtime-fed OTLP projection

The [live-input OTLP experiment](../experiments/codex-model-freshness/RUNTIME-OTEL.md)
connects a pre-bound known fixture snapshot directly to a dedicated real Codex
collector. Its new two-condition CLI 0.157.1 run preserves wrapper A in the
projected record despite the later B replacement. Provider fields carry only
presence; injected revision remains unsupported. The absent-presence condition
omits the candidate digest/revision. Synthetic test input, real provider input
on synthetic fixtures, and replayed real records are labeled distinctly.
Pinned protobuf decoding validates both synthetic packets and the saved real
records. This closes the live-input projection gap; deployed backend behavior,
arbitrary Renma adapters, and remote-host read/cache/TTL semantics are not proven.

## Integrated Git/runtime/OTLP transport

The [final integrated prototype](../experiments/codex-model-freshness/GIT-TRANSPORT.md)
uses actual temporary Git A/B commits and the live CLI collector in the same
run, then sends the reduced v2 record to an owned local HTTP receiver. Both
conditions received exact reduced records. The Skill condition's latest Git
state became B, while its transmitted wrapper candidate retained A; the direct
condition omitted the candidate hash. Provider fields contain no wrapper hash.
The [completion audit](experiment-conclusion.md) maps each planned track to its
proof and keeps broader unsupported/future work distinct.
