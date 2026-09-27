# Deployment snapshot and freshness boundary

This is an **experiment-only local filesystem fixture**, not a Codex run,
MCP-host characterization, or supported public API. It does not read a user's
Skills, invoke a model, require authentication, or enable analytics.

Run after building:

```sh
npm run build
node .build/experiments/deployment-snapshot/src/run-fixture.js
```

The runner reads only the two repository-owned synthetic `SKILL.md` fixtures,
creates one temporary file, replaces its A contents with B, and removes the
temporary directory in `finally`. It emits a projected JSON result to stdout;
there is no automatic persistence. The source commit is the validated Git HEAD
identifier, supplied by the wrapper. It is **not verification that the copied
file equals a file at that commit**. A and B retain the same frontmatter name
and explicit Renma ID. The `a`/`b` directories are fixture selectors, not actual
runtime Skill installation directories.

## Renma identity inspected

The design was checked against the clean local Renma checkout at
[`1ee8ee4fc121228e19437bf3006912f3f635c283`](https://github.com/KazuCocoa/renma/tree/1ee8ee4fc121228e19437bf3006912f3f635c283),
not an assumed globally stable identity scheme. Remote main had advanced to
`8b1fd4f3bd4314eaf10e8edd1a4cebb4505ab0c0` when checked on 2026-09-27;
this experiment makes no compatibility claim for that later source.

- [`metadata-definitions.ts`](https://github.com/KazuCocoa/renma/blob/1ee8ee4fc121228e19437bf3006912f3f635c283/src/metadata-definitions.ts)
  maps the effective ID field to `metadata.renma.id`.
- [`catalog.ts`](https://github.com/KazuCocoa/renma/blob/1ee8ee4fc121228e19437bf3006912f3f635c283/src/catalog.ts)
  uses the metadata ID, falling back to the artifact path. It preserves source
  path separately and uses the artifact content hash or a SHA-256 fallback.
- The [Execution Contract](https://github.com/KazuCocoa/renma/blob/1ee8ee4fc121228e19437bf3006912f3f635c283/docs/execution-contract.md)
  distinguishes asset content, selected-evidence digest, exact serialized
  contract digest, and caller-provided unverified source revision.

Consequently the manifest does not treat `name` as a global ID, export fallback
paths, equate the Skill-file digest with a contract or directory-tree digest,
or upgrade a supplied commit to verified content. A real adapter would need
an explicit reviewed mapping from repository-scoped Renma identities to allowed
export identities; unknown or path-fallback identities must remain unmapped.

## Minimal manifest proposal exercised here

`manifest.ts` uses the experiment version
`renma.experimental-deployment-snapshot.v1`, a fixed wrapper provenance and
repository alias, a nullable caller-supplied commit, and at most two rows. Each
row has an exact allowed asset ID, the one allowed frontmatter name, SHA-256 of
exact `SKILL.md` bytes, explicit digest scope, and a local comparison state.
`matches-reference` refers only to the chosen reference fixture, never to Git
cleanliness. No timestamp, run/session ID, path, URL, arbitrary metadata,
instructions, tool payload, or provider lifecycle event is exported.

The catalog is initialized only from the two reviewed fixture files. Subsequent
content must equal A or B before it can be recognized; arbitrary bytes are not
hashed as a substitute for privacy. Snapshots reconstruct and freeze all fields
before a run/collector could begin. No later sync state is consulted when
resolving that snapshot. Extra caller properties are discarded.

| Case                                              | Fixture result                          | Evidence limit                                        |
| ------------------------------------------------- | --------------------------------------- | ----------------------------------------------------- |
| Replace A with B before a new binding             | New snapshot contains B                 | Deployment only                                       |
| Replace A with B after an A binding               | Old immutable snapshot still contains A | No agent ran during the replacement                   |
| Two deployment rows with the same name            | `ambiguous`, no chosen row              | Includes duplicate identical rows                     |
| No allowed deployment row                         | `unmapped`                              | Never guess from paths or timing                      |
| One allowed row                                   | `unique-deployment-candidate`           | Injected revision remains `unsupported`               |
| A listing compared with B bytes                   | `differs-from-listing`                  | Cannot distinguish stale listing from changed content |
| Retained A listing compared with retained A bytes | `matches-listing`                       | Does not establish current remote freshness           |
| Unknown bytes                                     | `unrecognized-content`                  | No content or digest emitted                          |

The retained A/A pair models the ambiguity of a cached pair; it is **not an
observed runtime cache**. `freshness` and mismatch `cause` are always
`inconclusive`; producer TTL and cache scope are `unsupported`. Host protocol
versions, listing/read events, direct capability vs Skill invocation, and
mid-agent-execution replacement have not been measured here. This does not
close [Issue #10](https://github.com/KazuCocoa/renma-runtime-evidence/issues/10).

## Result and next boundary

On 2026-09-27 the local filesystem fixture and deterministic tests established
that A/B replacement changes the deployment digest while the earlier snapshot
retains A; collision, unknown-content, and missing-identity cases remain bounded.
No result from CLI 0.146.0 is reused as evidence for CLI 0.157.1.

The next experiment can send only these reduced deployment facts beside a
synthetic provider-presence fixture through loopback OTLP. Such a transport test
must label its evidence as synthetic and keep wrapper provenance separate. A
real Codex/MCP-host result is still required before any runtime lifecycle or
injected-revision API is justified. No exports in the private package change.

## Actual local Git synchronization experiment

The first runner assigns the same repository HEAD as unverified provenance to
both fixtures. It does **not** test deployment from different Git commits. The
second runner closes that local Git gap:

```sh
npm run build
node .build/experiments/deployment-snapshot/src/run-git-fixture.js
```

It creates a synthetic-only temporary Git repository with real A and B commits,
clones it locally, and uses detached checkouts. Git runs with a fresh HOME,
disabled global/system configuration, empty templates/hooks, synthetic author
identity, fixed dates, no signing, no inherited Git overrides, bounded output,
and ten-second command timeouts. No network remote or credential is used.
Only validated commit identifiers, hashes of the two known fixtures, booleans,
and finite classifications leave the harness. Temporary repositories and homes
are removed on normal completion or exceptions. Abrupt process termination can
leave synthetic temporary data; no credentials or runtime content are present.

Observed on 2026-09-27, with no agent runtime involved:

1. Commit A was checked out and the exact deployed file matched the recognized
   bytes read from its Git object. The wrapper bound snapshot A.
2. Commit B was created in the source repository and fetched by the deployment.
   `origin/main` moved to B, while the detached HEAD and deployed bytes stayed A.
   Attaching the moving latest commit would therefore mislabel that deployment.
3. Explicitly checking out B produced a new matching deployment and snapshot B.
   Snapshot A retained its earlier commit and digest.
4. Replacing the B checkout's file with known A bytes produced an actual Git
   dirty result and content mismatch, while HEAD remained B.
5. Replacing it with an unrecognized synthetic token produced only
   `unrecognized-content`; the token was neither exported nor hashed.

`verifiedA` and `verifiedB` carry separate `fixture-git-verifier` provenance,
with scope `one-skill-md-at-verification-time`. They do not change the existing
manifest's `caller-supplied-unverified` source-revision field: that field is
still merely supplied to the manifest constructor. The verifier checks just the
named file against recognized Git-object bytes, not the complete repository,
Skill support files, a persistent guarantee, or any runtime-loaded content.

This supports pinning deployment state before collection and keeping it separate
from a moving sync reference. It does not implement a production sync plugin,
test a host cache, or establish revision injection. The detached checkout is
replaced only in this synthetic experiment; a future wrapper must protect its
run's files from concurrent mutation or report that content binding is unknown.
