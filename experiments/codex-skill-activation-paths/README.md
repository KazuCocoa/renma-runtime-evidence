# Codex Skill activation-path experiment

## Question

Which activation paths produced allowlisted `codex.skill.injected` labels in isolated `codex-cli 0.146.0` processes, and could each process be reduced to a privacy-safe set of synthetic Skill names?

Experiment date: **2026-08-05 UTC** (corrected harness rerun completed 2026-08-06 JST)

Recorded environment:

- `codex-cli 0.146.0`
- macOS 26.5.2 (25F84), arm64
- Node.js v24.18.0

## Result

In this version and environment, the explicit-single, explicit-multiple, router-to-target, and implicit-match scenarios produced allowlisted `codex.skill.injected` labels in all three observed runs. The discovered-only scenario produced an empty allowlisted set in all three runs. Every Codex process exited with status `0`.

The committed evidence was regenerated after correcting the collector lifecycle. For every corrected run, the runner waited for the Codex child to exit, stopped the collector, drained already accepted and in-flight requests, awaited server shutdown, and only then created the normalized presence set. All 15 corrected presence sets and process exit codes were checked. The scenario results did not change from the earlier racy run; the tables below reflect only the corrected evidence.

| Scenario          | Run 1                                                                                 | Run 2                                                                                 | Run 3                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| discovered-only   | `[]`                                                                                  | `[]`                                                                                  | `[]`                                                                                  |
| explicit-single   | `[renma-activation-explicit-single-20260805]`                                         | `[renma-activation-explicit-single-20260805]`                                         | `[renma-activation-explicit-single-20260805]`                                         |
| explicit-multiple | `[renma-activation-explicit-alpha-20260805, renma-activation-explicit-beta-20260805]` | `[renma-activation-explicit-alpha-20260805, renma-activation-explicit-beta-20260805]` | `[renma-activation-explicit-alpha-20260805, renma-activation-explicit-beta-20260805]` |
| router-to-target  | `[renma-activation-router-20260805, renma-activation-router-target-20260805]`         | `[renma-activation-router-20260805, renma-activation-router-target-20260805]`         | `[renma-activation-router-20260805, renma-activation-router-target-20260805]`         |
| implicit-match    | `[renma-activation-implicit-20260805]`                                                | `[renma-activation-implicit-20260805]`                                                | `[renma-activation-implicit-20260805]`                                                |

The arrays are normalized presence sets: they are sorted and deduplicated. Their order does not represent OTLP export order, injection order, or a Skill chain.

The privacy-safe normalized evidence is recorded in [`evidence/codex-cli-0.146.0.json`](evidence/codex-cli-0.146.0.json). No raw OTLP payload, Codex prompt, response, transcript, reasoning, tool input, or tool output is recorded.

### Scenario matrix

Every run installed the same seven uniquely named synthetic Skills. Holding discovery constant isolates the prompt and instruction path varied by each scenario.

| Scenario          | Activation path                                                                | Version-specific observation                                                                                |
| ----------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| discovered-only   | No `$skill-name`; a neutral synthetic control request matched no fixture.      | No allowlisted synthetic Skill label was observed in 3/3 runs.                                              |
| explicit-single   | The prompt named one fixture with `$skill-name`.                               | The explicitly named Skill was observed in 3/3 runs.                                                        |
| explicit-multiple | The prompt named two fixtures with `$skill-name`.                              | Both explicitly named Skills were observed as a deduplicated set in 3/3 runs.                               |
| router-to-target  | The prompt named a router whose instructions required a second target Skill.   | Both router and target labels were observed in 3/3 runs.                                                    |
| implicit-match    | No `$skill-name`; one description narrowly matched a unique synthetic request. | The matching Skill was observed in 3/3 runs. This observed sample does not establish deterministic support. |

The router result does not establish injection order, parent/child identity, or why the target was injected. If a future run omits the target label, that absence would mean only that the allowlisted target injection signal was not observed. It would not prove that the target file was unread or its instructions were ignored.

