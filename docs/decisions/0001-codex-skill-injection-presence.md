# Decision: expose Codex Skill injection presence first

Status: accepted for the initial private, pre-release library implementation.

## Context

The completed Codex experiments established a narrow provider boundary that can be implemented without collecting conversation content: a loopback OTLP/HTTP collector can accept the exact `codex.skill.injected` counter and retain an allowlisted Skill label only when the same point has exact `status=ok` and a valid, recorded, strictly positive counter value.

The experiments also showed why stronger language would be misleading. The counter is cumulative telemetry, not a lifecycle event. Its presence does not show that Codex read a particular file, followed instructions, completed a task, or associated a Skill with a particular agent or model thread. Branching and subagent experiments did not produce a sound basis for reconstructing order, counts, topology, or attribution.

## Decision

The first public API is explicitly Codex-specific:

```ts
createCodexSkillEvidenceCollector({ allowedSkills });
```

It returns a loopback endpoint and an idempotent `closeAndSnapshot()` operation. The snapshot fixes `provider: "codex"`, `signal: "skill-injected"`, and `observationScope: "collector-lifetime"`. It contains only sorted, deduplicated caller-allowlisted Skill labels observed in valid, recorded, strictly positive successful points plus a boolean indicating that at least one otherwise valid positive successful point used a label outside the allowlist.

The caller owns the Codex process and its metrics configuration. The library neither launches nor configures Codex and never writes a snapshot automatically.

## Why the API is provider-specific

Only Codex has evidence in this repository. A generic event or provider-neutral observation model would guess that other runtimes expose equivalent instruments and semantics. Keeping the instrument name and interpretation inside a Codex-specific collector preserves provider provenance and leaves room for a different future provider contract.

Shared abstractions may be considered after another provider has a tested privacy and lifecycle boundary. This decision does not pre-commit that provider to Codex terminology.

## Why the term is injection presence

An accepted point is evidence only that the provider emitted `codex.skill.injected` with an allowlisted `skill`, exact `status=ok`, no OTLP `NO_RECORDED_VALUE` marker, and exactly one valid numeric counter representation whose value is strictly positive. Canonical decimal-string `asInt` and finite numeric `asDouble` representations are valid. The tested Codex exporter uses a JSON number for `asInt`, so an explicit provider-compatibility rule also accepts that form only when it is a finite safe integer. The API therefore uses `injectedSkills` and `skill-injected`.

It does not call the evidence read, executed, selected, followed, or completed. Those terms imply filesystem access, model behavior, routing, or outcomes that the metric does not establish.

## Why the scope is one collector lifetime

OTLP counter exports may be cumulative and repeated. The collector collapses every accepted export during its lifetime into one presence set. It does not have a sound provider event boundary from which to derive injection occurrences.

`collector-lifetime` states the boundary the library actually controls: after creation and before shutdown/drain. A caller may align that lifetime with one Codex invocation, but the library does not inspect or enforce the caller's process boundary and does not claim a stronger scope.

## Why counts, order, topology, and attribution are excluded

Repeated cumulative points cannot be interpreted as repeated injections, and the metric supplies no supported ordering or dependency edge. Resource, scope, agent, thread, parent-thread, turn, and session data are outside the retention allowlist even if present in a raw payload.

The public evidence snapshot consequently contains no count, timestamp, sequence, edge, parent/child relationship, agent role, or model-thread identifier. The boolean unknown classification reveals no unknown label and does not create an exemplar. Separate bounded receiver diagnostics may count transport and rejection stages, but are not part of this evidence result and do not claim provider event occurrences.

## Renma responsibility

Renma owns statically declared Skill dependencies, expected transitive topology, and repository evidence. This library owns only bounded provider-runtime observations. It does not invoke Renma, compare expected and observed sets, or reconstruct dependency topology.

A future caller integration may choose to compare a snapshot with Renma data, but that policy belongs outside this collector API.

## Privacy and lifecycle consequences

The caller allowlist is validated before the loopback server opens. Raw requests are bounded, parsed only in memory, atomically reduced to finite state, and cleared. Counter magnitudes and datapoint flags are inspected only to enforce recorded, strictly positive presence and are then discarded without retention, exposure, logging, hashing, or encoding. The separate diagnostics retain only bounded value-shape and sign categories. A missing numeric field is decoded but ineligible for evidence. Conflicting numeric fields, invalid types or syntax, out-of-range integers, fractional or unsafe JSON-number integers, non-finite doubles, and invalid flags fail the entire request without partial evidence. Unknown labels are compared and discarded under the same restrictions; diagnostics can retain only a saturating count of unknown-or-missing labels. Shutdown stops new connections, drains accepted requests, and force-closes active connections after the documented grace period.

This produces a deliberately small API at the cost of excluding raw event callbacks, debugging payloads, automatic persistence, process management, and generic telemetry access.

The JSON Schema uses standard `uniqueItems: true` for uniqueness and the explicit `x-sorted: true` contract annotation for canonical lexical ordering. JSON Schema draft 2020-12 cannot compare adjacent arbitrary strings; the producer enforces ordering and the package tests verify it. The schema's 256-scalar `maxLength` implies the documented 1,024-byte UTF-8 ceiling for well-formed Unicode, and the implementation validates both bounds.

## Unresolved before caller integration

- how a caller should align one collector lifetime with its own Codex process lifecycle;
- how configuration failures, HTTP rejections, and forced shutdown should be surfaced in caller observability without adding content-bearing logs;
- whether consumers need a supported schema-validation helper rather than the exported JSON Schema alone;
- how snapshot schema evolution will be versioned after an integration exists; and
- which package surface, if any, can be shared after a second provider is tested.
