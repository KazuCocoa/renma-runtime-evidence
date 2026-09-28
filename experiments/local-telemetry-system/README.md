# Local telemetry system: six-track results

Implementation and evidence: [PR #26](https://github.com/KazuCocoa/renma-runtime-evidence/pull/26).

All six tracks have local evidence, with the limits below. Ten additional model turns were reserved and completed out of the authorized maximum of 60. Raw runtime content and credentials were not saved. The goal covers a local experiment, not a production deployment or an automatic archival decision.

## Conclusions and completion audit

| Track                | Evidence                                                                                                                                                    | Result / boundary                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Sync provenance   | Real Git repositories, clone/fetch/checkout, Renma 0.39.2 catalog, installed bytes; [sync report](results/20260928-sync.json) and three integration reports | Two authored repositories × four deployment states. Stable asset IDs, source commits and verified Skill-file digests join actual telemetry through frozen manifests. Renma catalogs sources; the wrapper performs Git sync and packaging.                                                                                                           |
| 2. Update resolution | Six real native turns with three installed updates; [current CLI report](results/20260928-integration-current.json)                                         | Unique deployment → equivalent content across commits → ambiguous changed content → modified deployment. Old and fresh threads both emit after a content update. Candidate sets remain conservative; the actual injected revision is unsupported.                                                                                                   |
| 3. Plugin delivery   | Nine actual MCP path probes, a second isolated home, real updates, removal; [path/removal report](results/20260928-plugin-paths.json)                       | Identical inline Node MCP configuration connects in two homes without rewriting an installed-script path. Fresh threads have zero plugin servers after removal, while the shared receiver remains healthy. Prior [lifecycle experiments](../codex-plugin-lifecycle/README.md) cover disable/re-enable, existing processes and live removal windows. |
| 4. OTLP delivery     | Local HTTP/storage faults and official Docker Collector 0.161.0; [delivery report](results/20260928-delivery.json)                                          | Reduced records survive sender/backend reinitialization, lost acknowledgements and auth recovery; exact transport duplicates are removed. Collector forwards and retries, but the tested in-memory pending record does not return after forced restart. HTTP 200 alone is not durable delivery.                                                     |
| 5. Dashboard         | [Screenshot](results/dashboard.png), browser interactions and API tests                                                                                     | Saved real observations, UTC receipt filters, counts, Git candidates and unknown coverage. Synthetic delivery observations/checkpoints are separate. Empty periods are unknown; overlapping metric intervals block an aggregate.                                                                                                                    |
| 6. Compatibility     | Three actual model/OTLP runs below                                                                                                                          | macOS arm64 CLI 0.157.1 and 0.156.0, Linux arm64 Docker CLI 0.157.1. Other platforms and Desktop runtime remain untested. Deterministic Node tests are a separate compatibility dimension.                                                                                                                                                          |

## Actual runtime matrix

| Environment                 | CLI     | Node    | Model turns | Persisted provider samples | Report                                                 |
| --------------------------- | ------- | ------- | ----------- | -------------------------- | ------------------------------------------------------ |
| macOS arm64                 | 0.157.1 | 24.18.0 | 6           | 6                          | [current](results/20260928-integration-current.json)   |
| macOS arm64                 | 0.156.0 | 24.18.0 | 2           | 2                          | [previous](results/20260928-integration-previous.json) |
| Linux arm64 / Colima Docker | 0.157.1 | 24.18.0 | 2           | 2                          | [Docker](results/20260928-integration-docker.json)     |

All ten turns completed. All three sender queues drained and all samples projected successfully. Alpha has seven observed delta increments, beta three. These are counter increments, not task execution counts. The second-home MCP check and path/removal probes used no model turns.

The current run includes one existing-thread checkpoint where the known MCP server was identified but `connected` was false. The sample still arrived. The report does not establish the omitted runtime status or equate MCP status with exporter delivery.

The [turn ledger](results/model-turn-ledger.json) reserves before dispatch and includes failed dispatched calls. Deterministic tests use temporary ledgers. An initial Docker attempt failed during plugin validation because Python YAML support was absent; no model turn was dispatched. The Dockerfile now includes that dependency. The earlier goal's model calls are outside this ledger.

## What the evidence means

The provider supplies a known Skill label, monotonic delta, metric interval and allowlisted metadata in the collector report. The receiver supplies UTC receipt time. The wrapper supplies producer identity/epoch, deployment candidate set and a verified immutable manifest. Their origins stay distinct.

Each manifest row contains an explicit repository alias, canonical `metadata["renma.id"]`, Skill name, plugin, Git source commit, SHA-256 digest and a `commitMatchesContent` flag. Git commits come from real authored fixture repositories. Digest scope is **SKILL.md only**, not supporting scripts or the whole repository. A dirty checkout can have the same HEAD with different bytes; the digest and match flag retain that distinction. An unchanged Skill can span multiple commits. Frozen candidate mappings prevent a current version label from silently rewriting older observations.

The normalizer accepts only explicit fixture IDs/names, finite enums, bounded numeric values and validated hashes/times. No arbitrary repository paths, prompts, responses, reasoning, transcripts, runtime tool arguments/results or credentials enter saved observations. Unknown fields are discarded before hashing, queue persistence, backend storage and dashboard use. Authentication is ephemeral and supplied to the Docker collector through its environment.

Metric series dimensions are not retained in the normalized record. Exact retries of the same reduced envelope can be deduplicated, but a second receipt with a different time is not presumed to be a provider duplicate. Overlapping intervals within a known producer epoch make the count ambiguous. Disjoint intervals can be summed as **received increments**; gaps never prove complete coverage. Fixture producer epochs are scoped to one saved run per mode; this runner is not a general multi-installation identity service.

## Packaging and coexistence

This tests the legacy `.codex-plugin/plugin.json` + `.mcp.json` compatibility format. Current packaging documentation also describes a portable root format, which was not tested here.

Absolute-path control and a self-contained inline Node module connected. Relative argument/command paths, `${PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_ROOT}`, and the tested shell environment-root alternatives failed on CLI 0.157.1. These are MCP probe results; they do not contradict documented hook-variable support.

The successful module is embedded in `.mcp.json` and performs a health check/MCP handshake without opening another receiver port. It requires Node on PATH and an explicitly provisioned shared broker and Codex exporter configuration. It does **not** itself activate global Codex telemetry or provide a zero-setup installer. The exact configuration works in two isolated homes on the same broker; arbitrary hosts still need their receiver address configured. The configured exporter endpoint text remains preserved through the live updates. Earlier [coexistence experiments](../codex-telemetry-coexistence/README.md) test concurrent producers, cooperative plugins and collision controls; universal cooperation with unknown third-party plugins is not established.

Later tests of persistent queues, OS-process crashes, TLS and load are in the [additional local operational experiments](../telemetry-hardening/README.md). The results below retain their original scope.

## Delivery boundaries

The experimental backend receives **OTLP/HTTP JSON logs** carrying one reduced `renma.observation` attribute, forwarded by the real OTel Collector. This is not general raw Codex log collection. Direct provider metrics first pass through the allowlisted usage collector. The backend binds loopback, checks an ephemeral bearer credential, limits input size and reconstructs records before storage. It supports one process/writer, bounded queues and atomic file replacement with file fsync.

Fault checks show 503/TCP retry, sender reload from disk, acknowledgement loss after storage, backend reload with exact-record deduplication, 401 blocking without a retry loop and recovery after replacing the credential. Deterministic tests also reject malformed/partial success acknowledgements while retaining the queue. Partial success requires inspection; blindly retrying it is not claimed safe.

The official Docker Collector accepted the test envelope, recovered queued data after a temporary backend outage, and accepted a later record while the backend was down. After forcibly killing/recreating the Collector, that pending record was absent during a three-second recovery window; new traffic then worked. Its queue was memory-only. The image digest and bounded window are retained in the report. Wrapper retry behavior is **not** a Codex exporter guarantee. See the earlier actual-provider outage experiments for missing-traffic limits.

Not tested: backend OS-process crash or power-loss durability (backend/sender objects were re-created from disk), persistent Collector queues, TLS, gRPC, multi-writer storage, large-scale load or a remote production receiver. The Collector itself was really killed/recreated. No external service or paid backend was provisioned.

## Dashboard verification

After `npm run build`, run from the repository root:

```sh
node .build/experiments/local-telemetry-system/src/dashboard.js 18581
```

Open `http://127.0.0.1:18581`. The dashboard loads the saved reports at startup; restart it after replacing those reports. It is not a continuously collecting service.

Browser checks confirmed:

- Real observations: total 10, alpha 7, beta 3; three runtime environments, UTC timeline and mixed/dirty provenance.
- Future range: no samples, unknown counts, 0/2 observed Skills. Reset restores the data.
- Inverted range: visible input error.
- Synthetic selection: five delivered synthetic increments, beta unknown, six separate queue/auth/outage checkpoints; no mixing with real use.
- Desktop 1280×900 and narrow 390×844 layouts; table can scroll horizontally on narrow screens.

The two-Skill inventory is explicitly authored for this experiment. Delivery checkpoints show when a state was checked; they do not measure an entire outage interval or prove the actual provider's collection completeness. Earlier lifecycle reports contain exposure/availability evidence. Production coverage denominators, installation IDs and archival policy need a separate design.

## Reproduction

Prerequisites: repository dependencies/build, built Renma CLI, Codex CLI, Node, Git, plugin-creator helper scripts and Python with PyYAML. Model runs require the two explicit consent flags and an existing ChatGPT **file** login. The ledger must already exist; do not reset it to evade the goal's budget.

```sh
npm ci
npm run build
node .build/experiments/local-telemetry-system/src/run-sync.js /absolute/path/to/renma/dist/index.js
node .build/experiments/local-telemetry-system/src/run-paths.js
node .build/experiments/local-telemetry-system/src/run-delivery.js
node .build/experiments/local-telemetry-system/src/run-integration.js current \
  /absolute/path/to/renma/dist/index.js \
  /absolute/path/to/plugin-creator/scripts /absolute/path/to/python3 \
  /absolute/path/to/results/model-turn-ledger.json \
  --use-chatgpt-login --allow-codex-analytics
```

For the previous-version run, install `@openai/codex@0.156.0` in an isolated prefix, put its `bin` directory first on PATH and use mode `previous`. It performs two turns. Current mode performs six. Each run emits only the reduced JSON report; keep each complete report separately rather than merging reused fixture epochs.

Docker uses the included Dockerfile, Node 24.18.0 and Codex 0.157.1. Build with `docker build -t renma-telemetry-goal:codex-0.157.1 experiments/local-telemetry-system`. Run as the host UID/GID, mounting this checkout at `/workspace:ro`, the goal results directory at `/workspace/experiments/local-telemetry-system/results:rw` for atomic ledger writes, built Renma at `/renma:ro`, helper scripts at `/helpers:ro`, and the authorized file login at `/auth/auth.json:ro`. Set `CODEX_HOME=/auth` and run the integration entry point with mode `docker`, paths `/renma/dist/index.js`, `/helpers`, `/usr/bin/python3`, the mounted ledger and both consent flags. This performs two turns. Never copy the credential into an image or report.

The delivery runner uses `otel/opentelemetry-collector:0.161.0`, pins the resolved digest in its report, creates owned disposable containers and disables payload logging. Docker must access the repository mount and `host.docker.internal`. An initial macOS temporary-directory mount failed; using an owned temporary directory under the shared checkout resolved it. Failed containers are cleaned up after create/start failures.

Run deterministic validation with `npm run check`; no live model calls or Docker are required by those tests. Saved-evidence assertions validate consistency, not replay a provider interaction.

References: [OTLP specification](https://opentelemetry.io/docs/specs/otlp/), [HTTP exporter](https://github.com/open-telemetry/opentelemetry-collector/blob/main/exporter/otlphttpexporter/README.md), [Collector release](https://github.com/open-telemetry/opentelemetry-collector-releases/releases/tag/v0.161.0), [plugin packaging](https://developers.openai.com/plugins/build/plugins).
