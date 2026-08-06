# Codex Skill topology-boundary experiment

## Questions

In isolated `codex-cli 0.146.0` processes:

1. Do allowlisted `codex.skill.injected` labels remain observable across deeper and branching synthetic Skill topologies?
2. When a synthetic orchestrator asks Codex to spawn a custom subagent whose configuration invokes a child Skill, do that child-only label and an allowlisted `codex.multi_agent.spawn` role reach the same user-configured OTLP metrics collector?

Experiment date: **2026-08-06 UTC**

Recorded environment:

- `codex-cli 0.146.0`
- macOS 26.5.2 (25F84), arm64
- Node.js v24.18.0
- requested model identifier `gpt-5.6-sol`
- requested reasoning effort `medium`

The runner passed that model and reasoning effort explicitly to every parent `codex exec`. The custom-agent fixtures contain no model overrides, so the documented configuration behavior is inheritance from the parent if a child is actually spawned. `gpt-5.6-sol` is a requested model alias, not evidence of an immutable model snapshot; reproduction remains bounded by alias mutability.

This is a bounded provider experiment. It does not add production collection or Renma integration.

## Result

All 24 Codex parent invocations accepted the supplied configuration and exited with status `0`. Parent exit status records process completion only. It does not prove that delegation occurred, that a requested subagent was spawned, or that instructions were followed.

Phase A showed complete depth-two and depth-three Skill-label presence in all three runs. Branching was not consistently complete: the simple branch observed root plus branch A in all three runs and added branch B in one run. The diamond observed all four labels in one run and only root plus shared target in two runs. A missing expected label remains an observation, not a harness failure and not evidence that a file was unread or an instruction was ignored.

In Phase B, the dormant custom-agent configuration produced only the explicitly invoked dormant orchestrator label and no accepted role in all three runs. The child-only Skill label appeared at the same collector as the parent orchestrator in all three single-child runs. The reused depth-two chain's three labels appeared with the parent orchestrator in all three nested-child runs. Both parallel child labels appeared with the parent orchestrator in all three parallel runs.

No exact allowlisted synthetic role was observed from `codex.multi_agent.spawn` in any Phase B run. The experiment therefore found invocation-wide co-presence of parent and child-only Skill labels, but it did not find an accepted signal proving that a particular subagent was spawned. Actual subagent invocation and agent-level attribution remain inconclusive under this privacy boundary. The evidence cannot establish which agent injected any Skill or convert co-presence into a parent → role → Skill edge. It also cannot distinguish an absent metric export from a metric data point discarded because its `role` was outside the finite allowlist; raw OTLP is intentionally never retained. These outcomes are “not observed,” not evidence that the workflow was unsupported or did not occur.

### Actual normalized presence sets

Every array is sorted and deduplicated. Its order has no runtime meaning.

