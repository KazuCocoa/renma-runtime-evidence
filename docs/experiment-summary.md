# Experiment summary

This is the entry point for the completed experiment program through [PR #22](https://github.com/KazuCocoa/renma-runtime-evidence/pull/22), the summary/baseline in [PR #23](https://github.com/KazuCocoa/renma-runtime-evidence/pull/23), and the operational lifecycle follow-up below. The earlier five-track program and the portfolio-telemetry follow-up are complete within their documented experimental boundaries. Historical blocked/unfinished entries describe the state at that time, not the current completion state.

## Conclusions

- Actual Codex metrics identify allowlisted Skill names and supported counter samples. UTC **receipt time** can support a dashboard. Neither is proof of task execution, success, exact injection time, or Skill-to-tool causality.
- Stable Renma IDs can join observations across Skill rename, plugin move and version changes when a deployment manifest is frozen before the Codex process starts. Renma's canonical field is the string key `metadata["renma.id"]`; the earlier nested-object fixture was only a wrapper-assigned mapping. Provider labels do not prove injected file revision.
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

The operational lifecycle follow-up passed 205 local tests, with one historical skip. The preceding baseline passed Node 22/24 CI on PR #23 and merged main. Live model evidence is stored separately from the deterministic tests. The historical skipped subagent test has no runtime evidence and supports no conclusion.

## Reading order

1. [What the dashboard can observe](skill-usage-telemetry.md).
2. [Follow-up requirement-to-evidence audit](telemetry-followup-experiments.md).
3. [Initial program conclusion and unsupported claims](experiment-conclusion.md).
4. [Chronological progress](experiment-progress.md) and experiment-specific READMEs for reproduction and failed controls.

## Next phase

The next operational checks are update/disable/uninstall behavior and observation coverage. These should establish what happens to existing processes, cached bundles and shared exporter settings, and how the dashboard distinguishes available-but-unobserved from unavailable/unobserved coverage. They are separate from the completed program above. The [operational lifecycle experiment](../experiments/codex-plugin-lifecycle/README.md) now includes the metadata baseline, effective disable/re-enable checks and actual MCP process heartbeats across updates/removal. Existing processes survived disable/removal; fresh threads followed current configuration. Updated and old observer revisions coexisted. Its coverage table separates inventory, consumer liveness, receiver health and actual sample receipt. Model behavior and metric delivery through these lifecycle transitions remain unmeasured.

A real backend has not been selected. Backend delivery guarantees and cross-version/platform compatibility need their own targets and tests; they are not silently included in the local prototype's claims. No dashboard, production collector, or automatic archival decision is implemented by these experiments.
