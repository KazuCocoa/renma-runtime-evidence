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
- A **requested startup disable override** still yielded listed Skills with `enabled: true`. This report does not prove that the effective plugin configuration was disabled or that disabled Skills would run. The follow-up below resolves the effective-configuration issue and measures MCP process behavior.

## Checks identified after the initial baseline (historical)

1. Verify effective disable configuration, then persistent disable/re-enable and runtime behavior in existing versus fresh threads.
2. Exercise actual MCP consumers across update/removal and confirm shared receiver/other plugin behavior.
3. Define observation coverage using configuration, installed inventory, receiver availability and actual export receipt. Distinguish point-in-time inventory, available-but-unobserved, disabled/uninstalled and unknown collection windows; never call a healthy HTTP receiver proof of full export coverage.
4. Add backward/forward version tests after selecting versions; add real backend delivery tests after selecting the backend.

Official references inspected for this phase: [plugin packaging and enabled state](https://developers.openai.com/plugins/build/plugins), [CLI plugin commands](https://learn.chatgpt.com/docs/developer-commands). Documented behavior guides the experiment; saved observations remain authoritative for the tested version.

## Effective configuration and running consumers (2026-09-28 UTC)

Two additional runs use CLI 0.157.1 and the same isolated setup:

```sh
node .build/experiments/codex-plugin-lifecycle/src/run.js --effective-config /absolute/path/to/plugin-creator/scripts /absolute/path/to/python3
node .build/experiments/codex-plugin-lifecycle/src/run.js --runtime-lifecycle /absolute/path/to/plugin-creator/scripts /absolute/path/to/python3
```

The config run resolves the baseline's failed disable control. For this CLI's `-c` parser, `plugins."renma-usage-fixture@personal".enabled=false` creates a key containing literal quote characters. The actual plugin remains enabled. Passing `plugins.renma-usage-fixture@personal.enabled=false` as one argument disables the intended plugin. This is specific to the CLI override parser: `config/value/write` with the quoted dotted key correctly writes the persistent setting. Normal TOML table syntax is not changed by this finding.

The reducers retain only the two explicitly named keys' boolean values and the known plugin's installed/enabled booleans. Persistent disable and re-enable return `ok`; both the running app-server and a new app-server report the corresponding effective state. Disabled Skills disappear from the forced listing and return on re-enable. Removal leaves a marketplace entry with `installed:false`, rather than deleting the marketplace source.

The runtime run installs two synthetic plugins with distinct MCP server names, starts 14 ephemeral threads, and observes 22 actual MCP process instances. No model turns, login, or analytics are used. Each fixture process registers with a wrapper-owned loopback probe, receives a sequential fixture instance number, and sends heartbeats every 250 ms. Snapshots occur before starting each new thread and 1.5 seconds afterward. A `recentHeartbeat` means a heartbeat within 1.5 seconds with no received stop; missing heartbeats alone do not prove termination. These are **wrapper control observations, not Codex Skill usage metrics**. They retain no OS PID, thread ID, runtime content, or arbitrary labels.

| Transition          | Existing process observation                                      | Fresh ephemeral thread                                       |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| Persistent disable  | Primary process continues sending heartbeats                      | Companion only; primary does not start in the bounded window |
| Re-enable           | Previously running companion continues                            | Primary and companion start                                  |
| Update/reinstall    | Initial revision continues after its cache directory is deleted   | Updated revision starts alongside initial revision           |
| Remove              | Updated primary continues after installed cache removal           | Companion only; primary does not start in the bounded window |
| App-server shutdown | All 22 registered instances eventually report stop across the run | Final snapshot has no recent heartbeat                       |

The independent usage receiver stays healthy and its endpoint text is preserved at every checkpoint. The companion continues across each in-process transition and starts in every fresh thread, including after the primary is removed. Neither observation proves actual telemetry delivery: analytics/exporting remains disabled for this experiment. Revision labels describe the known fixture observer's startup arguments, not the revision of Skill text injected into a model. The probe is experimental instrumentation, not a production collector service.

Evidence: [effective config](results/20260928-effective-config.json), [runtime lifecycle](results/20260928-runtime-lifecycle.json). The original [metadata baseline](results/20260928-metadata.json) is preserved as the failed-control history.

### Dashboard coverage implications

Track separate dimensions, each with its own UTC observation time:

| Dimension             | Evidence                                                                       | Limit                                                                  |
| --------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Desired configuration | Known plugin enabled setting                                                   | A requested write alone is not effective-state evidence                |
| Current inventory     | Effective config, installed plugin, listed Skills                              | Point-in-time state; cannot close an old process's exposure window     |
| Running consumer      | Wrapper instance/revision and heartbeat/stop                                   | Heartbeat confirms recent liveness, not receipt of provider metrics    |
| Receiver availability | Health checkpoint or explicit failure                                          | Healthy HTTP service does not prove exporter configuration or delivery |
| Actual usage receipt  | Accepted allowlisted provider samples, producer/receiver epoch and receipt UTC | Received samples only; no samples means unknown, not zero              |

A disabled/uninstalled snapshot should mean **unavailable to fresh threads at that checkpoint** in this tested setup. Retain a separate existing-process state until a stop is observed; gaps without stop are unknown. Updating inventory must not retroactively relabel an old process's samples with the new deployment manifest. Store sample receipts on their original producer/deployment and receiver epochs. A successful export establishes a receipt event, not lossless coverage for the interval between exports. Archive decisions must not use missing samples as zero usage or a health check as a complete collection window.

### Remaining operational boundaries

Effective disable and MCP process lifecycle are now measured. Actual model Skill behavior in an already-open thread after disable/removal, and real metric delivery across those transitions, remain unmeasured. The earlier coexistence/outage experiments establish other bounded delivery observations, not these lifecycle guarantees. Cross-version/platform tests and real backend delivery still require selected targets. No dashboard or production coverage computation is implemented here.
