# Can a bundled plugin uniquely observe Skill injection?

## Decision

**A plugin can receive native injection counters and resolve the observed Skill when the effective provider label is unique in its deployment. It cannot currently obtain a demonstrated universal, path-bearing event for every individual injection.** With duplicate names inside one plugin, the native counter remains ambiguous. A bundled tool Hook adds exact path evidence for tool-mediated reads, including model selection from ordinary requests, but does not cover direct server-side injection.

This distinction matters for the product requirement:

- “Which governed Skill had observed injection activity, how much received counter activity, and when was it observed?” is conditionally supportable with native OTel plus a unique frozen deployment mapping.
- “Notify the plugin for each injection, identify its exact Skill/path, and assign a unique injection event ID even with duplicate names” is **not established with the current standard plugin interfaces**.

Renma PR #311 remains unchanged. No `renma.id` injection, router, model-callable reporting tool, or telemetry instruction is added to the Skills.

## New experiment

Actual Codex CLI 0.159.2 on macOS arm64; ChatGPT file login; one installed plugin containing six Skills; one persistent thread for each of two isolated configurations:

1. **Duplicate names:** payment Skill A and mobile Skill B both named `code-review`.
2. **Unique names:** the same assets named `payment-review` and `mobile-review`.

The seven turns per thread are: ordinary payment request; ordinary mobile request; reuse previously read payment guidance; explicitly reread both relevant Skill files; direct structured injection of A; direct injection of B; direct injection of A and B together. Ordinary requests do not contain Skill paths or asset IDs. Rereading is a deliberate control. Explicit-input controls are not attributed to autonomous model selection. Skill fixture bodies allow further file reads in this matrix so earlier instructions do not suppress later selections.

Standard `codex.skill.injected` OTLP metrics and trusted plugin-bundled Hooks are observed concurrently. The same tested allowlist reducer retains counter values, temporality, monotonicity and interval timestamps, while discarding unknown dimension values. Exports are requested at a 1-second interval and each turn has a 2.2-second receipt wait; those boundaries are wrapper checkpoints, **not native per-turn metric IDs**. Each configuration has its own isolated exporter/receiver. The native metric receiver in this matrix is started by the experiment harness; plugin-started collection was demonstrated separately in the [earlier plugin usage experiment](../codex-plugin-usage/README.md).

[Live evidence](results/live.json) and [derived summary](results/summary.json) separate model requests, actual Hook observations and native counters. Counter totals are calculated only with the existing conservative normalizer: disjoint valid delta intervals may be summed; ambiguous replays/overlaps remain unresolved. No total proves complete delivery or complete Skill use.

## Measured results

All fourteen turns completed. In each persistent thread, Hooks observed A's first read, B's first read, and both rereads. They observed no new Skill read for the reuse turn or the three direct-injection turns. The unique-name reread happened in B→A order; the duplicate-name reread happened in A→B order. These are observed tool-return sequences, not reconstructed injection ordering.

| Deployment      | Native received counter total                                                                                       | Path-bearing Hook observations     |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Duplicate names | `identity-shared_code-review`: **8**, candidates A and B; 6 received delta samples                                  | A returned twice; B returned twice |
| Unique names    | `identity-shared_payment-review`: **4**; `identity-shared_mobile-review`: **4**; 4 received delta samples per label | A returned twice; B returned twice |

The duplicate-name counter included value-2 samples: one received metric point need not represent one injection. The reuse turn produced no new target counter sample within its checkpoint window in either configuration. The totals use valid disjoint delta intervals; gaps exist between retained intervals and do not establish either complete delivery or definite loss. Counter totals are received increments, not successful task counts or per-turn usage counts.

This establishes multiple and repeated observations within the same session, and unique asset resolution for the unique-label configuration. It does not establish a native injection event ID, exact event timestamp, or a join from every increment to a specific Hook record. The [protocol candidate audit](results/protocol-audit.json) records exact inspected notification/Hook names from generated CLI types.

## Plugin delivery options

