# `@renma/runtime-evidence`

This private, experimental package asks whether agent runtimes can expose privacy-preserving evidence about the Skills they inject into model context.

It is separate from Renma because Renma manages declared Skill assets, identities, relationships, lifecycle state, and repository evidence; it intentionally does not participate in runtime execution or collect runtime telemetry. This repository explores that runtime boundary without changing Renma.

Runtime evidence records observations, not semantic conclusions. It does not establish that a Skill was followed, that routing was correct, or that a task succeeded. Conversation content—including prompts, responses, reasoning, transcripts, source code, tool inputs, and tool outputs—is outside the collection boundary.

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

## Development

```sh
npm ci
npm run check
```

This package has `"private": true` and must not be published to npm.
