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

Classify the direct pipeline before spending model usage on any other scenario:

```sh
npm run test:integration:codex -- --allow-codex-analytics --direct-only
```

This installs only the direct synthetic Skill and launches exactly one real Codex task process for the direct single-Skill baseline; no custom-agent fixture is installed. It writes the Codex version, command category, separate diagnostics snapshot, six-stage classification, public presence result, and limitations to stderr. Stdout remains only the existing public `CodexSkillPresenceSnapshot`; diagnostics are never nested into that evidence result. Every task process has a three-minute timeout, and the Codex prerequisite probes have ten-second timeouts.

Only after the direct pipeline has been classified, the pre-existing full scenario set can be run explicitly without `--direct-only`:

```sh
npm run test:integration:codex -- --allow-codex-analytics
```

When multi-agent support is available, the full command launches five real Codex task processes and can consume normal Codex or API usage: one direct run, two independent repeated runs, one nested run, and one subagent run. The normal `npm test`, `npm run check`, package installation, and GitHub Actions workflow do not invoke either command because they require explicit analytics consent, local authentication, external model access, and usage that deterministic CI must not assume.

For the full command, the human-readable evidence summary followed by a separate diagnostics snapshot and classification for every collector lifetime is written to stderr. Stdout is one machine-readable JSON document containing only the provider, exact exported metric name, detected Codex version, `codexAnalyticsExplicitlyAllowed: true`, public collector semantics, finite scenario statuses, exact synthetic allowlisted identifiers, an unknown-label boolean, and explicit false limitation claims. The repeated result contains two separately reported runs. Diagnostic counters never appear in that public report.

No report is written by default. To create one, choose a new destination explicitly:

```sh
npm run test:integration:codex -- --allow-codex-analytics --output /tmp/codex-integration-result.json
```

The flags may appear in any order. With `--direct-only`, the destination receives only the public direct evidence snapshot. The harness refuses to overwrite an existing output file.

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

## Pipeline diagnostic classification

The diagnostics snapshot is a separate immutable receiver result containing only saturating unsigned 32-bit counters and a saturation boolean. It exposes no raw strings or identifiers. The classifier applies these stages in order:

1. `no-otlp-request`: no `POST /v1/metrics` reached the receiver. Investigate the effective child-process exporter configuration and shutdown flushing.
2. `request-decode-failure`: a request arrived, but none decoded successfully. Fixed counters further distinguish request-read, body-size, JSON-syntax, and OTLP-validation failures without retaining input.
3. `decoded-without-metric-datapoints`: valid OTLP metrics arrived, but no metric datapoints were present. This also covers an observed target metric with an empty datapoint list.
4. `non-target-metric-datapoints-only`: ordinary datapoints arrived, but no `codex.skill.injected` datapoints did. This means only that the tested Codex version and Skill-loading path did not emit the target metric; it is not proof that the Skill was not used.
5. `target-datapoints-rejected`: target datapoints arrived, but none met all current status, recorded-positive-value, and allowlisted-label evidence rules. Only bounded status, numeric-sign, and unknown-or-missing-label counts are shown.
6. `accepted-skill-evidence`: at least one target datapoint satisfied every current evidence rule.

Diagnostic datapoint counts are transport counts, not provider event counts. Cumulative exports can repeat the same counter state.

## Direct pipeline result (2026-08-07)

The authenticated direct-only baseline ran with `codex-cli 0.146.0`. Its command category was `direct single-Skill baseline`; the temporary repository contained only the direct synthetic Skill, and no repeated, nested, or subagent task was run.

