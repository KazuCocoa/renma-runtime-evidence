# Plugin Skill usage telemetry

This experiment tests the portfolio-maintenance use case in the
[observation inventory](../../docs/skill-usage-telemetry.md): UTC observation
recency, measured usage quantity and source-repository attribution after
multiple source directories are bundled into one actual Codex plugin.

## Real results

Two independent final CLI 0.157.1 processes completed all five model turns with
ChatGPT file login. Each used a new home, installed plugin cache, MCP collector
and ephemeral model threads. The committed reports are
[run 1](results/20260927-cli-0.157.1-run-1.json) and
[run 2](results/20260927-cli-0.157.1-run-2.json).

| Skill                 | Declared source      | Explicit requests per run                         | Received provider delta sum per run      | UTC first observation (run 2) |
| --------------------- | -------------------- | ------------------------------------------------- | ---------------------------------------- | ----------------------------- |
| `renma-usage-alpha`   | fixture repository A | 3: twice in original thread, once in fresh thread | 3, from three disjoint value-1 intervals | `2026-09-27T23:49:22.888Z`    |
| `renma-usage-beta`    | fixture repository B | 1                                                 | 1, from one value-1 interval             | `2026-09-27T23:49:31.926Z`    |
| `renma-usage-dormant` | fixture repository A | 0                                                 | No sample; numeric total remains null    | None                          |

All three Skills were listed as enabled, at the expected installed cache paths,
with the expected owning plugin. A first turn requested no Skill; the four
subsequent turns requested alpha, alpha, beta, then alpha in a fresh thread.
The runner timestamps its own turn boundaries separately; it does not label a
counter with an inferred provider turn ID. Successful model completion is not a
task-quality evaluation.

The plugin's configured MCP subprocess actually started the HTTP receiver.
`OTEL_METRIC_EXPORT_INTERVAL=1000` was passed to Codex. The reports show reception
during the requested turns rather than only at process shutdown. This is an
observed configuration result, not a latency SLA or a guarantee that every metric
is exported every second. There were no rejected requests or unknown Skill
labels in either final run. Some other metric dimensions were deliberately
omitted, recorded only as `extraDimensions: true` / `other`.

A useful integration finding: the listing name is
`renma-usage-fixture:renma-usage-alpha`, while the observed metric label is
`renma-usage-fixture_renma-usage-alpha`. The reducer accepts explicitly constructed
fixture labels and preserves the provider spelling. It does not replace arbitrary
separators or infer identities for unknown labels. An earlier bounded label probe
found the known `plugin_skill` shape; it was followed by fresh model runs with the
correct mapping, not by relabeling saved unknown observations.

## Additional real lifecycle result

A [separate lifecycle run](results/20260927-cli-0.157.1-lifecycle.json)
again completed all five turns and received the same 3/1/no-sample result, but
exposed a production integration problem. The first thread reported the bundled
MCP as `connected`; the fresh thread reported it as `failed`. The second receiver
recorded the OS error category `address-in-use`. The first receiver remained alive
and continued collecting, which explains why the usage result still succeeded.
This is not proof of a healthy multi-thread plugin deployment.

The MCP status API also reported a tool-discovery error for the initial connection
and did not confirm the fixture's server-info name. Its raw error message was not
retained, so the cause of that separate discovery error is not established. This
receiver advertises no model-callable tools. Its successful HTTP collection must
not be substituted for successful tool discovery.

The next integration should use an explicitly managed shared receiver (or tested
single-instance/port coordination), with host exporter configuration and startup
health handled separately from each model thread. This experiment diagnoses the
boundary; it does not ship that service or silently work around the failure.

## Count and timestamp semantics

The real samples are **monotonic delta counters**, not cumulative counters.
Their non-overlapping intervals can be summed even when some other dimensions
are omitted: each retained interval contributes once. The result is the sum of
**received provider counter increments** for the known Skill in this dedicated
single-producer fixture. It is not a count of completed tasks, people or all
activity on uninstrumented hosts. Missing intervals are not filled with zeros.
The sparse delta intervals neither prove loss nor prove complete coverage.

The normalizer also has synthetic tests for cumulative counters (maximum in one
fixed series/epoch, never sum of exports). With delta samples it rejects partial
overlap, conflicting duplicates, unsafe totals and mixed temporalities. Exact
replays are deduplicated only under the fixture's fixed producer/resource/scope
assumption when retained dimensions match and no omitted dimensions exist;
otherwise a repeated interval remains ambiguous and the total is null.
Do not use this fixture normalizer as a shared multi-producer backend.

`observedAt` is UTC at request receipt, before parsing. Only valid reduced
observations are committed. `elapsedMs` uses a monotonic receiver clock and orders
receipts even when decoding finishes out of order. `firstObservedAt`,
`lastReceivedAt` and `lastIncreaseObservedAt` have separate meanings. Unchanged
cumulative exports or recognized replays do not refresh activity recency.
Provider interval times retain their original meaning and are never relabeled
as exact Skill read/injection timestamps.

## What the plugin proof does and does not include

- Actual CLI marketplace registration, plugin installation, verified bundled
  bytes, plugin ownership in listing, and execution of its bundled local MCP
  receiver are measured. The receiver exposes no model-callable telemetry tools.
- Two owned synthetic source directories carry explicit Renma-style IDs. Their
  repository/asset/plugin/version/digest manifest is wrapper knowledge. This is
  not a run of a Renma synchronization plugin against user repositories.
- The wrapper must configure `otel.metrics_exporter` before app-server starts.
  Plugin installation alone has not been shown to reconfigure that exporter.
- The fixture uses a known temporary installed-script path and selected port.
  Initial variable-based MCP path attempts did not start the receiver; no portable
  path-substitution claim is made. Shared collectors, concurrent hosts, restart
  coordination, automatic exporter setup, delivery guarantees and production
  backend storage still need implementation and separate tests.
- Default/system-managed integrations can remain available despite the fresh
  user home. They are not treated as fixture Skill evidence.
- Source-name collisions must remain ambiguous; the deployment-manifest tests
  already cover that rule. This run uses three unique labels and does not prove
  collision-free identity for every plugin/repository naming scheme.

## Run

```sh
npm run experiment:codex:plugin-usage -- --use-chatgpt-login --allow-codex-analytics
```

The command installs only into its temporary home and removes it in `finally`.
It does not install a persistent plugin into the user's Codex app. Normal CI uses
synthetic HTTP/MCP/packaging tests and saved-evidence consistency checks; model
runs are opt-in. No model API key is required. OpenAI analytics and normal model
traffic remain authorized separate paths; logs/traces and prompt logging are off.
The reducer persists counts, timing and declared metadata, never raw runtime
payloads, prompts, responses, reasoning, transcripts or tool contents.

This is an experimental module, excluded from the existing private package's
runtime exports. The existing presence-only collector is unchanged.