| Scenario                  | Run | `injectedSkills`                                                                                                                                                     | `spawnedRoles` |
| ------------------------- | --: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `nested-chain-depth-2`    |   1 | `[renma-topology-depth2-level1-20260806, renma-topology-depth2-level2-20260806, renma-topology-depth2-root-20260806]`                                                | `[]`           |
| `nested-chain-depth-2`    |   2 | `[renma-topology-depth2-level1-20260806, renma-topology-depth2-level2-20260806, renma-topology-depth2-root-20260806]`                                                | `[]`           |
| `nested-chain-depth-2`    |   3 | `[renma-topology-depth2-level1-20260806, renma-topology-depth2-level2-20260806, renma-topology-depth2-root-20260806]`                                                | `[]`           |
| `nested-chain-depth-3`    |   1 | `[renma-topology-depth3-level1-20260806, renma-topology-depth3-level2-20260806, renma-topology-depth3-level3-20260806, renma-topology-depth3-root-20260806]`         | `[]`           |
| `nested-chain-depth-3`    |   2 | `[renma-topology-depth3-level1-20260806, renma-topology-depth3-level2-20260806, renma-topology-depth3-level3-20260806, renma-topology-depth3-root-20260806]`         | `[]`           |
| `nested-chain-depth-3`    |   3 | `[renma-topology-depth3-level1-20260806, renma-topology-depth3-level2-20260806, renma-topology-depth3-level3-20260806, renma-topology-depth3-root-20260806]`         | `[]`           |
| `nested-branch`           |   1 | `[renma-topology-branch-a-20260806, renma-topology-branch-b-20260806, renma-topology-branch-root-20260806]`                                                          | `[]`           |
| `nested-branch`           |   2 | `[renma-topology-branch-a-20260806, renma-topology-branch-root-20260806]`                                                                                            | `[]`           |
| `nested-branch`           |   3 | `[renma-topology-branch-a-20260806, renma-topology-branch-root-20260806]`                                                                                            | `[]`           |
| `nested-diamond`          |   1 | `[renma-topology-diamond-branch-a-20260806, renma-topology-diamond-branch-b-20260806, renma-topology-diamond-root-20260806, renma-topology-diamond-shared-20260806]` | `[]`           |
| `nested-diamond`          |   2 | `[renma-topology-diamond-root-20260806, renma-topology-diamond-shared-20260806]`                                                                                     | `[]`           |
| `nested-diamond`          |   3 | `[renma-topology-diamond-root-20260806, renma-topology-diamond-shared-20260806]`                                                                                     | `[]`           |
| `subagent-config-dormant` |   1 | `[renma-topology-orchestrator-dormant-20260806]`                                                                                                                     | `[]`           |
| `subagent-config-dormant` |   2 | `[renma-topology-orchestrator-dormant-20260806]`                                                                                                                     | `[]`           |
| `subagent-config-dormant` |   3 | `[renma-topology-orchestrator-dormant-20260806]`                                                                                                                     | `[]`           |
| `subagent-single-skill`   |   1 | `[renma-topology-child-single-20260806, renma-topology-orchestrator-single-20260806]`                                                                                | `[]`           |
| `subagent-single-skill`   |   2 | `[renma-topology-child-single-20260806, renma-topology-orchestrator-single-20260806]`                                                                                | `[]`           |
| `subagent-single-skill`   |   3 | `[renma-topology-child-single-20260806, renma-topology-orchestrator-single-20260806]`                                                                                | `[]`           |
| `subagent-nested-chain`   |   1 | `[renma-topology-depth2-level1-20260806, renma-topology-depth2-level2-20260806, renma-topology-depth2-root-20260806, renma-topology-orchestrator-chain-20260806]`    | `[]`           |
| `subagent-nested-chain`   |   2 | `[renma-topology-depth2-level1-20260806, renma-topology-depth2-level2-20260806, renma-topology-depth2-root-20260806, renma-topology-orchestrator-chain-20260806]`    | `[]`           |
| `subagent-nested-chain`   |   3 | `[renma-topology-depth2-level1-20260806, renma-topology-depth2-level2-20260806, renma-topology-depth2-root-20260806, renma-topology-orchestrator-chain-20260806]`    | `[]`           |
| `subagent-parallel`       |   1 | `[renma-topology-child-alpha-20260806, renma-topology-child-beta-20260806, renma-topology-orchestrator-parallel-20260806]`                                           | `[]`           |
| `subagent-parallel`       |   2 | `[renma-topology-child-alpha-20260806, renma-topology-child-beta-20260806, renma-topology-orchestrator-parallel-20260806]`                                           | `[]`           |
| `subagent-parallel`       |   3 | `[renma-topology-child-alpha-20260806, renma-topology-child-beta-20260806, renma-topology-orchestrator-parallel-20260806]`                                           | `[]`           |

The privacy-safe normalized evidence is recorded in [`evidence/codex-cli-0.146.0.json`](evidence/codex-cli-0.146.0.json). It contains no raw OTLP payload, prompt, response, reasoning, transcript, tool input, tool output, task result, or agent-thread identifier.

## Scenario matrix

All 22 synthetic Skill fixtures were installed in every isolated process. The user prompt named only the scenario root Skill. Descendant Skill names occurred only in the fixture/configuration path, not in the user prompt.

### Phase A: multi-level nesting without subagents

