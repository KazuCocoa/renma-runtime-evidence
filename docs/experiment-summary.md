# Experiment summary

This is the entry point for the completed experiment program through [PR #22](https://github.com/KazuCocoa/renma-runtime-evidence/pull/22), the summary/baseline in [PR #23](https://github.com/KazuCocoa/renma-runtime-evidence/pull/23), the operational lifecycle follow-up, and the completed local six-track program below. The earlier five-track program and the portfolio-telemetry follow-up are complete within their documented experimental boundaries. Historical blocked/unfinished entries describe the state at that time, not the current completion state.

## Conclusions

- Actual Codex metrics identify allowlisted Skill names and supported counter samples. UTC **receipt time** can support a dashboard. Neither is proof of task execution, success, exact injection time, or Skill-to-tool causality.
- Stable Renma IDs can join observations across Skill rename, plugin move and version changes when a deployment manifest is frozen before the Codex process starts and the mapping stays unambiguous. Hot updates can mix deployment candidates within one producer. Renma's canonical field is the string key `metadata["renma.id"]`; the earlier nested-object fixture was only a wrapper-assigned mapping. Provider labels do not prove injected file revision.
- A shared receiver worked with concurrent Codex processes and two cooperative synthetic plugins. Both port ownership and MCP server-name collisions matter. An existing exporter must be preserved; a plugin-only, zero-setup installer is not established.
- Actual HTTP 503 and TCP outage experiments recovered new traffic, but did not recover the tested missing traffic within their observation windows. No samples is **unknown**, not zero. Receiver health, exposure, outages and process/receiver epochs matter for archive decisions.
- All runtime content is discarded before persistence. Retained evidence is explicitly allowlisted; provider facts, wrapper facts, synthetic tests and replayed saved reports remain distinct.

## Results and PR history

| Work                                                     | Outcome                                                                                                                         | Detailed evidence / PR                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial presence, activation paths and bounded collector | Actual counter presence; activation paths characterized; topology/causality limits retained                                     | [Initial experiment](../experiments/codex-skill-injected/README.md), [PR #1](https://github.com/KazuCocoa/renma-runtime-evidence/pull/1) through [PR #8](https://github.com/KazuCocoa/renma-runtime-evidence/pull/8) |
| Selection, deployment identity, Git and cache/freshness  | Requested/unrequested comparison; immutable deployment provenance; real listing and update boundaries                           | [Five-track conclusion](experiment-conclusion.md), PR #9 and PR #11–20                                                                                                                                               |
| ChatGPT login for real CLI experiments                   | Existing ChatGPT file login linked into isolated homes; explicit analytics consent                                              | [PR #16](https://github.com/KazuCocoa/renma-runtime-evidence/pull/16); subsequent live reports use this mode                                                                                                         |
| Usage quantities, UTC observation and plugin packaging   | Actual delta increments, receipt times, declared metadata and exposure inventory; per-thread receiver conflict found            | [Observation inventory](skill-usage-telemetry.md), [PR #21](https://github.com/KazuCocoa/renma-runtime-evidence/pull/21)                                                                                             |
| Coexistence, loss/recovery, time and real Renma identity | Concurrent producers/consumers, collision failure controls, outage limits, canonical ID extraction and live changed-label joins | [Completion audit](telemetry-followup-experiments.md), [PR #22](https://github.com/KazuCocoa/renma-runtime-evidence/pull/22)                                                                                         |
| Effective configuration and MCP lifecycle                | Disable quoting resolved; old processes survive transitions; fresh threads follow current state                                 | [Lifecycle evidence](../experiments/codex-plugin-lifecycle/README.md), [PR #24](https://github.com/KazuCocoa/renma-runtime-evidence/pull/24)                                                                         |
| Live lifecycle injection and delivery                    | Two runs, 21 completed turns; disable/update/removal receipt matrix; mixed-version limits                                       | [Live results](../experiments/codex-plugin-lifecycle/README.md#live-skill-injection-and-metric-delivery-across-transitions), [PR #25](https://github.com/KazuCocoa/renma-runtime-evidence/pull/25)                   |

The live lifecycle follow-up passed 208 local tests, with one historical skip. The preceding process-lifecycle changes passed Node 22/24 CI on PR #24. Live model evidence is stored separately from the deterministic tests. The historical skipped subagent test has no runtime evidence and supports no conclusion.

## Reading order

1. [What the dashboard can observe](skill-usage-telemetry.md).
2. [Follow-up requirement-to-evidence audit](telemetry-followup-experiments.md).
3. [Initial program conclusion and unsupported claims](experiment-conclusion.md).
4. [Chronological progress](experiment-progress.md) and experiment-specific READMEs for reproduction and failed controls.

## Operational lifecycle follow-up

The operational follow-up measures update/disable/uninstall behavior and observation coverage, separately from the original program above. The [operational lifecycle experiment](../experiments/codex-plugin-lifecycle/README.md) now includes the metadata baseline, effective disable/re-enable checks and actual MCP process heartbeats across updates/removal. Existing processes survived disable/removal; fresh threads followed current configuration. Updated and old observer revisions coexisted. Its coverage table separates inventory, consumer liveness, receiver health and actual sample receipt. The live follow-up now adds two real model-turn/OTLP runs: existing threads emit after disable, fresh disabled threads do not yield target receipts in the tested windows, re-enable restores receipts, both thread categories emit after update, and removal yields no new target receipts. A hot update can mix deployment versions within one producer; exact injected revision remains unresolved.

## Local six-track follow-up ([PR #26](https://github.com/KazuCocoa/renma-runtime-evidence/pull/26))

The [local telemetry system](../experiments/local-telemetry-system/README.md) completes the next six tracks within an explicitly local scope: real Git/Renma sync provenance, conservative hot-update resolution, plugin portability/removal, OTLP delivery faults, a browser-verified dashboard and an actual runtime compatibility matrix.

Ten additional model turns produced ten persisted provider delta samples: six on macOS arm64 CLI 0.157.1, two on macOS arm64 CLI 0.156.0 and two on Linux arm64 Docker CLI 0.157.1. The [60-turn ledger](../experiments/local-telemetry-system/results/model-turn-ledger.json) accounts for all ten attempts. Installed Skill bytes match the frozen manifest; Git hashes identify source/deployment candidates, not injected revision. The same MCP configuration connected in two isolated homes, but explicit shared broker/exporter setup remains necessary.

A real Docker OTel Collector forwarded normalized, allowlisted OTLP/HTTP JSON logs. Synthetic fault tests show retry/auth recovery and exact-record deduplication. The memory-only Collector queue did not recover a pending record after a forced restart in the measured window despite an earlier HTTP 200. Wrapper guarantees remain separate from provider-exporter behavior. Backend/sender persistence tests reinitialize objects from disk; they do not establish OS-crash or power-loss durability.

The [dashboard](../experiments/local-telemetry-system/results/dashboard.png) displays saved actual observations, UTC receipt filters, provenance candidates and unknown coverage; synthetic delivery checkpoints are separate. Start it with `node .build/experiments/local-telemetry-system/src/dashboard.js 18581` after building. Windows, x64, Desktop runtime, persistent Collector queues, remote production transport and automatic archival decisions remain outside the verified scope. Local validation passed **220 tests**, with one historical skip; live provider runs are separate evidence.

See the [six-track audit and reproduction instructions](../experiments/local-telemetry-system/README.md) for each result and its boundary. No production backend was selected or deployed.

## Additional local operational experiments ([PR #27](https://github.com/KazuCocoa/renma-runtime-evidence/pull/27))

The [five-area follow-up](../experiments/telemetry-hardening/README.md) now tests process-level crash/restart, persistent Collector queues and saturation, local TLS/credential rotation, larger authored catalogs and concurrent storage, plugin update/remove coexistence, and seven rendered aggregation boundary cases. No new model turns were used.

Eight queued observations survived a persistent Collector's forced container replacement. With queue size four, four requests were accepted and recovered while twelve received 503. Sender/backend OS-process restarts preserved one stored record without double-counting its retry. Local certificate/hostname failures and bad or revoked credentials were rejected; timeout-after-storage retries were deduplicated.

The load experiment cataloged 20 real authored Git roots / 1,000 Skills and stored 4,096 synthetic records through a separate indexed-envelope prototype. This does not generalize the previous two-Skill schema: its sender/backend still reject their 256/1,024 capacities. The dashboard now labels interval gaps; zero, absence, delayed arrival, exact duplication, overlap and mixed-version cases have API and browser evidence. The detailed audit distinguishes these measured outcomes from provider delivery guarantees, power-loss durability, sustained production load and remote service integration.
