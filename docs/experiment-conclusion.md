# Five-track experiment conclusion

The experiment program tests whether Codex Skill-name evidence can be combined
with explicit asset/deployment version information, including Git commits, while
preserving the distinction between provider evidence and wrapper knowledge.
It characterizes supported observations and unsupported claims; it does not
require inventing an injected-body revision when Codex reports only a name.

## Requirement-by-requirement evidence

| Requirement                                                                         | Authoritative evidence                                                                                                                                                         | Outcome and limit                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete the two-Skill requested/unrequested comparison                             | [CLI 0.157.1 report](../experiments/codex-cli-integration/results/20260927-cli-0.157.1-chatgpt.json)                                                                           | Three completed real rows with usable OTLP; requested-skill-only in that matrix. No general selection/execution guarantee.                                                                                           |
| Define identity/name/revision mapping, collision and local-change rules             | [Manifest implementation/tests](../experiments/deployment-snapshot/README.md)                                                                                                  | Explicit Renma-style fixture IDs, known content digests, optional source commit; duplicate/same-name rows stay ambiguous, missing rows unmapped, and modified bytes separate.                                        |
| Check actual Renma identity semantics                                               | [Pinned Renma inspection](../experiments/deployment-snapshot/README.md)                                                                                                        | `metadata.renma.id` / catalog ID, exact content hash and unverified source revision remain different concepts. No arbitrary-path identity exported.                                                                  |
| Test real Git synchronization and immutable deployment state                        | [Git fixture](../experiments/deployment-snapshot/src/run-git-fixture.ts) and [tests](../experiments/deployment-snapshot/test/git-deployment.test.ts)                           | Actual temporary commits/clone/fetch/checkout and dirty content demonstrate that latest source, HEAD and deployed file bytes can differ. Provider revision remains unsupported.                                      |
| Test listing cache and unchanged-name/body updates                                  | [Real listing characterization](../experiments/codex-listing-freshness/README.md)                                                                                              | Default versus forced metadata refresh measured in three runs; body-only changes are invisible in the selected listing metadata even after force reload.                                                             |
| Test updates before subsequent model turns                                          | [Four-turn report](../experiments/codex-model-freshness/results/20260927-cli-0.157.1.json)                                                                                     | Real original/fresh-thread behavior A/B/B/B; no causal explanation of cache invalidation or TTL inferred.                                                                                                            |
| Test updates during a model turn and distinguish direct capability observations     | [Barrier comparison](../experiments/codex-model-freshness/MIDTURN.md)                                                                                                          | Correlated tool requests/completions observed in both conditions. B verified before replying to the Skill condition, followed by an A artifact. Tool events, artifact predicates and Skill presence remain separate. |
| Produce/send minimal OTLP with distinct source provenance and a frozen Git revision | [Live Git/OTLP transport](../experiments/codex-model-freshness/GIT-TRANSPORT.md)                                                                                               | Real Codex reduction sent over local HTTP with actual synthetic Git A commit/digest retained after B. No commit in provider fields; absent presence omits the candidate.                                             |
| Independently validate representation and preserve pairing                          | [Synthetic v2 transport/schema checks](../experiments/deployment-snapshot/OTEL.md) and [runtime v1/v2 checks](../experiments/codex-model-freshness/test/runtime-otel.test.ts)  | Pinned official protobuf encode/decode equality; provider/deployment groups stay in one record. Saved-record replay is labeled separately from live observation.                                                     |
| Version only demonstrated semantics and define consumer responsibility              | [Consumer boundary](../experiments/codex-model-freshness/RUNTIME-OTEL.md), [package surface](../src/index.ts), [package-consumption test](../test/package-consumption.test.ts) | Supported private package API remains version-1 Codex collector-lifetime presence. Experimental wrapper schemas are versioned separately; no universal lifecycle/causal/revision contract is published.              |

## What the program establishes

A wrapper can retain and transmit a known deployment's Git commit and content
digest alongside a real provider name-presence observation. It must freeze that
state before collection and keep its provenance distinct. The measured mid-turn
A-behavior/B-deployment case demonstrates why looking up the latest revision
when telemetry arrives is insufficient. Even a unique name and matching wrapper
digest do not establish which body revision the provider injected.

This is the conclusion of the bounded five-track experiment program. The earlier
ledger's authentication blocks and incomplete local-runtime/OTLP stages have
been resolved. The evidence supports a small provider-specific collector and
experimental wrapper candidates. It does not justify promoting those candidates
to a general loaded/executed revision or shipping a general Renma adapter.

## Explicitly unsupported or outside the measured program

- Provider-reported Skill body revision/read identity, Skill-to-tool causality,
  complete lifecycle ordering, and general selection/execution guarantees remain
  unsupported by the characterized surfaces. The reports preserve that result.
- Remote MCP manifest/resource cache behavior, producer TTL/cache scope and
  deployed-backend ingestion/indexing have not been measured. Local listings,
  dynamic tools, loopback receipt and protobuf compatibility are not substitutes.
- A production sync plugin, arbitrary-repository adapter, backend delivery/retry
  system, or universal Observation schema requires a separate design decision.
  [Renma #174](https://github.com/KazuCocoa/renma/issues/174) explicitly describes
  future design work, not an immediate implementation requirement.
- [Issue #10](https://github.com/KazuCocoa/renma-runtime-evidence/issues/10) remains
  open for broader host/lifecycle/freshness research. This program's completion
  does not claim that every candidate research question in that issue is solved.

No remote target or production backend was specified for this prototype; their
absence is not treated as a blocker to the local, bounded experiment. Any future
claim about them needs a selected host/protocol/receiver and its own real evidence.

## Privacy and validation

Live runners use the installed Codex CLI, explicit analytics opt-in, caller-
authorized ChatGPT file authentication, fresh scenario homes, and ephemeral
threads. Credential contents are not read/copied by the wrapper. Raw prompts,
responses, reasoning, transcripts, tool payloads and telemetry are not retained.
Reducers reconstruct only fixed allowlisted fields; unknown values are rejected
or reduced to finite booleans/enums. Only authored fixture bytes are hashed.
Provider signals, wrapper facts, synthetic tests and saved-record validation are
kept distinguishable throughout.

The normal suite exercises these boundaries, temporary cleanup, actual synthetic
Git operations, loopback transport and packed-package consumption. One historical
subagent-evidence test is intentionally skipped because its old isolated API-key
run generated no runtime evidence; it is not used to support any conclusion in
this program. Opt-in model runs are backed by the separate committed reports,
not by synthetic test success.
