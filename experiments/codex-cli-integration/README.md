# Local Codex CLI integration experiment

This local, opt-in experiment invokes the real installed `codex` command and feeds only exact allowlisted `codex.skill.injected` metric labels into the public `@renma/runtime-evidence` collector. It asks whether four bounded synthetic scenarios produce collector-lifetime Skill presence. It is not a Skill execution test.

## Prerequisites and explicit consent

- Node.js 22 or newer;
- dependencies installed with `npm ci`;
- `codex-cli 0.146.0` or newer, with the invocation-scoped flags and OTel metrics configuration used by the harness; and
- an existing usable Codex login established through the normal `codex login` flow.

The command requires `--allow-codex-analytics`. Without that exact flag, it fails before creating a collector, running a Codex prerequisite probe, or launching a Codex task.

This acknowledgement is required because Codex gates the configured OTel metrics exporter behind `analytics.enabled`. The harness therefore sets `analytics.enabled=true`, which may also cause Codex to send separate analytics events to OpenAI. Pointing the configured OTel metrics exporter at a loopback endpoint does not control that separate analytics path. The harness does not intercept, inspect, redirect, or retain those separate analytics events.

The harness checks `codex --version`, the required `codex exec` flags, and `codex login status` without printing authentication output. It uses the existing login only for the child invocation. It does not read, copy, print, or persist credentials. If the installed CLI cannot safely accept the telemetry configuration through `-c` overrides, strict configuration causes a clear failing result; the harness never edits `~/.codex/config.toml` or another persistent Codex location.

The Skill layout and explicit invocation syntax follow the current Codex documentation: repository Skills are installed under `.agents/skills`, and the prompt uses `$skill-name`. The subagent scenario also installs one project-scoped custom agent under `.codex/agents`. See [Build skills](https://developers.openai.com/codex/skills), [multi-agent behavior](https://developers.openai.com/codex/multi-agent), and [advanced configuration](https://developers.openai.com/codex/config-file/config-advanced).

## Run

```sh
npm run test:integration:codex -- --allow-codex-analytics
```

When multi-agent support is available, this launches five real Codex task processes and can consume normal Codex or API usage: one direct run, two independent repeated runs, one nested run, and one subagent run. Every task process has a three-minute timeout; the Codex prerequisite probes have ten-second timeouts. The normal `npm test`, `npm run check`, package installation, and GitHub Actions workflow do not invoke this command because it requires explicit analytics consent, local authentication, external model access, and usage that deterministic CI must not assume.

The human-readable summary is written to stderr. Stdout is one machine-readable JSON document containing only the provider, exact exported metric name, detected Codex version, `codexAnalyticsExplicitlyAllowed: true`, public collector semantics, finite scenario statuses, exact synthetic allowlisted identifiers, an unknown-label boolean, and explicit false limitation claims. The repeated result contains two separately reported runs.

No report is written by default. To create one, choose a new destination explicitly:

```sh
npm run test:integration:codex -- --allow-codex-analytics --output /tmp/codex-integration-result.json
```

The two flags may appear in either order. The harness refuses to overwrite an existing output file.

## Scenarios

| Scenario | Invocation                                                                                 | Interpretation                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| direct   | Explicitly requests one synthetic repository-local Skill.                                  | Required baseline. Its exact label must be present and the process must succeed, or the command exits nonzero.                                             |
| repeated | Runs the same explicit request twice, creating and closing a fresh collector for each run. | Both processes must succeed and both independent snapshots must contain the exact label. Each run is reported separately; no occurrence count is inferred. |
| nested   | A requested synthetic parent tells Codex to use a synthetic child Skill.                   | Reports whether each label was present. Co-presence does not establish an edge, ordering, or execution.                                                    |
| subagent | A requested parent asks a custom subagent to explicitly use a child Skill.                 | Reports invocation-wide presence. It cannot attribute a label to an agent.                                                                                 |

Collector creation resolves only after its loopback server is listening on an ephemeral port, which is the readiness signal. Each individual task run has its own collector lifetime: the harness waits for the Codex child process to exit, calls the collector's idempotent `closeAndSnapshot()`, and closes that collector before starting the next run. That operation stops new connections, drains accepted and in-flight requests, and returns the public snapshot. There is no telemetry flush sleep. Temporary files and child processes are cleaned up on normal completion, failure, timeout, `SIGINT`, and `SIGTERM`.

Within-collector deduplication remains covered by deterministic fixture and unit tests. This real integration scenario checks repeatability across two independent collector lifetimes and does not measure or infer injection counts.

## Result meanings

- `supported`: the required process succeeded and the exact positive allowlisted label or labels were present in the relevant public snapshot. The repeated scenario is supported only when both independently reported runs are supported.
- `inconclusive`: the Codex process completed, but an optional nested or subagent label was absent. This is not proof that a file was unread, instructions were ignored, or delegation did not occur.
- `unsupported`: the detected CLI does not expose multi-agent support, or the bounded subagent invocation cannot run. This does not weaken or simulate the direct baseline.
- `failed`: a required process could not run, or the direct/repeated expected label was absent. The command exits nonzero.

A missing command, incompatible version, missing login, unavailable required invocation configuration, timeout, or failed direct/repeated baseline is never reported as a passing test.

## Privacy, traffic, and evidence boundary

The invocation has several distinct data paths:

- OTel logs are disabled with `otel.exporter="none"`, and user-prompt logging is explicitly disabled.
- OTel traces are disabled with `otel.trace_exporter="none"`.
- The configured OTel metrics exporter sends to the harness's ephemeral `127.0.0.1` endpoint.
- Because `analytics.enabled=true` is required for those configured metrics to be emitted, Codex may separately send analytics events to OpenAI. The mandatory flag acknowledges this; the loopback metrics endpoint does not control that traffic.
- Normal model/API traffic still goes to the service required by the authenticated Codex task and can consume usage.

For every run, the local evidence collector is configured with only that scenario's exact synthetic Skill identifiers. It discards all non-allowlisted content before producing its public result and never exposes raw OTLP. Task stdout and stderr are discarded, and `--ephemeral` prevents session rollout persistence. The harness never records Codex prompts, responses, reasoning, transcripts, source content, tool inputs, tool outputs, full configuration, credentials, raw telemetry, analytics events, or temporary/user paths.

The command intentionally reuses the caller's normal Codex authentication location because authentication is a prerequisite, but `--ignore-user-config` prevents the invocation from loading the user's `config.toml`. All telemetry changes are invocation-scoped. The temporary git repository is the only mutated repository and is removed after the run.

The only supported evidence is collector-lifetime presence of an exact allowlisted Skill label from a valid, recorded, strictly positive `codex.skill.injected` datapoint with `status=ok`. The experiment does not claim Skill execution, occurrence counts, ordering, session or turn attribution, nesting edges, agent attribution, instruction compliance, task success, or causality.

## Result template

Do not commit locally generated reports. A review note can use this bounded template without transcripts or raw telemetry:

```text
Date:
Codex version:
Command: npm run test:integration:codex -- --allow-codex-analytics
Codex analytics explicitly allowed: true
Collector semantics: presence
direct: supported | failed; observed Skill IDs:
repeated run 1: supported | failed; observed Skill IDs:
repeated run 2: supported | failed; observed Skill IDs:
repeated overall: supported | failed
nested: supported | inconclusive | failed; observed Skill IDs:
subagent: supported | inconclusive | unsupported; observed Skill IDs:
Compatibility limitation:

No execution, count, ordering, session, nesting-edge, agent-attribution,
instruction-compliance, or task-success claim is made.
```
