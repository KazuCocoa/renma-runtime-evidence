# Coexisting telemetry plugins and Codex producers

This follow-up uses two independently installed synthetic plugins and two actual Codex app-server processes with the existing ChatGPT login linked into isolated homes. It is not a deployed general-purpose OpenTelemetry Collector or a demonstration of compatibility with every third-party plugin.

The wrapper owns one loopback HTTP listener. Each Codex process has a dedicated, wrapper-assigned ingress route; this is **not** provider-emitted user/session identity. Reduction occurs before retaining observations. Each plugin receives only its selected Skill's received-sample count and acknowledges that count. Raw metrics, arbitrary labels, model messages, and tool contents are not persisted. Received-sample count is a consumer delivery check, not a deduplicated usage count.

Both synthetic plugins are installed after the exporter endpoint is already present in the temporary user config. Codex's install command adds plugin configuration, so whole-file equality is not an appropriate preservation test. The report checks that the endpoint text remains and separately records actual HTTP receipt on that endpoint. No real user configuration is edited.

Run after building:

```sh
node .build/experiments/codex-telemetry-coexistence/src/run.js --use-chatgpt-login --allow-codex-analytics
node .build/experiments/codex-telemetry-coexistence/src/run.js --use-chatgpt-login --allow-codex-analytics --beta-first
```

The receiver gates the second consumer's initial registration until the requested first consumer registers. This deliberately tests both attachment orders; it does not characterize Codex's natural scheduler order. MCP status discovery can create additional observer processes, so registration counts are not thread or user counts. Observer shutdown only deregisters; it cannot stop the receiver. The receiver is not authenticated; these fixed routes and counts are appropriate only for owned synthetic fixtures.

## Observed results

- `20260928-duplicate-mcp-key.json`: both plugin manifests used the MCP key `observer`. Both normal connections were not established; no plugin registration/acknowledgement reached the receiver. The CLI turns and provider metrics still ran. Retained as a failed coexistence baseline. The result alone does not identify Codex's internal precedence rules.
- `20260928-alpha-first-same-thread.json`: distinct keys (`observer-alpha` and `observer-beta`) resolved the observed connection failure in this run. Both plugins connected in both Codex processes with expected server names and no tools errors. Each producer yielded alpha=1, beta=1; each consumer acknowledged its own count. The receiver survived the first process's exit.
- In that second run, re-requesting alpha in the surviving **same thread after beta** completed without another observed alpha increment, including a bounded 20-second wait. Do not equate explicit Skill requests or completed model turns with injection-counter increments. No claim is made about the internal cause.

## Boundaries

Existing listener port collision has a separate failing baseline in `codex-plugin-usage`. This architecture avoids plugin-owned binding by explicitly provisioning a receiver. Zero-setup discovery, authentication, arbitrary existing collector integration, durable queuing, and multi-machine clock synchronization are not established by these experiments. A production bootstrap must preserve an existing exporter, use an agreed fan-out/service interface, and report inability to attach rather than silently redirect telemetry.

Local tests use authored OTLP fixtures to establish source separation, redaction, per-consumer views, and replay/conflict behavior. They are not evidence of Codex exporter retry behavior; outage/recovery is a separate pending live experiment.

- `20260928-beta-first-new-thread.json`: reversed initial consumer order also connected both plugins in both Codex processes. First producer counts were alpha=1/beta=1; the second producer reached alpha=2/beta=1 after the first exited and the survivor used a new thread. Consumer acknowledgements matched those received-sample counts. All five model turns completed. The configured endpoint text remained after install/run and actual metrics reached both dedicated routes. This demonstrates continued collection after peer exit for this bounded configuration.

The four generated manifests used by the reversed-order run passed the plugin-creator manifest validator. Local full validation at this stage passed 190 tests, with one historical skip; subsequent saved-evidence assertions are tracked separately.
