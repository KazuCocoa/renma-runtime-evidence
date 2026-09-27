# Codex app-server listing freshness (no model turn)

This opt-in experiment measures the **real installed app-server's local Skill
listing**, independently of model authentication and `codex.skill.injected`.
It sends only `initialize`, `initialized`, and seven `skills/list` requests.
It never starts a thread, model turn, capability invocation, or Skill execution.

```sh
npm run build
node .build/experiments/codex-listing-freshness/src/run-listing.js --run-listing-only
```

The exact opt-in is required before creating directories or probing Codex.
Ordinary tests and CI test only the reducers, configuration, and classification;
they do not invoke the installed Codex runtime. A CLI startup/RPC/shape failure
emits only a fixed failure message and exits nonzero. A complete but inconsistent
matrix is `inconclusive`, also nonzero. No report is automatically persisted.

## Isolation and reduction

Every invocation creates a fresh workspace, HOME and CODEX_HOME, with a single
synthetic project Skill. Only PATH is inherited. No API key, proxy, caller home,
Codex configuration, or Git environment is passed. The credentials store is
explicitly `file` within the fresh CODEX_HOME, so no caller keyring is requested.
Analytics and all three OTel exporters are explicitly disabled; prompt logging
and history persistence are disabled. `RUST_LOG=off` and discarded stderr avoid
retaining diagnostics. These are invocation configuration facts, not a packet
capture proving the absence of every possible background network activity.

RPC stdout is consumed only in bounded memory and reduced before output. The
reducer checks the requested workspace, one exact fixture name and expected
fixture path, and two exact known descriptions. It emits only:

- fixed scenario IDs and validated CLI version;
- fixture-entry cardinality (`none` / `one` / `multiple`);
- expected-path equality, listing-error presence, and other-Skill presence;
- known metadata revision (`a` / `b` / `unknown`) and enabled-state enum;
- presence of a `skills/changed` notification, with attribution unsupported;
- explicit unsupported body-read, injected-revision, and TTL claims.

Descriptions, bodies, paths, errors, user-agent/platform strings, arbitrary
attributes, and unknown Skill names are never emitted, hashed, or persisted.
Two hashes of **predefined synthetic file strings** are separately attributed to
`experiment-wrapper`; a file read is checked only for exact equality with the
known replacement before reporting that input fact. No arbitrary content is
hashed. This is not provider content-digest evidence.

The stream is capped at 4 MiB total and a 1 MiB buffered chunk/line boundary;
each RPC has a 15-second deadline. Child process groups are terminated and
temporary data is removed on completion, failure, SIGINT, or SIGTERM. SIGKILL
cannot be cleaned up in-process. Only synthetic files/local runtime state exist
in that temporary root; no conversation or tool invocation is requested.

System/bundled Skills can exist outside the isolated project. Their presence is
reduced to one boolean; this experiment does not claim the fixture is the only
Skill available to the runtime.

## Observed result — 2026-09-27

Final protocol: `codex-cli 0.157.1`, three fresh independent app-server
processes, no authentication, analytics configured false, no model turn. All
three returned `listing-refresh-observed` with the following identical matrix:

| Scenario                   | Change before request                          | forceReload | Fixture entries | Listed metadata |
| -------------------------- | ---------------------------------------------- | ----------- | --------------- | --------------- |
| `initial-a`                | Install A                                      | false       | one             | a               |
| `body-only-update-default` | Replace body with B; retain A name/description | false       | one             | a               |
| `body-only-update-force`   | None                                           | true        | one             | a               |
| `after-update-default`     | Replace description with B too                 | false       | one             | a               |
| `after-update-force`       | None                                           | true        | one             | b               |
| `after-removal-default`    | Remove fixture                                 | false       | one             | b               |
| `after-removal-force`      | None                                           | true        | none            | unknown         |

For every returned fixture, the expected path matched and enabled was true.
No listing error or `skills/changed` notification was observed during these
bounded sequences; other Skills were present. Wrapper-known file digests
differed after the body-only replacement in every run.

A preliminary probe before canonicalizing the temporary root reported path
mismatch and unknown metadata because of macOS temporary-path aliases. It is
not part of the final three-run matrix. The final runner canonicalizes its own
root before installing the fixture or sending requests; it never resolves an
arbitrary path returned by the provider. Earlier development runs also are not
counted as final repetitions.

## What this supports

In these immediate sequential requests, default listing retained pre-update
metadata and even a deleted fixture; forced reload reflected the description
change and removal. This is **actual local listing cache behavior** for the
specified CLI/version/protocol. The result does not establish a cache TTL,
watcher latency, behavior during an active model turn, or a universal rule that
default requests always remain stale. The classifier accepts either stale or
fresh default responses; it requires the initial and forced states to agree
with the bounded setup.

The body-only replacement demonstrates a narrower limitation: the selected
listing predicates (name/path/description/enabled) cannot distinguish those two
body revisions even after forced reload. It does not show whether the server
internally read the file body or what bytes a model later receives. No broader
claim is made about uninspected response fields.

The [official app-server documentation](https://learn.chatgpt.com/docs/app-server)
describes `skills/list`, its `forceReload` option, cached per-workspace results,
and change notifications. That documentation guided the protocol; the matrix
above is the measured evidence. No result from CLI 0.146.0 was reused.

This fills the listing portion of [Issue #10](https://github.com/KazuCocoa/renma-runtime-evidence/issues/10).
It does **not** complete the authenticated two-Skill injection experiment,
body-load/injection revision attribution, direct-vs-Skill capability comparison,
remote MCP listing validation, remote TTL/cache scope, or mid-model-turn updates.
The existing public provider-presence API is unchanged; this listing report is
experiment-only and is not normalized into an injection event.
