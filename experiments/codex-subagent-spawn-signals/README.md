# Codex subagent spawn-signal experiment

This bounded experiment asks why the earlier topology experiment retained no allowlisted `codex.multi_agent.spawn` roles. It observes only the exact provider metric name and classifies each of its counter data points into a finite privacy-safe state. It deliberately does not collect `codex.skill.injected`, attempt agent-to-Skill attribution, evaluate child output, or infer topology.

**Runtime evidence status: not generated.** `CODEX_API_KEY` is unavailable in the implementation environment. The saved-login fallback is prohibited, so no real parent invocation was attempted and no evidence file was created or fabricated.

## Question and finite result shape

For each isolated parent invocation, the collector retains only:

```ts
interface SpawnSignalObservation {
  spawnMetricObserved: boolean;
  spawnDataPointObserved: boolean;
  spawnRoleClassifications: Array<
    | "allowlisted-role"
    | "non-allowlisted-role"
    | "missing-role"
    | "non-string-role"
    | "duplicate-role-attribute"
  >;
  spawnedRoles: SyntheticAgentRole[];
}
```

`spawnMetricObserved` becomes true only when the exact name `codex.multi_agent.spawn` is encountered. `spawnDataPointObserved` becomes true only when at least one point is encountered in that counter's `sum.dataPoints`. The classification and role arrays are sorted and deduplicated presence sets; they retain neither counter values nor occurrence counts.

An exact finite synthetic role produces `allowlisted-role` and may enter `spawnedRoles`. Any other string produces only `non-allowlisted-role`; its value is immediately discarded without hashing, encoding, logging, or persistence. A point with no exact `role` attribute, one whose value is not an OTLP JSON string value, or more than one exact `role` attribute produces the corresponding finite classification only.

This distinguishes:

1. exact metric not observed;
2. exact metric observed without a counter data point;
3. a point with an expected finite synthetic role;
4. a point with a discarded role outside the finite allowlist; and
5. a point with a missing, non-string, or duplicated role attribute.

## Scenarios

The runner fixes the matrix at four scenarios and exactly three fresh parent invocations per scenario:

| Scenario                 | Controlled parent behavior                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `custom-agents-dormant`  | Install all fixed custom-agent definitions, invoke the dormant orchestrator Skill, and prohibit spawning.                                                                                                             |
| `single-custom-agent`    | Invoke an orchestrator Skill that requests exactly `renma_spawn_signal_worker_20260806` and waits for it.                                                                                                             |
| `nested-custom-agent`    | Invoke an orchestrator Skill that requests exactly `renma_spawn_signal_nested_worker_20260806` and waits. That agent's controlled configuration invokes a two-Skill synthetic child chain without further delegation. |
| `parallel-custom-agents` | Invoke an orchestrator Skill that requests the finite alpha and beta roles in parallel and waits for both.                                                                                                            |

Every parent prompt names exactly one scenario-specific synthetic orchestrator Skill. It contains no custom-agent role or child Skill name. Role names occur only in the controlled orchestrator fixtures; child Skill names occur only in the controlled custom-agent and Skill fixtures. Every participant returns a fixed synthetic acknowledgement. Codex stdout and stderr are connected to discard streams and are never read, retained, evaluated, or persisted.

All five custom-agent definitions and all six synthetic Skill fixtures are installed in every fresh workspace. Installing the dormant role is part of the negative control; installation itself is not interpreted as a spawn.

## Collector and privacy boundary

The loopback collector accepts only `POST /v1/metrics`, bounds each request at 2 MiB, parses OTLP JSON in memory, and immediately collapses accepted input into the finite observation. Raw request chunks are cleared after parsing or rejection. Malformed JSON and malformed required OTLP envelope/target shapes receive a rejection and do not modify the observation.

The parser compares only the exact metric name, the exact `role` key, and the finite role values. It does not retain raw attribute keys or values, unknown-role sentinels, hashes, encodings, counter values, exemplars, resource or scope attributes, prompts, responses, reasoning, transcripts, tool inputs, tool outputs, credentials, paths, nicknames, run identifiers, agent identifiers, thread identifiers, or parent/child identifiers. Non-target metrics—including `codex.skill.injected`—are discarded.

Multiple cumulative exports merge into finite sorted presence sets. The collector stops new connections and drains accepted in-flight requests before returning a snapshot. Repeated calls return the same snapshot.

