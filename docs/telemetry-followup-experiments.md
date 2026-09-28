# Telemetry follow-up experiment ledger

Requested scope: finish the usage-telemetry follow-up experiments, including coexistence with other OpenTelemetry plugins. A passing fixture test is not proof of Codex runtime behavior. No production readiness claim follows from a successful bounded experiment.

| Requirement                          | Evidence required                                                                                                           | Status                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Concurrent threads and CLI processes | Actual Codex processes, independent producer boundaries, no bind collision, shutdown/restart observations                   | Verified within fixture scope                 |
| Plugin installation and bootstrap    | Fresh isolated install, explicit consent/configuration, existing exporter preserved                                         | Verified: explicit setup, existing endpoint   |
| Other collector plugins              | Two installed synthetic collectors, both start orders, existing listener, ownership and shutdown, reduced data distribution | Verified: cooperative synthetic plugins       |
| Loss, retry and restart              | Actual exporter outage/recovery plus separately labeled replay fixtures; no silent zero or double count                     | Verified: bounded failure/recovery windows    |
| Rename, move and version updates     | Stable asset ID mapping across changed labels/plugin/version; collision detection                                           | Live changed-bundle check pending             |
| Actual Renma packaging path          | Actual Renma scans owned Git repositories; wrapper bundles their assets; identity manifest and updates verified             | Catalog/bytes verified; live install pending  |
| Time-based dashboard limits          | Receipt UTC and monotonic time, batching/delay measurements; clock-skew fixture labeled synthetic                           | Verified locally; synthetic clock-limit tests |
| Delivery                             | Documentation, relevant tests, self-review, PR and CI, merge and return to main                                             | Pending                                       |

## Architecture being tested

The experiment owner starts one receiver before Codex. Plugin MCP processes attach without binding or owning its lifetime. This first step tests thread lifecycle; it is not a zero-setup installed service. Multiple independent Codex producers must not be merged into the existing single-producer summary. A future coexistence runner must preserve producer identity at the receiver boundary before reducing payloads.

Existing user configuration and plugins must remain untouched: all installations, exporter configuration, and deliberate failures use owned temporary homes and repositories. Only explicit allowlisted reduced observations may persist. Exact injection time, task success, and prompt/tool content remain outside scope.

## Scope clarification from source inspection

Renma 0.39.2 explicitly excludes bundling assets in its README product boundary. The earlier suggestion that Renma itself would bundle was inaccurate. This requirement therefore exercises real Renma repository discovery/identity output and the separate packaging wrapper together; it does not invent a Renma sync/bundle command.

## Evidence collected so far

- Actual CLI 0.157.1 shared receiver run: `experiments/codex-plugin-usage/results/20260928-cli-0.157.1-shared.json`. Both thread MCP connections succeeded without tools errors; four Skill increments received; receiver survived Codex shutdown. This completes the sequential multi-thread subcase only.
- Local process test: two shared MCP clients attach concurrently to the same existing listener and their exit leaves HTTP ingestion working. This is a fixture test, not simultaneous Codex-process evidence.
- Next: two installed collector plugins and multiple actual CLI producers; preserve source boundaries before summarizing, then deliberate outage/recovery and startup-order variations.

### Two-plugin / multi-CLI results

`experiments/codex-telemetry-coexistence` now contains actual two-CLI/two-plugin reports for both controlled consumer attachment orders. Unique MCP server keys connected successfully; dedicated ingress routes retained producer boundaries. After one CLI exited, the survivor's new thread produced an additional received increment, acknowledged by its consumer. Existing endpoint text and actual routing were preserved across plugin installation. Four generated manifests passed the plugin validator.

A duplicate MCP server-key baseline failed plugin attachment despite successful metric collection. This adds a naming collision to the port/configuration/lifetime coexistence concerns. Another run completed same-thread Skill re-use without a new observed increment; request counts must not be substituted for injection increments.

These complete the concurrent-CLI, cooperative consumer-order, data-distribution, and peer-exit subcases. Actual process restart, receiver outage/recovery, identity evolution, Renma integration, time analysis, and delivery remain open. Unknown third-party collectors are not certified by a cooperative synthetic fixture.

### Outage, restart, identity and time evidence

- `20260928-outage-recovery.json`: actual HTTP 503 window, TCP listener close/rebind, accepted vs failed export separation, fresh traffic after recovery, and a replacement CLI in a fresh home. One rejected beta increment was not replayed within the tested window. Receiver epochs are separate; no same-conversation resume or durable replay claim.
- `20260928-receipt-time-analysis.json`: reproducible clock comparisons from actual reports (0–1 ms interval-end/receipt difference), plus explicit synthetic UTC-regression and batch-tie tests. This does not measure injection latency or cross-host synchronization.
- `experiments/renma-telemetry-identity/results/20260928-renma-0.39.2.json`: actual Renma catalog across two Git repositories and two revisions, canonical ID extraction, rename/move/version/hash mapping and byte-identical wrapper packaging. Nested `metadata.renma.id` YAML objects did not resolve as explicit IDs; the canonical key is `metadata["renma.id"]`.

Remaining before completion: install those changed bundles and observe live Codex labels, verify the resulting deployment-bound joins, complete final self-review/checks/PR/CI/merge. Baseline and failed runs remain retained.