No custom-agent configuration was installed in Phase A. Every Phase A Skill fixture explicitly prohibited delegation and subagent creation.

| Scenario               | Synthetic instruction topology      | Observation                                                      |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `nested-chain-depth-2` | root → level 1 → level 2            | All three labels observed in 3/3 runs.                           |
| `nested-chain-depth-3` | root → level 1 → level 2 → level 3  | All four labels observed in 3/3 runs.                            |
| `nested-branch`        | root → branch A and branch B        | Root and branch A in 3/3; branch B in 1/3.                       |
| `nested-diamond`       | root → branches A/B → shared target | Root/shared in 3/3; both branches in the same one of three runs. |

These presence sets do not prove the illustrated edges, order, repeated injection, or instruction compliance. The topology is declared by the static fixtures; runtime evidence does not reconstruct it.

### Phase B: custom-agent boundary

Every Phase B run installed the same five project-scoped custom-agent TOML fixtures under the temporary workspace's `.codex/agents/` directory. The parent prompt explicitly invoked only a scenario-specific orchestrator Skill. Each spawning orchestrator named only its finite custom-agent role, not its child Skill. The child Skill invocation appeared in that role's `developer_instructions`; the nested child root then named its descendants in its own Skill instructions. The parent orchestrators required all requested subagents to finish before responding.

| Scenario                  | Synthetic configuration path                                       | Observation                                                      |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `subagent-config-dormant` | dormant orchestrator; custom agents defined but no spawn requested | Orchestrator only in 3/3; no dormant child and no accepted role. |
| `subagent-single-skill`   | orchestrator → custom role → child Skill                           | Parent and child-only Skill labels in 3/3; no accepted role.     |
| `subagent-nested-chain`   | orchestrator → custom role → reused Phase A depth-two chain        | Parent and all three chain labels in 3/3; no accepted role.      |
| `subagent-parallel`       | orchestrator → alpha/beta roles → distinct child Skills            | Parent plus both child labels in 3/3; no accepted role.          |

