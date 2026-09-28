# Skill portfolio telemetry: observation inventory

Purpose: help maintainers of Renma-managed repositories decide which bundled
Skills merit investigation for improvement, archival, or moving repeated work
to a server implementation. The user accepts UTC **observation time** for the
dashboard; an exact injection timestamp is not required. Counts and useful
metadata are deliberately in scope. This extends the previous presence-only
experiment; it does not change its historical evidence or claim task quality.

## What can be measured, and whose fact is it?

| Item                                                         | Source and meaning                                                     | Verification / consumer use                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill label and successful injection-counter presence        | Codex metric                                                           | Existing real runs; plugin label mapping requires the plugin experiment below. It is not instruction compliance.                                                  |
| UTC first observation and last receipt                       | Collector clock at HTTP request receipt                                | Implemented in the new experiment. Timeline labels say “observed”, not “read at”.                                                                                 |
| Collector-relative elapsed time                              | Monotonic local clock                                                  | Helps order receipt during wall-clock corrections; not a cross-host clock.                                                                                        |
| Numeric counter samples                                      | Provider counter value, temporality and monotonic flag                 | New allowlisted experiment; retained as measurements, not task execution counts.                                                                                  |
| Aggregate count candidate                                    | Normalizer over one dedicated producer and verified temporal structure | Cumulative maximum or sum of disjoint delta intervals. Duplicate/overlapping/ambiguous intervals cannot be counted blindly. Gaps mean coverage is not guaranteed. |
| Last observed counter increase                               | Collector receipt of a supported cumulative increase or positive delta | Suitable for recency; repeated unchanged exports must not make a Skill look recently used.                                                                        |
| Metric interval timestamps                                   | Provider `startTimeUnixNano` / `timeUnixNano`, when valid              | Kept as metric metadata. Neither is relabeled as individual injection time.                                                                                       |
| Repository / Renma asset / plugin / version / digest         | Packaging manifest, verified deployed fixture bytes                    | Join via an explicit unique label mapping. These fields are not emitted Skill identity or injected revision.                                                      |
| Installed and enabled Skills                                 | Actual `skills/list` response and verified installed paths             | Exposure inventory, including known Skills with no observed samples. Availability is not usage.                                                                   |
| Collector health and rejected requests                       | Receiver                                                               | Distinguishes missing evidence from an observed counter. No sample is null, not automatically numeric zero.                                                       |
| Per-user adoption / unique installations                     | Not collected in this experiment                                       | A separately designed installation identifier and deployment coverage denominator would be needed.                                                                |
| Per-Skill latency, tokens, cost, success, errors of the task | Not established by the injection counter                               | Do not attribute global turn/tool costs to every co-present Skill. Server-side implementation candidates need separate evidence.                                  |
| Exact file read / injection time, ordering, causality        | Not established                                                        | Not needed for the accepted receipt-time dashboard; remain unsupported.                                                                                           |

The live delta samples also retained explicit known provider metadata: CLI
`app.version`, `model`, `model_slug`, `reasoning_effort`, `originator`,
`session_source` and `auth_mode`. These can support version/model breakdowns and
diagnostics when present. They do not make per-Skill token/cost attribution valid.
Unknown additional dimensions are marked as omitted rather than copied.

## How to use these measurements

- **Archival candidates:** compare observed use, recency and exposure over a
  declared covered period. A missing collector or a disabled Skill is not zero
  demand. Require a meaningful observation period; the fixture is not a business
  recommendation to archive any real Skill.
- **Improvement candidates:** frequent use and changes across deployed versions
  can prioritize investigation. Usage alone does not establish defects or quality.
- **Server implementation candidates:** frequent, repeatable use can identify
  candidates. Latency, cost, reliability and task semantics still need measurement
  before a migration decision.
- **Timeline:** use UTC receipt time, retain its source, and show batched arrivals
  together. Do not invent an order for Skills received in the same export.

## Plugin integration boundary

The experiment installs an actual synthetic plugin with the installed Codex CLI
inside a fresh HOME/CODEX_HOME. Three Skills are copied from two owned synthetic
source directories into one plugin. This tests multi-source packaging and
identity joins, not a real Renma synchronization command or arbitrary repositories.
The plugin declares a local stdio MCP server containing the receiver code; the
model has no telemetry tool to invoke and must not self-report usage.

