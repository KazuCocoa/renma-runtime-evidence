# Continuation experiment ledger

Scope: [Issue #10](https://github.com/KazuCocoa/renma-runtime-evidence/issues/10)
and the static/runtime boundary in
[Renma #174](https://github.com/KazuCocoa/renma/issues/174). A phase is complete
only when its stated evidence exists; fixtures cannot satisfy runtime criteria.

| Phase                      | Completion criterion                                                                                        | 2026-09-27 status                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Two-Skill characterization | Three isolated real CLI rows with usable pipeline and finite result                                         | Blocked before launch: this process has no `CODEX_API_KEY`; separate analytics acknowledgement pending                                  |
| Identity manifest          | Inspect actual Renma identity and test immutable deployment mapping, collisions, modifications, missing IDs | Local fixture implemented; experimental, not a public runtime contract                                                                  |
| Lifecycle/freshness        | Real host listing/read/direct invocation and bounded A/B updates; unsupported states explicit               | Local A/B replacement plus actual synthetic Git commits/fetch/checkout/dirty mismatch tested; agent-run updates and host caches not run |
| Provenance/OTel            | Minimal allowlisted transport with provider and deployment provenance separate                              | Synthetic collector-to-OTLP loopback projection tested; no runtime/backend compatibility claim                                          |
| Consumer boundary          | Document and version only demonstrated semantics                                                            | Existing provider-specific presence API retained; experimental field contract documented separately                                     |

Baseline: remote/main `3d237e85dc61419bda92a720e8bdbd1b5710dd33`, no open PR,
clean checkout, installed CLI `0.157.1`. Baseline checks: 131 passed, 1 skipped.
The restricted shell initially prevented loopback binding and npm packing;
the same checks passed with required local permissions and a temporary npm cache.

Previous CLI `0.146.0` quota/rate-limit results remain historical. No 0.157.1
matrix was launched, no saved credentials were read or copied, and no inference
about 0.157.1 metric semantics follows from a missing API key.

See the [deployment experiment](../experiments/deployment-snapshot/README.md).
The immutable snapshot experiment was merged in
[PR #11](https://github.com/KazuCocoa/renma-runtime-evidence/pull/11), with both
Node 22/24 CI jobs passing (138 local tests passed, 1 skipped).
The subsequent local Git experiment distinguishes moving `origin/main` from a
pinned deployment and records point-in-time file verification under separate
wrapper provenance. Neither experiment satisfies the real-host phase.
The actual Git synchronization experiment was merged in
[PR #12](https://github.com/KazuCocoa/renma-runtime-evidence/pull/12), with both
Node 22/24 CI jobs passing (139 local tests passed, 1 skipped).
The [OTLP projection and consumer boundary](../experiments/deployment-snapshot/OTEL.md)
now exercise the next independent fixture step. Runtime-derived evidence has
not been generated in this continuation; all new transport input is synthetic.
Independent local work proceeds while the external prerequisites are unresolved.
The existing characterization runner requires explicit analytics consent because
Codex's separate OpenAI analytics path is not controlled by the loopback exporter.
Secrets must be configured in the execution environment, never pasted into a
report or committed. Authentication failures must not trigger unchanged retries.