The strict schema at [`schema/spawn-signals-report.schema.json`](schema/spawn-signals-report.schema.json) fixes the provider, experiment, CLI version, model, reasoning effort, API-key isolation mode, four-scenario order, three-run cardinality, classification domain, and role domain. No runtime evidence is committed for this experiment while the API-key regeneration blocker remains.

## Authentication and execution isolation

Before any scenario begins, the runner:

- requires `CODEX_API_KEY` and rejects implicit saved-login authentication;
- verifies the exact installed version `codex-cli 0.146.0`;
- requires exactly three runs, model `gpt-5.6-sol`, and reasoning effort `medium`;
- constructs helper environments from a finite non-authentication environment-variable allowlist;
- creates a fresh per-run isolation root with distinct workspace, `HOME`, and `CODEX_HOME` directories;
- verifies that the isolated `HOME` and `CODEX_HOME` are empty;
- never reads, copies, or forwards the caller's `HOME` or `CODEX_HOME`;
- launches `codex exec --ephemeral` with ignored user config/rules, explicit multi-agent enablement, a read-only sandbox, and no approvals;
- disables OTel logs and traces, keeps prompt logging disabled, and points only metrics at the ephemeral loopback collector; and
- closes the collector and removes the complete per-run isolation root in nested `finally` cleanup.

The runner writes a normalized report only after all 12 parent invocations exit successfully. A missing API key, wrong CLI/configuration, failed invocation, malformed fixture, or incomplete matrix prevents any new report from being written. Its failure message contains no exception details or filesystem paths.

This boundary isolates the caller's user and Codex-state locations; it does not claim that administrator-provided or bundled system Skills are absent, or that a read-only sandbox makes every host-level read impossible. Those remain provider execution boundaries, not collected evidence.

## Interpretation boundary

- `spawnMetricObserved: false` means only that the exact metric was not observed by this collector in that invocation. It does not mean unsupported and does not prove that no spawn occurred.
- `non-allowlisted-role` means only that the provider emitted a string role outside this experiment's finite allowlist. It does not reveal or identify the value.
- An allowlisted role is evidence that the provider emitted the exact spawn metric with that finite role. It does not prove the child completed, followed instructions, injected a Skill, or produced a successful result.
- Counter-derived presence cannot establish event counts or ordering.
- Even if Skill observations were added later, invocation-wide Skill/role co-presence would not establish an agent → Skill edge. This experiment avoids that comparison entirely.
- The nested and parallel behavior is declared by controlled fixtures. Runtime spawn-signal evidence does not reconstruct those edges.
- Renma remains responsible for statically declared dependency topology.

## Reproduce

Prerequisites are Node.js 22 or newer, `codex-cli 0.146.0`, and an explicit API key supplied through a secure process environment.

```sh
npm ci
npm run check
CODEX_API_KEY="$CODEX_API_KEY" npm run experiment:codex:subagent-spawn-signals -- \
  --runs 3 \
  --model gpt-5.6-sol \
  --reasoning-effort medium
git diff --check
```

On complete success, the ignored local report is written to:

```text
experiments/codex-subagent-spawn-signals/.local/experiment-report.json
```

To create reviewable evidence, rerun with `--output experiments/codex-subagent-spawn-signals/evidence/codex-cli-0.146.0.json`, inspect the finite artifact, and replace this blocker section with a table headed `### Actual normalized observations`. Evidence must not be committed unless all 12 isolated invocations complete.

## Remaining production-design limits

Before designing a production `@renma/runtime-evidence` API, this experiment still leaves the following unresolved:

- whether the exact metric and `role` shape are stable, documented support across Codex versions rather than one provider/version observation;
- how exporter loss, shutdown timing, cumulative counter resets, and invocation boundaries should be represented without inventing events or counts;
- how provider-specific evidence should remain distinguishable from any future normalized cross-provider layer;
- which explicit finite allowlists and schema-versioning rules a production collector would require;
- how authentication, host isolation, request limits, and failure semantics should be exposed without accepting saved state or content; and
- the product boundary between runtime observations and Renma's static dependency topology.

This experiment does not add production collection, Renma integration, a CLI product, a public package API, task evaluation, threat detection, npm publication, or general-purpose agent orchestration.
