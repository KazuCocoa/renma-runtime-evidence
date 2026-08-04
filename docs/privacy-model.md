# Privacy model

Privacy is an input constraint, not a later processing step.

## Prohibited data

The collector must not persist or transmit user prompts, assistant responses, reasoning, session transcripts, source code or file contents, tool arguments or output, absolute repository paths, environment variables, credentials, tokens, user identity, or raw telemetry payloads containing fields outside the allowlist.

Codex session transcripts, JSONL conversation caches, local databases, and other user-history stores are not experiment inputs and must not be inspected.

## Allowlist

This experiment may retain only:

- provider (`codex`);
- observation type (`skill-injected`);
- the unique synthetic Skill name;
- injection status;
- the locally measured Codex version;
- collector receipt timestamp; and
- a locally generated pseudonymous experiment run ID.

The collector binds to `127.0.0.1`, holds an OTLP request only long enough to parse it in memory, and emits a normalized record only when both the metric name and synthetic Skill identity match the allowlist. It never writes raw request bodies. Attributes on non-target metrics and unexpected attributes on the target metric are ignored.

The synthetic Codex process runs with ephemeral sessions, ignored user configuration, read-only sandboxing, no approvals, no OTel logs, and no OTel traces. Its prompt and response are never written by the experiment runner. Codex metrics instrumentation must remain enabled for the OTLP metrics exporter to operate, but the runner replaces the default Statsig exporter with the loopback collector.