[OpenAI's subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents) describes subagents as separate agent threads, project-scoped custom-agent files, and inheritance of unoverridden session settings such as `skills.config`. The [documented metrics catalog](https://learn.chatgpt.com/docs/config-file/config-advanced) lists `skill.injected` with `status` and `skill`, and `multi_agent.spawn` with `role`; it does not document a Skill-to-agent, thread, or parent-thread correlation field. This experiment treats those statements as current documentation and every observation as specific to the installed CLI version.

## Observation and interpretation boundary

Renma and runtime evidence have separate responsibilities:

- Renma owns declared Skill dependencies and the expected transitive closure.
- This repository records only exact runtime-observed provider labels accepted by a finite allowlist.
- Runtime evidence must not reconstruct dependency edges already available statically.
- `expected but not observed` means only that a provider label was not observed. It does not prove that a Skill file was not read or its instructions were not followed.
- `observed but undeclared` could be recorded by a future correlation layer, but this experiment does not compare observations with Renma declarations.
- Co-presence of a custom-agent role and a Skill label would not establish attribution. In these runs, no allowlisted role was co-present.
- Parallel and nested presence sets do not establish order, parent/child identity, invocation count, or execution count.
- `not observed`, `unsupported`, and `did not occur` are distinct. This experiment records the first and cannot establish either of the latter two for subagent spawning.

`codex.skill.injected` and `codex.multi_agent.spawn` are counter-derived presence signals, not lifecycle events. Repeated cumulative exports collapse into deduplicated sets. The collector does not retain values or exemplars. Provider-specific instrument/attribute acceptance remains explicit in the collector; the report stores only the normalized `injectedSkills` and `spawnedRoles` sets.

The child-only Skill observations show that those labels reached the same loopback collector as the parent invocation's labels under this configuration. They do not prove that a subagent was spawned or that a particular role used a particular Skill. Because no allowlisted spawn role was observed, both actual subagent invocation and role-level correlation are inconclusive in this sample. Parent exit code `0` does not strengthen that conclusion.

## Isolation and privacy controls

For each of the 24 runs, the runner:

- created a fresh temporary workspace;
- installed only fixed synthetic Skills and, in Phase B, fixed synthetic custom agents;
- launched one separate parent `codex exec --ephemeral` process with `--ignore-user-config`, `--ignore-rules`, explicit multi-agent enablement, `--model gpt-5.6-sol`, and `model_reasoning_effort="medium"`;
- used a read-only sandbox, disabled approvals, and skipped the temporary workspace's Git check;
- disabled OTel logs and traces and kept `otel.log_user_prompt=false`;
- redirected metrics only to an ephemeral OTLP/HTTP JSON endpoint on `127.0.0.1`;
- discarded Codex stdout and stderr;
- waited for the parent process to exit; Phase B fixtures required the parent to wait for every requested subagent before completing;
- stopped new collector connections, drained accepted in-flight requests, and only then created the normalized snapshot; and
- removed the temporary workspace in a `finally` cleanup.

The runner never passes `process.env` through to a child. It constructs a finite execution-only environment for version/host helpers, then adds the separate authentication allowlist only for Codex authentication checks and experiment invocations. It forwards only defined values for these names:

- executable and runtime handling: `PATH`, `TMPDIR`, `TMP`, `TEMP`, `LANG`, `LC_ALL`, and `LC_CTYPE`;
- authentication lookup: `HOME`, `CODEX_HOME`, and `CODEX_API_KEY`.

Undefined variables are omitted. The runner requires `PATH` plus at least one explicit authentication route and checks saved-login status before starting scenario runs when `CODEX_API_KEY` is absent. If authentication or an invocation fails, it stops without forwarding additional variables. No environment values are recorded in console summaries or evidence.

The runner does not inspect Codex session stores, transcripts, JSONL, local databases, notifications, user history, or task output. It does not use `notify`. Raw OTLP request bodies exist only in memory while being bounded and parsed and are never persisted.

The collector accepts only:

- exact `codex.skill.injected` points with one finite synthetic `skill` and exact `status=ok`; and
- exact `codex.multi_agent.spawn` points with one finite synthetic `role`.

It discards unknown names/roles, every other status, malformed duplicate allowlisted attributes, non-target metrics, counter values, exemplars, resource/scope attributes, unexpected IDs or nicknames, and all content-bearing fields before normalization. Empty Skill and role sets remain valid observations.

Retained evidence is limited to schema/date/provider/experiment/scenario identifiers, the exact requested model identifier and reasoning effort, non-identifying environment metadata, wrapper-generated pseudonymous run ID, Codex exit status, sorted presence sets, exact verified Skill status when applicable, and first accepted collector receipt time. It contains no inferred edges, ordering, counts, task results, responses, or compliance judgments.

The normalized artifact is privacy-safe within that allowlist. Residual execution boundaries remain: Codex must receive the minimum authentication variables above, authentication state remains accessible to the Codex process, and a read-only sandbox prevents writes but does not by itself guarantee that every host-level read is impossible. The experiment therefore minimizes inputs and persistence; it does not claim that executing Codex is equivalent to an isolated zero-access environment.

## Reproduce

Prerequisites:

- Node.js 22 or newer;
- an authenticated `codex` CLI installation; and
- `codex-cli 0.146.0` to reproduce the recorded version.

Run:

```sh
npm ci
npm run check
npm run experiment:codex:skill-topology-boundaries -- \
  --runs 3 \
  --model gpt-5.6-sol \
  --reasoning-effort medium
git diff --check
```

The ignored local report is written to:

```text
experiments/codex-skill-topology-boundaries/.local/experiment-report.json
```

The console summary contains only allowlisted experiment/environment metadata, per-scenario counts of runs with non-empty Skill/role sets, and a failed-process count. Missing labels do not fail the harness. A nonzero/null Codex process status or malformed experiment configuration does.

## Non-goals

This experiment does not add production aggregation, Renma comparison/integration, direct filesystem-read observation, agent/thread attribution, dependency reconstruction, ordering, execution tracking, task evaluation, threat detection, a Codex plugin, or agent orchestration beyond the bounded synthetic experiment itself.
