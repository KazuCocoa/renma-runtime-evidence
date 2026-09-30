# Plugin-owned observation of model-selected Skill reads

A plugin-bundled Hook **can identify a Skill by name and plugin-relative path when Codex selects it from descriptions and reads it through a tool**. This is stronger evidence than a discovery inventory or a caller-supplied path, but it is a **tool-mediated read observation**, not a universal per-Skill injection event.

## Setup

Actual Codex CLI 0.159.2 on macOS arm64, existing ChatGPT login, isolated temporary homes/workspaces. One plugin, `identity-shared`, bundles six Skills:

- A: `name: code-review`, payment retry/idempotency description, `skills/a/code-review/SKILL.md`.
- B: `name: code-review`, mobile offline/conflict description, `skills/b/code-review/SKILL.md`.
- Four distractors: SQL tuning, accessibility, release notes and image layout.

The ordinary payment/mobile prompts contain **no Skill name, plugin name, path, asset ID, or instruction to call a telemetry tool**. The model chooses from the available inventory. Skill bodies do not request telemetry or invoke a logging function. The plugin has no router or selection MCP tool. A separate explicit-input control supplies A's name/path to test the direct injection path; a simple arithmetic control requires no Skill.

Each scenario runs in a fresh thread; the four-scenario sequence repeats in a fresh home/process. A metadata-only check verifies all six Skills are enabled and the four plugin Hooks are discovered/trusted. This is a six-Skill proof of mechanism, not validation of routing quality with hundreds of Skills.

## Hook and privacy boundary

The plugin bundles `SessionStart`, `PreToolUse`, `PostToolUse` and `Stop` command Hooks. They use `PLUGIN_ROOT` to build the two known target paths. Each hook transiently processes its input and saves only:

- fixed event/tool categories and UTC hook observation time;
- whether a tool argument references one of the two exact known absolute paths, normalized to an authored relative path and `name: code-review`;
- whether the returned tool result contains the entire exact authored fixture text, saved as an A/B match predicate only.

No raw tool input/output, command, prompt, response, transcript, description, absolute path or runtime ID is retained. The hook never opens `transcript_path`. An argument mentioning a path is deliberately separated from a result containing the full fixture: a path reference alone could be `echo`, a failed read, or another operation. Arbitrary shell syntax and all filesystem accesses are not comprehensively decoded.

The saved records are local telemetry-ready observations. This follow-up does not send Hook events to a remote OTLP backend. Existing exporter/delivery experiments remain separate evidence.

## Trust prerequisite and controls

An initial eight-turn run produced no Hook records. A metadata probe established that the four enabled bundled Hooks were **untrusted**. Passing the global one-off trust-bypass option to this app-server invocation did not make these Hooks observable. That failed setup is retained in [live.json](results/live.json) and [hook-discovery.json](results/hook-discovery.json); it is not counted as evidence that path observation is impossible.

For the corrected run, the runner compares each installed Hook command against its authored command (including known plugin-root expansion), obtains its exact hash from `hooks/list`, writes `hooks.state.<key>.trusted_hash` **only in the temporary CODEX_HOME**, and restarts app-server. It checks the resulting `trusted` metadata. The runner's final version additionally verifies installed Hook script bytes before trusting. No ordinary user config, third-party Hook trust, or Renma PR #311 is changed. Users of a distributed plugin must review/trust its Hooks through the supported flow; installation alone does not establish trust.

## Corrected live results

[trusted-live.json](results/trusted-live.json) contains the corrected eight-turn run; [trusted-discovery.json](results/trusted-discovery.json) verifies six enabled Skills and four trusted Hooks in independently recreated environments.

| Request                              | First environment                                  | Second environment                                 |
| ------------------------------------ | -------------------------------------------------- | -------------------------------------------------- |
| Ordinary payment retry question      | A path in Pre/PostToolUse; full A fixture returned | A path in Pre/PostToolUse; full A fixture returned |
| Ordinary mobile offline question     | B path in Pre/PostToolUse; full B fixture returned | B path in Pre/PostToolUse; full B fixture returned |
| Explicit name/path injection control | SessionStart/Stop only; no Skill read observed     | SessionStart/Stop only; no Skill read observed     |
| Arithmetic/no-Skill control          | SessionStart/Stop only; no Skill read observed     | SessionStart/Stop only; no Skill read observed     |

All eight corrected turns completed. Four PostToolUse records distinguish A/B by exact path and confirm full authored text appeared in tool results. The `name` in normalized Hook records comes from the known fixture manifest; it is not a separate name field emitted by the Hook runtime. The path reference originates in real tool arguments. Both environments also received injection metric points under the same ambiguous `identity-shared_code-review` label. Those points are not assigned to individual reads or summed across unretained dimensions.

## Meaning of the result

For the natural-selection path, the useful key is `(plugin/deployment identity, Skill-relative path)` with the static manifest name retained for display. The plugin can map this locally to `renma.id` using its static manifest. Same-name A/B remain distinguishable. Hook receipt time supports a timeline of observed tool reads, not an exact injection timestamp.

Direct server-side injection can bypass tool reads. A `SessionStart` or `Stop` Hook proves observer liveness, but supplies no per-Skill path. A name-only injection counter cannot be joined to a read record just because their timestamps are close. Preserve two evidence kinds, such as `skill_read_observed` and `skill_injection_counter`; never silently convert one into the other.

Therefore the plugin-only Hook approach is useful for the user's “many Skills, model chooses one” flow, but it does not yet meet an unconditional requirement to identify **every injected Skill**. It also does not prove instructions influenced the answer, complete receipt coverage, production-scale routing, or support on other agents/OSes.

## Reproduction

```sh
npm run build
node .build/experiments/codex-plugin-skill-read/src/run.js --output /tmp/skill-read-inventory.json
node .build/experiments/codex-plugin-skill-read/src/run.js --live --output /tmp/skill-read-live.json
npm test
```

The live runner caps each run at eight reserved model attempts. Failed setup and corrected runs are separate, totaling sixteen attempts for this follow-up. Re-running incurs new calls. Temporary runtime state is removed in cleanup. Tests verify that path references alone are not classified as returned Skill content and that private/unrecognized data does not survive the Hook projection.

Official references: [Hooks](https://learn.chatgpt.com/docs/hooks) describes plugin roots, trust, tool inputs/results and coverage; [configuration schema](https://learn.chatgpt.com/docs/config-schema.json) defines per-Hook trusted hashes. Local protocol types were generated from the tested CLI to verify `hooks/list` fields.
