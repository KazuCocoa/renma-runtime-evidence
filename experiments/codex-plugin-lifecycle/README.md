# Operational lifecycle and coverage: initial characterization

This is the next phase after the completed program in [the summary](../../docs/experiment-summary.md). The first run is deliberately metadata-only: actual CLI plugin install/update/remove and app-server listings, no model turns, no login, and analytics disabled. It does not establish runtime consumer termination or telemetry delivery during transitions.

Reproduce after `npm run build`:

```sh
node .build/experiments/codex-plugin-lifecycle/src/run.js --metadata-only /absolute/path/to/plugin-creator/scripts /absolute/path/to/python3
```

Use the real Python interpreter, not a home-dependent version-manager shim: HOME is an owned temporary directory. An initial attempt with the caller's Python shim failed before update and produced no lifecycle conclusion. The successful run uses plugin-creator's marketplace-name validation, default UTC cachebuster and manifest validation, then reinstalls with the actual CLI. It never edits the user's plugin configuration or marketplace.

## Actual CLI 0.157.1 baseline

- The source description changed, a cachebuster revision was installed, and both existing-server and fresh-server listings showed the updated description. The original cache directory disappeared.
- CLI removal removed the updated installed cache and the listed Skills, including from the existing app-server's default query. The authored marketplace source remained.
- The pre-existing exporter endpoint text remained through all phases. The independently owned receiver stayed healthy. With analytics disabled this is not proof of continued provider delivery.
- A **requested startup disable override** still yielded listed Skills with `enabled: true`. This report does not prove that the effective plugin configuration was disabled or that disabled Skills would run. Effective-configuration/runtime checks must resolve that before treating the inventory as exposure evidence.

## Next checks, not yet completed

1. Verify effective disable configuration, then persistent disable/re-enable and runtime behavior in existing versus fresh threads.
2. Exercise actual MCP consumers across update/removal and confirm shared receiver/other plugin behavior.
3. Define observation coverage using configuration, installed inventory, receiver availability and actual export receipt. Distinguish point-in-time inventory, available-but-unobserved, disabled/uninstalled and unknown collection windows; never call a healthy HTTP receiver proof of full export coverage.
4. Add backward/forward version tests after selecting versions; add real backend delivery tests after selecting the backend.

Official references inspected for this phase: [plugin packaging and enabled state](https://developers.openai.com/plugins/build/plugins), [CLI plugin commands](https://learn.chatgpt.com/docs/developer-commands). Documented behavior guides the experiment; saved observations remain authoritative for the tested version.
