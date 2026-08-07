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

Each synthetic Codex process runs with an ephemeral session, ignored user configuration, read-only sandboxing, no approvals, no OTel logs, and no OTel traces. Its prompt and response are never written by the experiment runner. Codex stdout and stderr are discarded. Codex metrics instrumentation must remain enabled for the OTLP metrics exporter to operate. For that child process only, the runner selects the loopback collector as the effective metrics endpoint; this may replace another effective metrics exporter. The experiment does not relay or fan out metrics.

The two-Skill `skill.injected` characterization is the one bounded exception to the read-only workspace sandbox: its three direct tasks use `workspace-write` only inside a freshly created temporary workspace so a requested synthetic fixture can create one fixed artifact. Every scenario also receives fresh empty `HOME` and `CODEX_HOME` directories and requires API-key authentication; the runner never reads or copies caller homes or saved Codex state. It installs exactly two repository-owned synthetic fixtures, enables no custom agents or multi-agent behavior, and creates a new collector and in-memory result for each scenario.

Artifact inspection is limited to equality checks at two fixed paths against two fixed tokens. Only match booleans survive; filenames, tokens, prompts, Codex output, arbitrary directory entries, and other file content do not enter the report. Each scenario root is deleted after reduction, including its workspace and both homes. The report otherwise contains only fixed scenario/request/process/classification enums, target/control evidence booleans, an unknown-label boolean, the installed Codex version, and existing bounded collector diagnostics. A missing authentication-isolation prerequisite yields no simulated or inferred matrix.

The activation-path experiment stops and drains the collector after each Codex child exits, waits for accepted requests to finish processing, and only then collapses accepted cumulative exports into a sorted, deduplicated process-level name set. Empty sets are retained honestly. Neither a repeated metric point nor its absence is converted into invocation counts, ordering, relationships, file-read claims, compliance, or outcomes.

## Initial library collector

The private, pre-release library accepts a caller-authorized Skill allowlist only after applying fixed entry, Unicode-scalar, UTF-8-byte, and control-character bounds. The allowlist itself is not copied into evidence. A label can appear in a snapshot only after an exact `codex.skill.injected` point with one exact string `skill` attribute, one exact string `status=ok` attribute, no OTLP `NO_RECORDED_VALUE` marker, and exactly one valid numeric representation whose recorded counter value is strictly positive is accepted during that collector lifetime. Valid representations are a canonical decimal-string `asInt`, a finite numeric `asDouble`, or the explicit Codex compatibility form: a finite safe-integer JSON number in `asInt`.

Zero and negative counter values and valid no-recorded-value datapoints produce no presence, including for labels outside the allowlist. Numeric magnitudes and flags are discarded immediately after validation and are never retained, exposed, logged, hashed, or encoded. An otherwise valid positive successful label outside the allowlist changes only `unrecognizedSkillObserved` to `true`; the label is not logged, hashed, encoded, returned, or persisted.

The collector exposes diagnostics as a distinct immutable snapshot that cannot be interpreted as the public Skill-presence result. It contains only unsigned 32-bit saturating counters and a saturation boolean: request/decode stages, fixed request-read/body-size/JSON-syntax/OTLP-validation failure categories, inspected OTLP container and datapoint counts, exact-target counts, status and numeric-sign categories, no-recorded-value, canonical integer/provider-compatible integer/double/missing shapes, conflicting or invalid numeric shapes, invalid flags, accepted allowlisted datapoints, and unknown-or-missing-label datapoints. Missing numeric fields are valid but evidence-ineligible. Conflicting fields, invalid types or syntax, out-of-range decimal integers, fractional or unsafe JSON-number integers, non-finite doubles, invalid flags, and malformed aggregation or datapoint structures fail the request atomically and increment OTLP-validation failure counters. Unknown labels, arbitrary metric names, arbitrary attributes, numeric magnitudes, raw values, and all identifiers are discarded rather than copied, transformed, or hashed. These transport counts can include repeated cumulative exports and make no occurrence, execution, ordering, causality, session, nesting, or agent-attribution claim.

Both library snapshots omit the experiment-only timestamps, run IDs, environment metadata, process status, and Codex version. The library neither launches Codex nor reads authentication, home, session, or transcript state.
