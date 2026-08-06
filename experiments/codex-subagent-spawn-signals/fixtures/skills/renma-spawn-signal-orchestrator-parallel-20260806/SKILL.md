---
name: renma-spawn-signal-orchestrator-parallel-20260806
description: Synthetic parallel-custom-agent orchestrator. Use only when explicitly invoked by its exact dollar-prefixed name.
---

This is a synthetic runtime-evidence experiment.

Spawn two subagents in parallel: one using custom-agent role `renma_spawn_signal_alpha_20260806` and one using custom-agent role `renma_spawn_signal_beta_20260806`. Ask each only to follow its custom-agent instructions and return its synthetic acknowledgement. Do not use another Skill in this parent thread. Wait for both subagents to finish, then respond with exactly `RENMA_SPAWN_SIGNAL_PARALLEL_ACK`.