```json
{
  "schemaVersion": 1,
  "otlpMetricsRequestsReceived": 1,
  "successfullyDecodedRequests": 1,
  "decodeFailures": 0,
  "requestReadFailures": 0,
  "requestBodyTooLargeFailures": 0,
  "jsonParseFailures": 0,
  "otlpValidationFailures": 0,
  "resourceMetricsEntriesInspected": 1,
  "scopeMetricsEntriesInspected": 1,
  "metricsInspected": 46,
  "metricDataPointsInspected": 131,
  "targetMetricsObserved": 1,
  "targetDataPointsObserved": 1,
  "targetDataPointsWithStatusOk": 1,
  "targetDataPointsWithStatusError": 0,
  "targetDataPointsWithOtherOrMissingStatus": 0,
  "positiveTargetDataPoints": 0,
  "zeroTargetDataPoints": 0,
  "negativeTargetDataPoints": 0,
  "targetDataPointsWithNoRecordedValue": 0,
  "targetDataPointsWithUnsupportedOrMissingValue": 1,
  "acceptedAllowlistedSkillDataPoints": 0,
  "unknownOrMissingSkillLabelDataPoints": 0,
  "counterSaturationObserved": false
}
```

Classification: `target-datapoints-rejected` (stage 5). The target metric arrived with exact `status=ok` and an allowlisted Skill label, but its value had no numeric representation supported by the current public evidence rules. Consequently the public presence snapshot was empty. This does not show that the Skill was unused, and it does not justify an execution, occurrence-count, ordering, session, nesting-edge, agent-attribution, causality, instruction-compliance, or task-success claim. No raw value, payload, arbitrary metric or attribute data, identifier, prompt, response, transcript, or tool data was retained.

## Privacy, traffic, and evidence boundary

The invocation has several distinct data paths:

- OTel logs are disabled with `otel.exporter="none"`, and user-prompt logging is explicitly disabled.
- OTel traces are disabled with `otel.trace_exporter="none"`.
- The configured OTel metrics exporter sends to the harness's ephemeral `127.0.0.1` endpoint.
- Because `analytics.enabled=true` is required for those configured metrics to be emitted, Codex may separately send analytics events to OpenAI. The mandatory flag acknowledges this; the loopback metrics endpoint does not control that traffic.
- Normal model/API traffic still goes to the service required by the authenticated Codex task and can consume usage.

For every run, the local evidence collector is configured with only that scenario's exact synthetic Skill identifiers. It discards all non-allowlisted content before producing its public result and never exposes raw OTLP. Task stdout and stderr are discarded, and `--ephemeral` prevents session rollout persistence. The harness never records Codex prompts, responses, reasoning, transcripts, source content, tool inputs, tool outputs, full configuration, credentials, raw telemetry, analytics events, or temporary/user paths.

The command intentionally reuses the caller's normal Codex authentication location because authentication is a prerequisite, but `--ignore-user-config` prevents the invocation from loading the user's `config.toml`. It never modifies `~/.codex/config.toml`. All telemetry changes are invocation-scoped. For the spawned child only, the experiment temporarily selects the runtime-evidence loopback endpoint as the effective metrics exporter; this may replace another effective metrics exporter for that process. No relay or fan-out behavior is implemented. The temporary git repository is the only mutated repository and is removed after the run.

The only supported evidence is collector-lifetime presence of an exact allowlisted Skill label from a valid, recorded, strictly positive `codex.skill.injected` datapoint with `status=ok`. The experiment does not claim Skill execution, occurrence counts, ordering, session or turn attribution, nesting edges, agent attribution, instruction compliance, task success, or causality.

## Result template

Do not commit locally generated reports. A review note can use this bounded template without transcripts or raw telemetry:

```text
Date:
Codex version:
Command category: direct single-Skill baseline
Codex analytics explicitly allowed: true
Collector semantics: presence
direct: supported | failed; observed Skill IDs:
diagnostics snapshot:
pipeline classification: no-otlp-request | request-decode-failure |
  decoded-without-metric-datapoints | non-target-metric-datapoints-only |
  target-datapoints-rejected | accepted-skill-evidence
Compatibility or execution limitation:

No execution, count, ordering, session, nesting-edge, agent-attribution,
instruction-compliance, or task-success claim is made.
```