| Option                                                | What it can identify                                                                                                      | What it cannot establish                                                                                                             | Plugin setup                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native OTel `codex.skill.injected` + static manifest  | Exact asset **if** the exported label has exactly one deployment candidate; received counter quantities; UTC receipt time | Duplicate-name identity inside one plugin; exact per-injection timestamp/ID; causal influence; lossless coverage                     | Bundle a receiver/forwarder and immutable manifest, or use a configured shared OTel collector. Host exporter must be configured before the producer starts. |
| Bundled `PostToolUse` Hook                            | Known Skill-relative path referenced by a tool; return of expected known Skill bytes; distinguish same-name files         | Injection that bypasses tool execution; all shell syntaxes, partial reads and unknown read tools; continued use without another read | Bundle Hook and reducer; user must trust the exact Hook definition.                                                                                         |
| Combined OTel and Hook records                        | Broad name-based activity plus a separate path-specific read timeline                                                     | A reliable one-to-one join from each counter increment to a read; missing injection paths cannot be filled by timing proximity       | Preserve evidence types and their coverage separately. Never add Hook counts to native injection counts.                                                    |
| `skills/list`, plugin inventory, Git/manifest mapping | Static/discovery identity, source/revision candidates                                                                     | Evidence that the discovered file was injected                                                                                       | Useful local join table, not a usage signal.                                                                                                                |
| App-server explicit Skill input / client wrapper      | Requested name/path                                                                                                       | Independent proof that this file was injected; automatic observation by arbitrary installed plugins                                  | Requires owning/integrating the host client, not merely shipping a plugin.                                                                                  |
| Skill self-report / custom runtime callback           | Could define a new signal in another design                                                                               | Current natural runtime injection evidence                                                                                           | Not used: self-report depends on model compliance; a true callback would require runtime support or a separate design decision.                             |

Native log/trace candidate-field inspection in the [earlier duplicate-name probe](../codex-duplicate-skill-identity/README.md) established no better stable Skill identity among its explicit candidate fields. This is bounded evidence, not an exhaustive claim about undocumented internals. The tested app-server's generated protocol lists `skills/changed` (inventory invalidation) and `hook/started` / `hook/completed`, but no documented dedicated Skill-injection notification. `notify` is documented as turn-complete notification, not injection notification. These do not repair the missing path-bearing injection event.

## Recommended product contract

Keep two explicitly named observation types:

- **Injection counter observation:** provider label, validated delta/cumulative sample semantics, receiver UTC, deployment manifest identity, candidate asset IDs. Resolve only when exactly one candidate exists. Retain ambiguous observations as ambiguous.
- **Skill read observation:** plugin-relative path, static name/asset mapping, hook UTC, optional verified-known-content-return predicate. A read is not automatically a new injection, successful task execution, or a distinct use of the Skill.

For native OTel attribution, validate uniqueness of the **effective emitted label within each frozen deployment**, including plugin namespace transformations. The uniqueness check must cover every active Skill that can emit that label, including conflicting plugin names from another source; uniqueness only inside the monitored allowlist is insufficient. This need not reserve names across every repository, but one bundled plugin with duplicate effective labels cannot be disambiguated by the native counter. A path table cannot restore information absent from that counter.

For a product that must keep duplicate names and identify all direct injections, mark that capability **unsupported** today and seek a runtime-provided injection event carrying a stable locator/asset identity (plus event identity and time if required). Do not present a Hook-only implementation as satisfying that requirement.

Deployment identity is supplied by the wrapper/static manifest; it does not prove the exact injected file revision. Hot updates must preserve revision ambiguity or start a new producer with a verified frozen mapping.

Installation alone does not configure the user's OTel exporter or automatically trust Hooks. Preserve an existing exporter; use a compatible shared receiver/forwarder if collecting for multiple plugins. A plugin cannot safely assume ownership of the default OTel port. Previous [coexistence and operational experiments](../../docs/experiment-summary.md) cover that separately. No production backend was chosen or installed here.

## Privacy and scope

Only allowlisted fixture metadata and reduced runtime predicates are persisted. Arbitrary prompts, answers, reasoning, tool inputs/outputs, session IDs and absolute paths are discarded. `name` in Hook records comes from the static fixture mapping; the referenced path comes from transient real tool input. Exact known fixture contents are compared in memory and saved only as match predicates. Raw OTel logs are not enabled for this matrix.

One process/thread per configuration makes this a controlled same-session experiment, not proof of a globally unique session key in native metrics. No additional agent, OS, Desktop runtime, host restart, compaction, resume or large-catalog behavior is claimed. Reuse without new observation is not zero use. Missing data is unknown, not a fabricated event.

## Reproduction

```sh
npm run build
node .build/experiments/codex-plugin-skill-read/src/run.js --session-matrix --live --output /tmp/session-attribution.json
node .build/experiments/codex-plugin-session-attribution/src/summarize.js /tmp/session-attribution.json /tmp/session-attribution-summary.json
npm test
```

The matrix reserves at most fourteen attempts per invocation. Hook trust is written only in temporary isolated homes after checking the authored commands, hashes and installed Hook bytes. Runtime state is cleaned up afterward. The ordinary `--live` read experiment remains a separate eight-turn mode.

Official references: [native metric catalog and configuration](https://learn.chatgpt.com/docs/config-file/config-advanced), [plugin packaging](https://developers.openai.com/plugins/build/plugins), [Hooks](https://learn.chatgpt.com/docs/hooks), and [app-server protocol](https://learn.chatgpt.com/docs/app-server).
