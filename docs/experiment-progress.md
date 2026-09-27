# Continuation experiment ledger

Scope: [Issue #10](https://github.com/KazuCocoa/renma-runtime-evidence/issues/10)
and the static/runtime boundary in
[Renma #174](https://github.com/KazuCocoa/renma/issues/174). A phase is complete
only when its stated evidence exists; fixtures cannot satisfy runtime criteria.

| Phase                      | Completion criterion                                                                                        | 2026-09-27 status                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Two-Skill characterization | Three isolated real CLI rows with usable pipeline and finite result                                         | Blocked before launch: this process has no `CODEX_API_KEY`; separate analytics acknowledgement pending                 |
| Identity manifest          | Inspect actual Renma identity and test immutable deployment mapping, collisions, modifications, missing IDs | Local fixture implemented; experimental, not a public runtime contract                                                 |
| Lifecycle/freshness        | Real host listing/read/direct invocation and bounded A/B updates; unsupported states explicit               | Local Git and real CLI 0.157.1 listing refresh/body-only boundary tested; model-turn and remote-cache behavior not run |
| Provenance/OTel            | Minimal allowlisted transport with provider and deployment provenance separate                              | Synthetic OTLP v2 single-record projection and pinned protobuf decoder tested; no runtime/backend claim                |
| Consumer boundary          | Document and version only demonstrated semantics                                                            | Existing provider-specific presence API retained; experimental field contract documented separately                    |

Baseline: remote/main `3d237e85dc61419bda92a720e8bdbd1b5710dd33`, no open PR,
clean checkout, installed CLI `0.157.1`. Baseline checks: 131 passed, 1 skipped.
The restricted shell initially prevented loopback binding and npm packing;
the same checks passed with required local permissions and a temporary npm cache.

Previous CLI `0.146.0` quota/rate-limit results remain historical. No 0.157.1 two-Skill injection
matrix was launched, no saved credentials were read or copied, and no inference
about 0.157.1 metric semantics follows from a missing API key.

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
validates fixture messages using the pinned official schema and a protobuf decoder. All new OTLP transport input is synthetic. A separate no-model-turn app-server
experiment now provides real listing evidence; it does not provide injection
or capability-invocation evidence.
Independent local work proceeds while the external prerequisites are unresolved.
The existing characterization runner requires explicit analytics consent because
Codex's separate OpenAI analytics path is not controlled by the loopback exporter.
Secrets must be configured in the execution environment, never pasted into a
report or committed. Authentication failures must not trigger unchanged retries.

## Remaining external boundary

The independent filesystem, Git, and synthetic transport steps are complete as
fixtures. The overall experiment is **not complete**. The real CLI 0.157.1 listing experiment measured cached versus forced
refresh and a body-only update with unchanged listing metadata. No two-Skill
selection matrix, mid-model-turn update, direct capability/Skill comparison,
body-read/injection attribution, or remote-host cache behavior has been measured. The API key and analytics question remain open.

Resume the isolated two-Skill runner only after both prerequisites are supplied.
If it reports authentication/quota failure, retain only the fixed category and
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
- **External prerequisites pending:** a usable execution-environment API key and
  explicit separate-analytics acknowledgement for the existing two-Skill metric
  runner and subsequent model-turn experiments. A runtime/host with explicit
  read/load and direct-invocation evidence is still needed for those distinctions;
  the current listing-only protocol does not supply them. Remote MCP freshness
  and deployed OTel backend compatibility remain untested and must not be inferred
  from local listing or protobuf-schema success.

The overall goal remains unfinished. Resume the pending real experiments when
those prerequisites exist; do not turn fixture results into model-run evidence
or expand the private package API to fill unsupported fields.
