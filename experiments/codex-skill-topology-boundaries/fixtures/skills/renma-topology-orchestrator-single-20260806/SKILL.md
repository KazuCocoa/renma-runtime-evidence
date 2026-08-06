---
name: renma-topology-orchestrator-single-20260806
description: Synthetic single-subagent orchestrator. Use only when explicitly invoked by its exact dollar-prefixed name.
---

This is a synthetic runtime-evidence experiment.

Spawn exactly one subagent using the custom-agent role `renma_topology_worker_20260806`. Ask it only to follow its custom-agent instructions and return its synthetic acknowledgement. Do not use another Skill in this parent thread. Wait for the subagent to finish, then respond with exactly `RENMA_SUBAGENT_SINGLE_ACK`.
