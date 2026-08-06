---
name: renma-integration-subagent-parent-20260806
description: Synthetic subagent-parent fixture. Use only when explicitly invoked by its exact dollar-prefixed name.
---

This is a synthetic runtime-evidence integration fixture.

Spawn exactly one subagent using the custom-agent role `renma_integration_worker_20260806`. Ask it only to follow its custom-agent instructions and return its synthetic acknowledgement. Wait for it to finish, then return exactly `RENMA_INTEGRATION_SUBAGENT_ACK`. Do not inspect files or call unrelated tools.