The implicit result is deliberately reported by observed runs. Skill selection can depend on runtime version, model behavior, descriptions, and prompt wording; three positive runs do not establish a universal or deterministic implicit-selection guarantee.

## Observation boundary

These concepts remain separate:

| Concept                 | What this experiment can say                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Discovery               | Fixtures were installed where Codex could discover them. The injection counter is not evidence of discovery by itself. |
| Injection               | An exact allowlisted name with exact `status=ok` was present in `codex.skill.injected` for the isolated process.       |
| Generic filesystem read | Unsupported by this metric. No direct-file-read scenario was added.                                                    |
| Instruction compliance  | Unsupported. The runner discards the response and does not judge whether Skill instructions were followed.             |
| Task outcome            | Unsupported. A process exit code is retained, but it is not a task-success evaluation.                                 |

`codex.skill.injected` is a counter-derived presence signal, not a lifecycle event. Repeated cumulative exports are collapsed into one name in the process-level set. The experiment does not infer invocation counts, session or turn identity, ordering, nesting, instruction compliance, or task success.

Provider-specific evidence remains distinguishable from normalization: `exportedMetric` records the exact Codex instrument name, while each run's `injectedSkills` array is the experiment's sorted, deduplicated representation of accepted Codex labels.

## Isolation and privacy controls

For each of the 15 runs, the runner:

- created a fresh temporary workspace and installed only the seven synthetic fixtures;
- launched a separate `codex exec` process with `--ephemeral` and `--ignore-user-config`;
- used a read-only sandbox, disabled approvals, and skipped repository checks;
- disabled OTel logs and traces and kept `otel.log_user_prompt=false`;
- replaced the metrics exporter with OTLP/HTTP JSON on an ephemeral `127.0.0.1` port;
- discarded Codex stdout and stderr; and
- after the Codex child exited, stopped the collector and drained accepted requests before creating the presence-set snapshot; and
- removed the temporary workspace after collector shutdown and snapshot creation.

The collector holds each request body only long enough to parse it in memory and never writes raw OTLP. Its idempotent `closeAndSnapshot()` operation stops new connections, waits for `server.close()`, explicitly waits for accepted requests to finish processing, and normalizes only after both drain conditions complete. Before persistence, it accepts only:

- the exact `codex.skill.injected` instrument;
- one of five finite scenario identifiers supplied by the wrapper;
- one of seven exact synthetic Skill names; and
- the exact `status=ok` value.

Unknown names, every other status, malformed duplicate allowlisted attributes, non-target metrics, unexpected attributes, and content-bearing fields are discarded. An empty accepted set is persisted as `injectedSkills: []`; it is not converted into an experiment failure or filled through inference.

Retained run evidence contains only the schema version, provider, finite experiment and scenario identifiers, sorted synthetic Skill-name set, exact verified status when a set is non-empty, locally measured environment, collector receipt metadata, wrapper-generated pseudonymous run ID, and Codex process exit code.

## Reproduce

Prerequisites:

- Node.js 22 or newer;
- an authenticated `codex` CLI installation; and
- `codex-cli 0.146.0` to reproduce the recorded version.

Run:

```sh
npm ci
npm run check
npm run experiment:codex:activation-paths -- --runs 3
```

The ignored local report is written to:

```text
experiments/codex-skill-activation-paths/.local/experiment-report.json
```

The console summary contains only allowlisted experiment metadata, the recorded environment, counts of runs with non-empty allowlisted sets, and a failed-process count. It does not include Codex responses. The runner returns a failing status when any Codex child does not exit successfully; an empty allowlisted Skill set with exit status `0` remains a valid observation.

## Non-goals

This bounded experiment does not add production aggregation, Renma correlation, direct filesystem-read observation, a Codex plugin, task or routing evaluation, per-session or per-turn correlation, chain reconstruction, or a production Skill execution tracker.
