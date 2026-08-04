# Codex observability model

These concepts are distinct:

| Layer                   | Meaning                                                            | Initial target? |
| ----------------------- | ------------------------------------------------------------------ | --------------- |
| Discovery or enablement | Codex found a Skill and made its metadata available for selection. | No              |
| Injection               | Codex added the selected Skill instructions to model context.      | Yes             |
| Execution or compliance | The model followed some or all injected instructions.              | No              |
| Task outcome            | The task succeeded or produced a good result.                      | No              |

Codex documentation describes progressive Skill disclosure and explicit invocation with `$skill-name`. It also documents `skill.injected` in the internal metrics catalog, with `status` and `skill` fields. The catalog notes that displayed metric names omit a `codex.` prefix.

Codex has two telemetry paths relevant to this question:

1. Anonymous usage and health metrics are sent through Codex's built-in analytics path by default. The documentation says this metrics collection is independent of OTel log and trace export.
2. The `[otel]` configuration includes a separate `metrics_exporter`, whose documented choices include `otlp-http` and `otlp-grpc` in addition to the default `statsig` path.

The existence of the catalog entry alone does not establish exportability. The experiment therefore overrides `otel.metrics_exporter` to a local OTLP/HTTP JSON endpoint while explicitly disabling OTel logs and traces. On `codex-cli 0.146.0`, setting `analytics.enabled=false` also disables the user-configured metrics exporter; the instrumentation must remain enabled while its exporter is redirected from the default Statsig path to loopback-only OTLP.

Official references:

- [Codex advanced configuration](https://developers.openai.com/codex/config-file/config-advanced)
- [Build skills](https://developers.openai.com/codex/build-skills)
- [Hooks](https://developers.openai.com/codex/hooks)
- [App server](https://developers.openai.com/codex/app-server)

## Current result

`codex-cli 0.146.0` exported the counter as the exact OTLP instrument name `codex.skill.injected` in three of three runs on 2026-08-04. Each allowlisted datapoint contained:

- `skill=renma-runtime-evidence-canary-20260804`
- `status=ok`

This verifies that the metric catalog is not limited to the built-in anonymous Statsig path in this version. Redirecting `otel.metrics_exporter` to a user-controlled OTLP/HTTP collector exported the signal locally.

The exported Skill string exactly matched the synthetic `SKILL.md` frontmatter name. Because that name is unique in this experiment, it is sufficient to correlate this observation with a future Renma asset identity. Codex allows multiple discovered Skills to share a name, however, so the observed field is not a globally unique asset identity by itself. A future integration must preserve the provider-specific string and bind it explicitly to a declared Renma identity; this experiment does not add that mapping.

This behavior is version-specific and the exportability of `skill.injected` is not stated explicitly in the public metric catalog. The experiment makes no claim about other Codex versions or surfaces.

## Metric-counter boundary

`codex.skill.injected` is an OTLP counter, not a Skill lifecycle event. This experiment establishes the counter's presence in an isolated Codex process with one explicit Skill invocation. It does not establish lifecycle-event semantics:

- Repeated cumulative exports must not be interpreted as repeated Skill injection events.
- `experimentRunId` is a locally generated correlation value assigned by the experiment wrapper, not an identifier emitted by Codex.
- `observedAt` is the collector receipt time, not the Skill injection time.
- The counter alone cannot reconstruct ordered or nested Skill chains.
- Production counter interpretation and correlation remain future work.

This PR intentionally does not add production aggregation, per-session or per-turn correlation, chain reconstruction, or routing analysis.
