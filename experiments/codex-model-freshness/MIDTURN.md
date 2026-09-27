# Mid-turn replacement and direct capability comparison

This is a real Codex CLI `app-server` experiment with a repository-authored
synthetic dynamic tool. It is not an MCP server or a remote Skill host. It uses
the same privacy and authentication boundaries as the [between-turn experiment](README.md).

```sh
npm run build
node .build/experiments/codex-model-freshness/src/run.js --use-chatgpt-login --allow-codex-analytics --midturn-capability
```

Two conditions run sequentially in **separate server processes, homes,
workspaces, ephemeral threads, and metric collector lifetimes**:

- `direct-tool`: install Skill A but request the fixed dynamic tool directly,
  without a Skill input item. Do not mutate the fixture or request an artifact.
- `skill-midturn`: explicitly request Skill A. It instructs the model to call the
  same fixed dynamic tool before writing the A artifact. On the correlated tool
  request, replace the known fixture with B and verify its bytes **before replying
  to the tool**. The reply contains a fixed acknowledgement, with no body revision
  or artifact token. Then allow the turn to finish.

Both conditions list the installed Skill before the turn and force a listing
refresh afterward. These listing observations do not assert that the body was
read or injected. The post-turn listing is not a mid-turn read observation.

## Allowed signals and ordering

The experimental dynamic-tool protocol is documented in the official
[app-server guide](https://learn.chatgpt.com/docs/app-server) and was checked
against the installed CLI 0.157.1 generated types. This mode alone opts into
`experimentalApi` and registers the one exact function with an empty-object
input schema.

Only the exact `item/tool/call` method, function, null namespace, expected thread,
and empty argument object are accepted. A bounded routing-only projection waits
for the confirmed turn ID before handling an early request. Duplicate or
unexpected requests fail closed. Routing identifiers stay in memory and are
never reported. The handler cannot execute arbitrary arguments or mutate an
arbitrary path: it can only install the fixed synthetic B fixture.

The report distinguishes:

- **Provider tool request/completion:** exact correlated dynamic-tool request
  observed, and `item/completed` reports success/failure/unsupported.
- **Wrapper handler:** handler ran; replacement bytes verified before its reply.
- **Provider Skill presence:** existing allowlisted metric snapshot and usable
  pipeline category, scoped to that condition's collector lifetime.
- **Wrapper deployment/artifact:** immutable before/after known-byte digests and
  the exact fixed artifact predicate.

`finalDeployment` denotes the last wrapper-verified installation (at the barrier
for the mutation row), not a provider-reported revision or a later arbitrary
filesystem scan. None of these fields substitutes for another. The provider's completion signal
and the wrapper's handler observation are reported separately. Presence alone
cannot establish tool invocation, body reading, injected revision, or causal
attribution to a Skill. An absent Skill metric with a working pipeline also does
not establish that no Skill was read by any mechanism.

## CLI 0.157.1 observation, 2026-09-27

The [bounded report](results/20260927-cli-0.157.1-midturn.json) records one real
comparison. Both turns completed; both exact tool calls completed successfully;
no unknown Skill label was observed.

| Condition              | Skill metric | Usable pipeline                  | Mutation                | Fixed artifact | Final listing |
| ---------------------- | ------------ | -------------------------------- | ----------------------- | -------------- | ------------- |
| Direct tool request    | absent       | other metric datapoints received | none                    | absent         | A             |
| Explicit Skill request | present      | accepted Skill evidence          | A → B before tool reply | A              | B             |

The direct-request condition demonstrates that the capability signal can be
observed separately from the Skill metric in this fixture. It does not prove
absence of all loading, nor a general rule for every tool/provider.

During the Skill-requested turn, the wrapper verified B on disk before answering
the barrier, but the later artifact matched A. Therefore, using the final B
checkout/digest as a proxy for the turn's behavior would lose a material
distinction. The report still leaves `injectedRevision` and
`skillCausedToolCall` unsupported: A behavior could reflect already injected
instructions, prior reads, or another path this experiment did not observe.
This result supports keeping the immutable start snapshot separate from later
synchronization state; it does not turn the start snapshot into provider proof.

A separate synthetic protocol test deliberately delivers the tool request before
the `turn/start` response. It verifies the mutation/response ordering and privacy
projection; its output is not used as real runtime evidence. Remote manifest
freshness, producer TTL/cache scope, explicit body-read evidence, and deployed
OTel backend behavior remain unmeasured.
