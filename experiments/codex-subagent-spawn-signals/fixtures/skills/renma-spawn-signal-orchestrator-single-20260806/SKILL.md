---
name: renma-spawn-signal-orchestrator-single-20260806
description: Synthetic single-custom-agent orchestrator. Use only when explicitly invoked by its exact dollar-prefixed name.
---

This is a synthetic runtime-evidence experiment.

Spawn exactly one subagent using custom-agent role `renma_spawn_signal_worker_20260806`. Ask it only to follow its custom-agent instructions and return its synthetic acknowledgement. Do not use another Skill in this parent thread. Wait for the subagent to finish, then respond with exactly `RENMA_SPAWN_SIGNAL_SINGLE_ACK`.
