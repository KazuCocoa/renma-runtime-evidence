# Live Codex → frozen Git deployment → local OTLP transport

This closes the earlier split between the synthetic Git/transport fixture and
the live-input OTLP record. One opt-in run now uses real temporary Git commits,
real Codex provider metrics, and an actual loopback HTTP send:

```sh
npm run build
node .build/experiments/codex-model-freshness/src/run.js --use-chatgpt-login --allow-codex-analytics --midturn-capability --emit-runtime-otel --with-git-transport
```

The two conditions still use separate servers, collectors and fresh homes. A
new repository is initialized **inside each owned temporary workspace**, with
empty templates, disabled hooks/signing, isolated Git configuration, and fixed
synthetic author identity/dates. Only the known synthetic Skill path is staged
and committed. A is committed before the collector/server starts. In the
Skill condition, the barrier commits B before replying to the model.

Each commit is verified by reading the exact known file from HEAD and comparing
it with authored fixture bytes, and by checking the tracked file has no diff.
Only a finite provenance label, verification scope, commit hash and known digest
are returned. The verifier rejects an existing repository, unknown file bytes,
non-regular files and an unexpected index. It does not inspect or change the
user's repository or Git configuration. Temporary repositories are removed.
These commits describe the synthetic deployment; they are not Renma repository
commits, plugin synchronization proof, or provider-reported injected revisions.

## Version 2 record and transport

The Git-bearing record uses
`renma.experimental-codex-runtime-presence.v2` and instrumentation scope version
`2`. No-Git records retain v1. Version 2 keeps the same single-record provider /
deployment grouping and adds these **conditional wrapper fields**:

- `renma.deployment.commit`: copied before collector start, only with observed
  fixture presence.
- `renma.deployment.commit_provenance = fixture-git-verifier`.
- `renma.deployment.commit_verification_scope = one-known-skill-file-at-commit`.

The candidate digest must match the verifier's known digest. Later Git state
cannot alter the bound commit. Missing presence omits both digest and commit.
Nothing adds a commit/digest to the provider group; injected revision remains
unsupported. The report separately records initial/latest wrapper Git evidence.

After the real collector drains, the runner serializes its reduced projection
and sends `POST /v1/logs` with `application/json` to an owned `127.0.0.1` receiver.
The receiver compares each chunk to the expected reduced bytes and retains only
an exact-match boolean. It accepts no arbitrary endpoint configuration, writes
no raw request body, bounds the packet to 32 KiB, times out the HTTP request, and
closes all connections on cleanup. The receipt records protocol/receiver class
and success, without a port, path, address, timestamp or request contents.

This proves the bounded record was sent and received locally. The receiver is a
byte comparator, **not an OpenTelemetry backend**. Pinned protobuf round trips
separately validate the records' representational compatibility. Neither test
establishes production indexing, retry/delivery guarantees, or arbitrary Renma
adapter correctness. The public package API remains unchanged.

## CLI 0.157.1 live observation, 2026-09-27

The [saved bounded report](results/20260927-cli-0.157.1-git-transport.json)
records successful model/tool completion and exact local HTTP receipt in both
conditions. The known synthetic commit A was
`1f60efc74ee4c8e5847447f4c442f6679f9c4cfa`; the Skill condition later committed B as
`77f7f7395b2d60d40c9d0d28bb9a76d67770e2ac`. Its transmitted wrapper group retained A,
while the provider group contained neither hash. The direct condition emitted
no candidate commit/digest because the fixture Skill label was absent.
The Skill artifact again matched A after the B update.

Saved-record protobuf tests verify both the prior no-Git v1 run and this v2
record without relabeling replay as a new runtime observation. The separate Git
and HTTP test uses synthetic provider input; its results are not the live report.
