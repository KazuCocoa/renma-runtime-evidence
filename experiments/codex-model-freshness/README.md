# Real model-turn Skill freshness experiment

This opt-in experiment uses the installed **Codex CLI `app-server`**, not a direct
model API. It combines the existing exact listing reducer with ephemeral model
threads and a fixed synthetic artifact predicate. It does not create a new
public lifecycle or execution-evidence API.

A separate opt-in [mid-turn/capability comparison](MIDTURN.md) adds a fixed
dynamic-tool barrier; the default four-turn sequence below is unchanged.

## Run

```sh
npm run build
node .build/experiments/codex-model-freshness/src/run.js --use-chatgpt-login --allow-codex-analytics
```

Authentication uses the explicitly authorized file-backed ChatGPT login through
the same temporary credential-link mechanism as the two-Skill runner. No API key,
user configuration, or user Skill directory is forwarded. Separate Codex
analytics is enabled with explicit consent; its traffic is not controlled by the
loopback metrics endpoint. Each model turn can consume normal account usage.
Ordinary tests and CI never run this command.

The protocol was checked against CLI 0.157.1's generated TypeScript declarations
and the official [app-server documentation](https://learn.chatgpt.com/docs/app-server).
Only `initialize`, `skills/list`, `thread/start`, and `turn/start` are requested.
Each model input explicitly names the known Skill and supplies its fixed local
Skill path. `thread/start` requests `ephemeral: true` and the reply must confirm
that property. No thread history is fetched or stored.

## Bounded sequence

One server and workspace host four sequential model turns:

1. Deploy A; obtain a default listing; start an ephemeral thread and invoke A.
2. Replace both description and body with B; obtain a default listing and invoke
   the same Skill path in the original thread.
3. Obtain another default listing; start a fresh ephemeral thread and invoke B.
4. Force listing refresh; invoke B again in the original thread.

The `cached` scenario labels mean a default listing request without forced
reload; the reported exact metadata predicate determines whether it actually
returned stale A, current B, or unknown metadata. For the fresh-thread row the
listing happens **before** thread creation. There is no mutation during an active
model turn. Each turn starts with the known artifact removed, preventing an old
file from satisfying a later predicate.

The A/B bodies require distinct fixed file contents. The wrapper inspects only
that exact artifact path, rejects symlinks, and exports `a`, `b`, `absent`, or
`unknown`. It hashes only repository-authored fixture strings and checks the
installed bytes equal those strings. These deployment digests and artifact
predicates have **wrapper provenance**, not provider-reported read/injection
provenance.

Provider observations are limited to exact listing predicates, correlated
`turn/completed` status, and one existing metric collector's presence snapshot
across the entire server lifetime. Metrics cannot be attributed to individual
turns or subtracted into synthetic lifecycle events. The collector shuts down
only after the server has stopped, allowing received requests to drain.

## Privacy and failure boundaries

Fresh temporary homes disable history persistence, prompt logging, trace/log
exporters, and runtime diagnostic logging. Model threads must be ephemeral.
The bounded RPC parser discards text, reasoning, tool content, errors, and all
non-allowlisted fields before reporting. Thread/turn IDs are transient routing
handles and never appear in the report. Stderr is discarded. No raw payloads are
written for debugging.

There is a 15-second RPC timeout, a 180-second turn timeout, and bounded stdout
buffer/total-byte limits. In the default sequence, all server requests fail closed. The barrier mode
accepts only its exact fixed tool request; all other requests and unsupported
responses fail closed. Process-group termination and temporary-directory cleanup run on
success, failure, and handled signals. A failure emits only a fixed stage enum;
it does not fabricate missing rows or claim an absence of runtime evidence.

Artifact behavior may be consistent with a body revision without proving which
bytes the provider injected: the model may read files, use prior conversation
context, or receive injected instructions. The experiment does not identify that
cause. Remote manifests, producer TTL, mid-turn mutation, direct MCP invocation,
and deployed OTel backend compatibility remain outside this measured sequence.

## Observation: CLI 0.157.1, 2026-09-27

The [bounded real-run report](results/20260927-cli-0.157.1.json) records one
complete sequence. All four provider turn statuses were `completed`.

| Condition                                       | Listing metadata | Fixed artifact |
| ----------------------------------------------- | ---------------- | -------------- |
| Initial A, original thread                      | A                | A              |
| B replacement, original thread, default listing | B                | B              |
| B replacement, fresh thread, default listing    | B                | B              |
| B replacement, original thread, forced listing  | B                | B              |

The lifetime collector observed the exact fixture Skill label, no unknown labels,
and usable accepted Skill evidence. That single observation does not identify
which turn emitted it or which body revision was injected.

The default listing reflected B in this model-thread sequence. In the earlier
[listing-only experiment](../codex-listing-freshness/README.md), default listings
retained A until a forced reload. The experiments differ in model-thread activity,
timing, and fixture bodies, so this comparison does **not** isolate a cache
invalidation mechanism or establish a TTL. No stale listing was observed in this
run. The B artifacts show bounded behavior after replacement; the provider read
or injection path remains unsupported.
