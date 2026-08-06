# `@renma/runtime-evidence`

This private, experimental package asks whether agent runtimes can expose privacy-preserving evidence about the Skills they inject into model context.

It is separate from Renma because Renma manages declared Skill assets, identities, relationships, lifecycle state, and repository evidence; it intentionally does not participate in runtime execution or collect runtime telemetry. This repository explores that runtime boundary without changing Renma.

Runtime evidence records observations, not semantic conclusions. It does not establish that a Skill was followed, that routing was correct, or that a task succeeded. Conversation content—including prompts, responses, reasoning, transcripts, source code, tool inputs, and tool outputs—is outside the collection boundary.

## Library status

The package now contains an initial private, pre-release library API for one supported capability: collector-lifetime presence of caller-allowlisted labels from a valid, recorded, strictly positive datapoint in Codex's exact `codex.skill.injected` counter with exact `status=ok`.

```ts
import { createCodexSkillEvidenceCollector } from "@renma/runtime-evidence";

const collector = await createCodexSkillEvidenceCollector({
  allowedSkills: ["my-allowed-skill"],
});

// The caller configures and launches Codex with collector.endpoint.
const snapshot = await collector.closeAndSnapshot();
```

The snapshot is provider-specific and reports only sorted, deduplicated injection presence plus a boolean for an otherwise valid successful positive label outside the caller allowlist. A datapoint marked OTLP `NO_RECORDED_VALUE`, or with a zero or negative counter value, cannot produce either form of presence. The numeric value and flags are discarded after structural validation and are never retained, exposed, logged, hashed, encoded, or counted. The snapshot has no raw-event callback and contains no count, order, timestamp, topology, agent attribution, unknown label, task output, or automatic persistence.

The allowlist accepts 1–128 input entries. Exact duplicates within that limit are deduplicated. Each well-formed name must contain 1–256 Unicode scalar values, encode to at most 1,024 UTF-8 bytes, and contain no C0, DEL, or C1 control character. The collector binds only to `127.0.0.1`, accepts only `POST /v1/metrics`, caps requests at 2 MiB, and uses a five-second graceful shutdown window before force-closing active connections.

See the [public snapshot schema](schema/codex-skill-presence-snapshot.schema.json) and the [initial API decision](docs/decisions/0001-codex-skill-injection-presence.md). This package remains `"private": true` and must not be published.

## Private installation

An authenticated GitHub dependency pinned to a reviewed commit or tag is the supported private consumption path:

```sh
npm install "github:KazuCocoa/renma-runtime-evidence#<commit-or-tag>"
```

The `prepare` lifecycle builds the TypeScript sources when npm installs the Git dependency. The resulting dependency includes only the runtime JavaScript, TypeScript declarations, snapshot schema, README, and npm package metadata. Tests, experiment output, local evidence, environment files, and credentials are excluded. npm-registry publication is unsupported and prohibited by `"private": true`.

## First experiment: Codex Skill injection

The first provider under investigation is Codex. On 2026-08-04, the experiment tested whether `codex-cli 0.146.0` could export the documented `skill.injected` counter to a user-controlled, loopback-only OpenTelemetry collector.

**Current result:** supported in the tested version. In three of three isolated runs, the local collector received the exact metric `codex.skill.injected` with the synthetic Skill name and `status=ok`. This demonstrates user-configured OTLP metrics export for `codex-cli 0.146.0`; it does not establish behavior in other versions or prove Skill execution, instruction compliance, or task success. See [the experiment protocol and evidence](experiments/codex-skill-injected/README.md) and [the observability model](docs/codex-observability.md).

`codex.skill.injected` is an OTLP counter, not a Skill lifecycle event. Repeated cumulative exports must not be interpreted as repeated Skill injection events. The experiment wrapper—not Codex—assigns `experimentRunId`, and `observedAt` records collector receipt time rather than Skill injection time. The counter alone cannot reconstruct ordered or nested Skill chains; production counter interpretation and correlation remain future work.

## Second experiment: Skill activation paths

On 2026-08-05, a second bounded experiment installed the same seven synthetic Skills in each isolated `codex-cli 0.146.0` process and varied five activation paths. Three runs were recorded per scenario.

The evidence was regenerated with a corrected collector lifecycle on 2026-08-06 JST: every run now drains accepted and in-flight metric requests after the Codex child exits and before snapshot creation. All 15 corrected presence sets and exit codes were checked; the observed scenario results were unchanged.

