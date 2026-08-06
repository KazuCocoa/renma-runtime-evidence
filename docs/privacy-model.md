# Privacy model

Privacy is an input constraint, not a later processing step.

## Prohibited data

The collector must not persist or transmit user prompts, assistant responses, reasoning, session transcripts, source code or file contents, tool arguments or output, absolute repository paths, environment variables, credentials, tokens, user identity, or raw telemetry payloads containing fields outside the allowlist.

Codex session transcripts, JSONL conversation caches, local databases, and other user-history stores are not experiment inputs and must not be inspected.

## Allowlists

Each experiment has a separate finite allowlist. Across the current experiments, retained evidence may contain only:

- provider (`codex`);
- the finite experiment and scenario identifier, where applicable;
- observation type (`skill-injected`) or the exact provider metric name;
- exact synthetic Skill names declared by that experiment;
- exact verified injection status (`ok`) when an accepted set is non-empty;
- the locally measured Codex version;
- collector receipt timestamp;
- a locally generated pseudonymous experiment run ID;
- process exit status; and
- non-identifying operating-system, architecture, and Node.js version metadata.

The collectors bind to `127.0.0.1`, hold an OTLP request only long enough to parse it in memory, and emit normalized evidence only when the metric name, synthetic Skill identity, and exact `status=ok` match the experiment allowlist. They never write raw request bodies. Unknown names and statuses, attributes on non-target metrics, unexpected attributes on the target metric, and content-bearing fields are discarded before persistence.

Each synthetic Codex process runs with an ephemeral session, ignored user configuration, read-only sandboxing, no approvals, no OTel logs, and no OTel traces. Its prompt and response are never written by the experiment runner. Codex stdout and stderr are discarded. Codex metrics instrumentation must remain enabled for the OTLP metrics exporter to operate, but the runner replaces the default Statsig exporter with the loopback collector.

The activation-path experiment stops and drains the collector after each Codex child exits, waits for accepted requests to finish processing, and only then collapses accepted cumulative exports into a sorted, deduplicated process-level name set. Empty sets are retained honestly. Neither a repeated metric point nor its absence is converted into invocation counts, ordering, relationships, file-read claims, compliance, or outcomes.

## Initial library collector

The private, pre-release library accepts a caller-authorized Skill allowlist only after applying fixed entry, Unicode-scalar, UTF-8-byte, and control-character bounds. The allowlist itself is not copied into evidence. A label can appear in a snapshot only after an exact `codex.skill.injected` point with one exact string `skill` attribute, one exact string `status=ok` attribute, no OTLP `NO_RECORDED_VALUE` marker, and exactly one valid numeric representation whose recorded counter value is strictly positive is accepted during that collector lifetime.

Zero and negative counter values and valid no-recorded-value datapoints produce no presence, including for labels outside the allowlist. Numeric values and flags are discarded immediately after validation and are never retained, exposed, logged, hashed, encoded, or counted. An otherwise valid positive successful label outside the allowlist changes only `unrecognizedSkillObserved` to `true`; the label is not logged, hashed, encoded, counted, returned, or persisted. Library snapshots omit the experiment-only timestamps, run IDs, environment metadata, process status, and Codex version. The library neither launches Codex nor reads authentication, home, session, or transcript state.