The wrapper configures Codex's metrics exporter **before** launching app-server.
Installing the plugin alone is not shown to configure an already-running host's
exporter. The fixture uses a preselected loopback port, an explicit temporary
installed-script path and a private output directory. The added real lifecycle check found a fresh-thread receiver failing with
`address-in-use` while the first kept collecting. MCP discovery also reported an
error; HTTP success alone is not plugin health. See the saved lifecycle result in
the experiment. Portable install paths,
multiple simultaneous Codex processes, port ownership and a shared managed
receiver require integration design; do not represent this as a zero-setup
production plugin. Exporter fan-out and delivery to a production backend are
outside this experiment.

## Retention contract

Persist the explicit metadata above, including counts and UTC timestamps.
Discard raw prompts, responses, reasoning, transcripts, tool payloads, arbitrary
metric labels, resource/scope attributes and credentials. These exclusions do
not prevent the requested portfolio analysis. Credentials are accessed only by
Codex through an authorized temporary link. Usage metadata itself can be
sensitive in production: ownership, retention and access belong to the deploying
organization; no blanket anonymization is imposed by this experiment.

Official capability references (consulted 2026-09-27):
[plugin packaging](https://developers.openai.com/plugins/build/plugins),
[app-server skills and MCP status](https://learn.chatgpt.com/docs/app-server),
[Codex metrics](https://learn.chatgpt.com/docs/config-file/config-advanced).

See [the executable experiment](../experiments/codex-plugin-usage/README.md)
for the actual measured outcomes and their limits.

UTC formatting does not imply synchronized host clocks. Multi-host timelines need
clock synchronization/uncertainty handling in addition to these local timestamps.

## Follow-up findings (2026-09-28 UTC)

- A wrapper-owned shared receiver worked across two actual Codex processes and two synthetic plugins in both controlled initial attachment orders. A peer's exit did not stop collection. Plugin MCP server names must also avoid collisions: a duplicate-key run failed to attach correctly; distinct names succeeded. This is bounded cooperative-fixture evidence, not compatibility certification for arbitrary plugins.
- During a deliberately rejected HTTP export, an actual Skill increment was visible in reduced failed-export evidence but was not replayed into accepted samples within the tested recovery window. A real listener outage recovered new traffic. Show collection gaps separately from zero usage, and keep receiver/process epochs explicit.
- Actual Renma 0.39.2 recognizes the string key `metadata["renma.id"]`. The nested mapping in the earlier fixture was not canonical Renma metadata; those IDs were wrapper-assigned. Real Renma catalog and Git rename/update evidence now verify stable IDs and exact packaged bytes. Actual CLI installations of both revisions also emitted the expected changed labels, joined to the same stable IDs through frozen manifests.
- Local provider-interval-end to receipt differences were 0–1 ms, with approximately one-second aggregation windows. This does not measure injection latency. UTC regression and batch-order limits have separate authored tests.

See [coexistence and outage results](../experiments/codex-telemetry-coexistence/README.md), [Renma identity results](../experiments/renma-telemetry-identity/README.md), and [the remaining experiment ledger](telemetry-followup-experiments.md).

## Operational lifecycle evidence

The [live lifecycle experiment](../experiments/codex-plugin-lifecycle/README.md#live-skill-injection-and-metric-delivery-across-transitions) compares named Skill requests before and after plugin changes, with actual ChatGPT-authenticated Codex turns and allowlisted OTLP samples. Two runs agree: existing threads can emit an injection delta after disable; fresh disabled threads produce no target receipt in the tested windows; re-enable restores fresh-thread receipts; both old and fresh threads emit after update; removal produces no new target receipt in either tested thread category. Missing receipts remain unknown, not zero. A separate process-only run shows that MCP liveness can survive removal, so it cannot stand in for Skill usage.

Inventory state, process liveness, receiver health, OTLP transport activity and target-sample receipts are separate dashboard dimensions with UTC observation times. A hot update can mix deployments within one Codex process: do not assign a same-label sample to the latest version or blindly retain its initial version. Mark version provenance unresolved while candidate deployments differ; stable asset identity remains joinable only when all candidates agree. Exact injected revision and task execution are still unsupported.
