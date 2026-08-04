# Codex `skill.injected` export experiment

## Question

Can `codex-cli 0.146.0` export evidence that an explicitly named synthetic Skill was injected into model context through a user-controlled local OpenTelemetry metrics exporter?

Experiment date: **2026-08-04**

Synthetic Skill: **`renma-runtime-evidence-canary-20260804`**

Recorded environment:

- `codex-cli 0.146.0`
- macOS 26.5.2 (25F84), arm64
- Node.js v24.18.0

## Isolation and privacy controls

The runner creates a temporary workspace and copies only the synthetic `SKILL.md` into `.agents/skills`. Each Codex invocation uses:

- `--ephemeral` so Codex does not persist a session file;
- `--ignore-user-config` so the normal `~/.codex/config.toml` is not loaded or changed;
- a read-only sandbox with approvals disabled;
- `otel.log_user_prompt=false`;
- disabled OTel log and trace exporters; and
- an OTLP/HTTP JSON metrics exporter bound to an ephemeral `127.0.0.1` port.

Codex metrics instrumentation remains enabled because `analytics.enabled=false` suppresses the user-configured metrics exporter as well as the default analytics path in version 0.146.0. Overriding `otel.metrics_exporter` replaces the default Statsig exporter with the loopback-only endpoint.

The runner discards Codex stdout and stderr. The collector never writes an OTLP request body. It persists only observations that match both the exact exported metric name `codex.skill.injected` and the exact synthetic Skill name. On those observations it retains only the `skill` and `status` attributes, then adds the locally measured Codex version, collector receipt time, provider, observation type, and a local pseudonymous run ID.

## Reproduce

Prerequisites:

- Node.js 22 or newer;
- an authenticated `codex` CLI installation; and
- `codex-cli 0.146.0` to reproduce the exact recorded environment.

Run:

```sh
npm ci
npm run check
npm run experiment:codex -- --runs 3
```

The ignored local report is written to:

```text
experiments/codex-skill-injected/.local/experiment-report.json
```

Expected privacy-safe console output contains only the experiment date, Codex version, provider, target metric name, synthetic Skill name, requested run count, and the number of runs in which the target was observed. Codex's response is discarded.

## Result

**Supported for `codex-cli 0.146.0`.** The loopback collector received `codex.skill.injected` in three of three independent Codex processes. All processes exited successfully.

Observed exported name and fields:

| OTLP instrument        | `skill`                                  | `status` | Runs observed |
| ---------------------- | ---------------------------------------- | -------- | ------------- |
| `codex.skill.injected` | `renma-runtime-evidence-canary-20260804` | `ok`     | 3/3           |

The privacy-safe normalized observations are recorded in [`evidence/codex-cli-0.146.0.json`](evidence/codex-cli-0.146.0.json). No raw OTLP payload is stored.

The exported Skill string exactly matched the unique synthetic Skill's frontmatter name, so it can correlate this canary with a future Renma asset identity. The result does not prove that arbitrary Skill names are globally unique; Codex can discover duplicate names, and a future mapping must account for that ambiguity without collecting absolute paths.

### Metric-counter boundary

`codex.skill.injected` is an OTLP counter, not a Skill lifecycle event. The one-process-per-run design establishes counter presence for one explicit Skill invocation, but does not establish event ordering or per-session/per-turn correlation in a long-lived process.

- Repeated cumulative exports must not be interpreted as repeated Skill injection events.
- `experimentRunId` is assigned by this experiment wrapper, not Codex.
- `observedAt` is collector receipt time, not the Skill injection time.
- This metric alone cannot reconstruct ordered or nested Skill chains.
- Production counter interpretation and correlation remain future work.

The experiment does not add production aggregation or routing analysis.

### Version-specific behavior

- `otel.metrics_exporter` can redirect the metric from Codex's default Statsig exporter to user-controlled OTLP/HTTP in version 0.146.0.
- `analytics.enabled=false` disables this custom metrics export as well. The experiment leaves metrics instrumentation enabled but replaces its exporter with the loopback endpoint.
- Public documentation catalogs `skill.injected`, but does not explicitly promise that every catalog metric is available through user-configured OTLP export. Treat the observed support as version-specific and potentially undocumented.

### Limitations and non-claims

The experiment covers one Codex CLI version, one operating system, explicit Skill invocation, and OTLP/HTTP JSON. It does not test implicit activation, OTLP/gRPC, other Codex surfaces, Skill compliance, task outcome, routing quality, tool behavior, or user intent.
