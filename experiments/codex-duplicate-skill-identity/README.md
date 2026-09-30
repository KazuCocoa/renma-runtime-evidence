# Duplicate Skill names: discovery identity versus telemetry attribution

Repository-wide `name` uniqueness is **not established as necessary** by this experiment. Codex's metric label distinguished identical names in different plugins, but collapsed identical names inside the same plugin or an unqualified workspace. The minimum demonstrated requirement for counter attribution is an **unambiguous effective provider label in the active deployment**, not a repository-wide reservation of every generic name.

Renma [PR #311](https://github.com/KazuCocoa/renma/pull/311) was inspected read-only (open, head `d5ff1fee94b88499a840de2a6cee14117377b4dc`). No implementation, comments, merge, or other changes were made to that PR.

## Runtime and setup

- Actual `codex-cli 0.159.2`, macOS arm64, standard `app-server --stdio` and OTLP/HTTP JSON exporters, existing ChatGPT file login. No API key or runtime modification.
- Two authored Skills both declare `name: code-review`. A has `metadata["renma.id"] = experiment.a.code-review`; B has `experiment.b.code-review`. Descriptions, bodies and directories differ. These IDs remain ordinary static frontmatter; the experiment does not inject them into telemetry or runtime identity fields.
- Three layouts: workspace `.agents/skills/{a,b}/code-review/SKILL.md`; one plugin `identity-shared` with `skills/{a,b}/code-review/SKILL.md`; two plugins `identity-a` and `identity-b` with one Skill each. Installed fixture files were checked against their expected ID markers.
- Each layout ran in two fresh homes/workspaces/processes. Twelve real turns explicitly supplied the selected Skill's name **and path**, one A and one B per layout and repetition. A separate two-turn workspace run enabled standard logs and traces. Fourteen turns total; all completed. No task-success or response-content evaluation.
- Other agents were not tested (`claude` and `gemini` were unavailable locally). Desktop, other OSes, runtime versions, independent machines, and unqualified name-only selection were not tested. Relocation on one machine is not cross-machine validation.

## Results

| Layout      | Names in `skills/list`                             | `codex.skill.injected` attribute `skill`                         | A/B distinguishable in metrics?                    |
| ----------- | -------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| Workspace   | Both `code-review`                                 | `code-review`, sample value 2                                    | No: both static assets are candidates              |
| One plugin  | Both `identity-shared:code-review`                 | `identity-shared_code-review`, sample value 2                    | No: both static assets are candidates              |
| Two plugins | `identity-a:code-review`, `identity-b:code-review` | `identity-a_code-review`, `identity-b_code-review`, value 1 each | Yes: each observed label maps to one fixture asset |

Both fresh-environment repetitions produced this pattern. These are received counter samples, not a reconstruction of load order, causality, or complete usage. UTC timestamps are receiver observation times.

| Phase                        | Naturally observable evidence                                                                                                                                | What it establishes                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery                    | Skill object fields `name`, `path`, `description`, `scope`, `pluginId`, plus `enabled`; expected names/descriptions/paths matched for A and B in all layouts | Both assets are separately discoverable. A field's presence does not mean its value is non-null; `pluginId` was matched only for plugin fixtures.                                                                             |
| Explicit selection / loading | Standard `turn/start` Skill input accepts `name` and `path`; item notifications include user/agent items with `id`; injection counter received               | Selected path is caller intent. Its echo and a completed turn are **not independent proof** that the corresponding file, rather than a same-name candidate, was injected. No independent per-file load event was established. |
| Influence on execution       | No causal signal measured                                                                                                                                    | Unsupported; an injection observation is not proof that the Skill influenced the answer or that its instructions ran.                                                                                                         |
| After execution              | Target metric point has candidate attributes `skill` and `status`; no other identity candidates from our allowlist occurred at the metric point/resource     | Same-scope collisions remain ambiguous; different plugin labels resolved against the fixture deployment mapping.                                                                                                              |

The diagnostic run received 35 log records and 30 spans, plus one target metric sample. Among the explicitly inspected identity candidate attributes, logs had none; two spans had `name`, which matched neither fixture name nor path. No candidate path/URI/content digest/stable Skill ID was established. Unknown attribute names/values, log bodies, span names and nested notification content were discarded, so this is **not a claim that every possible runtime surface lacks an identity**. The reducer's precise candidate list is in [evidence.ts](src/evidence.ts).

No tool execution was requested or observed in these turns. Tool-item presence can be recorded by the observer, but a shell read command would still require careful attribution and would not by itself prove causal Skill use. Runtime item IDs identify events/items, not portable Skill assets; their values were not retained.

## Identity candidates and stability

| Candidate                                     | Stability and collision limits                                                                                                                                                        | Privacy and static mapping                                                                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bare Skill name                               | Repeated across sessions; collides for A/B in the same effective namespace                                                                                                            | Low-volume metadata, but names may reveal internal concepts; allowlist. Maps to `renma.id` only with a unique deployment match.                                                                                                                       |
| Plugin-qualified provider label               | Stable across the two relocated fixture runs; plugin rename/move changes it; no version or marketplace identity proven by the metric                                                  | Best measured metric identity. Freeze an exact label → asset mapping; reject collisions in the **emitted label**, rather than assuming string concatenation or plugin names are globally collision-free.                                              |
| `skills/list.path`                            | Distinguishes both discovered files; absolute prefix changes on relocation; absent from measured injection metrics                                                                    | May reveal usernames/project layout. Resolve locally against known deployment roots, emit only an approved relative locator/asset ID. A portable `(source identity, relative path)` is a static mapping strategy, not a newly observed load identity. |
| Description/content/fingerprint               | Description distinguishes the authored fixtures but is mutable and not guaranteed unique. Runtime fingerprint was not observed; identical content can also belong to different assets | Do not transmit description or content by default. A digest of known static bytes is manifest provenance, not proof of injected content.                                                                                                              |
| `pluginId`, scope                             | Plugin ID matched discovery records and survived relocation; same plugin ID does not distinguish A/B inside that plugin                                                               | Useful discovery context. Neither its full marketplace-qualified form nor version was established in the injection metric.                                                                                                                            |
| Event/item ID, URI, generated stable Skill ID | Item ID field exists, but stable Skill semantics were not established. URI and a better Skill ID were not observed in inspected candidates                                            | No recommendation; arbitrary IDs and paths are not persisted.                                                                                                                                                                                         |

## Recommended key and implications for PR #311

For current Codex **counter telemetry**, use `(provider, deployment identity, exact observed skill label)` and resolve against a frozen, verified deployment manifest. Keep the provider label separate from the resulting `renma.id`. If there are zero or multiple candidates, report unresolved/ambiguous. Do not use turn order, receipt time, or the caller's requested path to choose a winner. Deployment identity is wrapper/static context; the metric does not prove a Git revision or installed Skill version.

Outcome **B is demonstrated for different plugins**, within the tested deployment: Codex naturally qualifies the observable label with plugin identity. Outcome **A applies narrowly to the tested metric channel inside one effective namespace**: its label collapses A/B, and no additional per-asset identity was established there. Outcome **C was not demonstrated**. Discovery itself provides richer evidence and should not be equated with load/usage telemetry.

Therefore PR #311's repository-wide invariant cannot be justified solely by the general statement “runtime only exposes `name`.” If every Skill in a repository must be shipped into one plugin and exact counter attribution is mandatory, unique names **within that deployment** are justified by these results. If separate plugins/deployments are allowed, generic names can coexist. The repository may still choose a stricter governance policy, but that is a separate design decision. Leave #311 unchanged pending that decision.

## Evidence, privacy and reproduction

- [Discovery](results/discovery.json): 6 metadata-only scenarios, zero model turns.
- [Live matrix](results/live.json): 12 explicit-selection model turns, 8 target metric samples.
- [Diagnostic run](results/diagnostics.json): 2 additional turns, logs/traces projected to candidate field presence and exact fixture-match predicates.
- All observation records come from the real runtime. Fixture aliases and static label-to-asset joins are experiment-owned interpretation and must not be presented as emitted runtime IDs.
- No raw prompts, responses, reasoning, transcripts, tool inputs/outputs, arbitrary paths, event IDs or descriptions are persisted. Input envelopes are transiently parsed; only explicit allowlist projections survive. Temporary homes are removed after each scenario. Standard diagnostic exporters can carry content: this experiment's receiver reduces it before persistence; forwarding raw exports to a production backend is not authorized by this result.
- `path` comparison uses canonical filesystem paths. Early metadata-only pilots initially missed matches because of macOS temporary-directory aliases; after canonicalization both A/B matched. No model calls were spent on those pilots.

```sh
npm run build
node .build/experiments/codex-duplicate-skill-identity/src/run.js --output /tmp/duplicate-discovery.json
node .build/experiments/codex-duplicate-skill-identity/src/run.js --live --output /tmp/duplicate-live.json
node .build/experiments/codex-duplicate-skill-identity/src/run.js --live --extended --output /tmp/duplicate-diagnostics.json
npm test
```

The first command opens only a loopback receiver and uses no model. Live commands use the existing ChatGPT login and explicitly enable analytics in isolated CLI processes. Each main run reserves attempts before dispatch and caps them at 12; extended mode has one two-turn scenario. Re-running deliberately incurs new model calls. Saved result files are not merged across runs.

Official protocol reference: [Codex app-server](https://learn.chatgpt.com/docs/app-server) documents path-bearing explicit Skill input and `skills/list`. Documentation explains the interface; the duplicate-name conclusions above come from the actual saved runs.
