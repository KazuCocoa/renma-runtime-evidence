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

A disabled/uninstalled snapshot records **fresh-thread inventory at that checkpoint** in this tested setup. Retain a separate existing-process state until a stop is observed; gaps without stop are unknown. Updating inventory must not retroactively relabel an old process's samples with the new deployment manifest. Store sample receipts on their original producer and receiver epochs; after an in-place update, retain deployment candidates rather than forcing an ambiguous label to one revision. A successful export establishes a receipt event, not lossless coverage for the interval between exports. Archive decisions must not use missing samples as zero usage or a health check as a complete collection window.

### Boundaries after the process-only run (historical)

At this stage effective disable and MCP process lifecycle were measured; model turns and metric delivery through transitions were still unmeasured. The live follow-up below now measures named-request injection-counter receipts. The earlier coexistence/outage experiments establish other bounded delivery observations, not these lifecycle guarantees. Cross-version/platform tests and real backend delivery still require selected targets. No dashboard or production coverage computation is implemented here.

## Live Skill injection and metric delivery across transitions

The next two runs use the actual CLI 0.157.1 with the existing ChatGPT file login and explicit analytics consent. They share one wrapper-owned receiver and one app-server for the whole run, preserving the configured exporter across disable/re-enable, update and removal. The plugin's shared MCP receiver clients do not own the listening port.

```sh
node .build/experiments/codex-plugin-lifecycle/src/live.js /absolute/path/to/plugin-creator/scripts /absolute/path/to/python3 --use-chatgpt-login --allow-codex-analytics
node .build/experiments/codex-plugin-lifecycle/src/live.js /absolute/path/to/plugin-creator/scripts /absolute/path/to/python3 --use-chatgpt-login --allow-codex-analytics --prime-existing-threads
```

Every measured turn uses a textual `$plugin:skill` request, with no explicit Skill path. Each existing thread is created before its transition and has never requested a Skill. The second run additionally completes a neutral, no-Skill turn before each transition, so its existing threads have conversation history. Those neutral controls produce no target samples. This avoids confusing a repeated injection's deduplication with disable behavior; it does not test continued use of already-injected instructions.

Reports: [thread-start control](results/20260928-live-thread-start.json), [existing conversation control](results/20260928-live-primed.json). Each uses nine measured turns; the second adds three neutral turns. No model content, tool payloads, thread IDs or credentials are retained. Turn completion means the API turn completed, not proof of instruction compliance.

| Request window                         | Thread started before transition | Fresh thread after transition                    |
| -------------------------------------- | -------------------------------- | ------------------------------------------------ |
| Initial alpha / beta controls          | —                                | One accepted delta `+1` for each requested Skill |
| Plugin disabled                        | Beta delta `+1`                  | No target sample received                        |
| Plugin re-enabled                      | —                                | Beta delta `+1`                                  |
| Plugin updated; original cache removed | Alpha delta `+1`                 | Alpha delta `+1`                                 |
| Plugin removed; updated cache removed  | No target sample received        | No target sample received                        |

The two runs agree on this matrix. Each records six accepted target samples (alpha total 3, beta total 3; dormant remains null), with no rejected requests or unknown Skill labels. Effective config and fresh inventory confirm disabled/uninstalled state at their checkpoints. The second run also retains request counters: OTLP HTTP requests continue during every measured turn window, including those with no target samples. Those request counts establish transport activity, not zero Skill usage or a lossless exporter.

The observation window includes each turn and four seconds after completion; a final ten-second drain plus shutdown adds no target samples. These are **receipt windows**, not a per-turn causal join: a delayed or batched export could cross their boundaries. Export cadence is configured to one second. The collector remains healthy and the exporter endpoint text remains unchanged.

### What this changes for the dashboard

- Disabling a plugin does not immediately exclude future injection-counter observations from an existing thread in this tested version. A disabled inventory snapshot must not discard those received samples or close every exposure window.
- Process liveness and Skill injection diverge: the earlier process experiment observed an MCP instance surviving removal, while these live runs received no new target sample after removal. Neither missing samples nor liveness alone measures actual Skill execution.
- In-place update creates a **mixed deployment period within a single producer process**. Old and new threads can both emit the same Skill label. A manifest fixed at process start is insufficient for exact version attribution after a hot update, and replacing it would mislabel old-thread samples. Preserve candidate deployment metadata and mark the version join unresolved until a verified new producer boundary or stronger evidence resolves it. A stable asset ID can still be joined only when the candidate mappings agree on that ID; the injected revision remains unsupported.
- No-receipt windows remain unknown rather than numeric zero, even with healthy transport and matching controls. These bounded observations do not prove permanent suppression, delivery completeness or instruction compliance.

This completes the local lifecycle delivery matrix for named Skill requests in the tested version. Remaining limits include already-injected Skill reuse, long-running or interrupted turns during a configuration change, explicit stale-path requests, cross-version/platform behavior and production backend delivery. These are not inferred from the receipt counter.