- discovered-only produced an empty allowlisted Skill set in 3/3 runs;
- explicit-single produced the one explicitly named label in 3/3 runs;
- explicit-multiple produced both explicitly named labels in 3/3 runs;
- router-to-target produced both the explicitly named router and its required target label in 3/3 runs; and
- a narrowly described implicit match produced its matching label in 3/3 observed runs.

These are version-specific process-level presence sets, not lifecycle events. The router observation does not establish ordering or a parent/child relationship, and the implicit sample does not establish deterministic selection. The metric cannot prove generic filesystem reading, instruction compliance, or task outcome. See [the activation-path protocol and evidence](experiments/codex-skill-activation-paths/README.md).

## Third experiment: Skill topology and subagent boundaries

On 2026-08-06, a third bounded experiment tested deeper and branching synthetic Skill topologies plus custom-agent child Skill configuration in `codex-cli 0.146.0`, with three runs per scenario. The retained evidence explicitly requested `gpt-5.6-sol` with `medium` reasoning for every parent invocation; the custom agents contained no model override. The model name is a mutable alias, not an immutable snapshot identifier.

Both chain depths were complete in 3/3 runs. Branching was variable: a simple branch produced root plus branch A in 3/3 runs and added branch B in 1/3, while a diamond produced all four labels in 1/3 runs. Child-only Skill labels reached the parent-configured loopback collector in 3/3 single-child, nested-child, and parallel runs. No exact allowlisted `codex.multi_agent.spawn` role was observed. All parent invocations exited `0`, but exit status and Skill co-presence do not prove that delegation occurred; actual subagent invocation and agent-level correlation remain inconclusive. These are only invocation-wide presence sets and do not prove topology edges, attribution, ordering, instruction compliance, or task success.

The committed artifact predates user Skill-location isolation: its output is finitely allowlisted, but its original invocation environment reused the caller's saved-login locations. The current runner instead requires `CODEX_API_KEY`, creates fresh per-run `HOME` and `CODEX_HOME` directories, and never forwards the caller's home paths. Because no API key was available for this update, the evidence remains unchanged and must not be treated as proof of the new input boundary. Administrator-provided and bundled system Skills may still exist independently of the project-scoped synthetic fixtures. See [the topology-boundary protocol, blocker, and retained evidence](experiments/codex-skill-topology-boundaries/README.md).

## Fourth experiment: subagent spawn signals

The fourth bounded experiment narrows the unresolved topology result to the exact `codex.multi_agent.spawn` counter. Across dormant, single, nested, and parallel synthetic custom-agent scenarios, its collector distinguishes an unobserved metric, an observed metric without points, an allowlisted role, a discarded non-allowlisted role, and missing/non-string/duplicated role attributes. Unknown values are neither retained nor hashed; output is limited to booleans, finite classifications, and exact synthetic roles.

The runner fixes three isolated parent invocations per scenario with `codex-cli 0.146.0`, model `gpt-5.6-sol`, medium reasoning, API-key-only authentication, fresh workspace/`HOME`/`CODEX_HOME`, ephemeral execution, and discarded task streams. No runtime evidence was generated because `CODEX_API_KEY` was unavailable; saved login was not inspected or reused. See [the spawn-signal protocol, collector boundary, and regeneration blocker](experiments/codex-subagent-spawn-signals/README.md).

## Development

```sh
npm ci
npm run check
```

CI runs on pull requests and pushes to `main` with Node.js 22 and 24. Each
matrix job installs the locked npm dependency graph with `npm ci`, then runs
the supported build, TypeScript typecheck, Prettier formatting check, and test
scripts. The repository has no separate lint script, so CI does not invent a
lint toolchain.

The library collector tests use small OTLP/HTTP fixtures delivered over an
ephemeral loopback port. They deterministically cover exact successful,
recorded, strictly positive `codex.skill.injected` datapoints; multiple and
repeated allowlisted labels; unknown-label classification without disclosure;
ignored non-success, non-positive, and unrelated observations; fail-closed
malformed requests; mixed accepted and rejected observations; canonical
order-independent snapshots; clean shutdown and draining; and exclusion of raw
payloads and disallowed fields from the public result.

These tests establish only sorted, deduplicated Skill presence across one
collector lifetime. The result exposes no occurrence counts, execution claim,
ordering, session or agent attribution, nesting, or dependency edges. An
[opt-in local integration experiment](experiments/codex-cli-integration/README.md)
now exercises the public collector with a real authenticated Codex CLI. Run it
explicitly with `npm run test:integration:codex`; ordinary tests, package
installation, and CI do not launch Codex or contact external model services.

This package has `"private": true` and must not be published to npm.
