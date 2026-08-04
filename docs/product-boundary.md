# Product boundary

`@renma/runtime-evidence` collects and normalizes privacy-preserving observations about which Skills were injected into an agent runtime context, beginning with Codex.

The project does not determine:

- whether Skill instructions were followed;
- whether a task succeeded or its result was high quality;
- which tool behavior was associated with a Skill;
- user intent or routing correctness;
- security threats; or
- agent orchestration behavior.

Renma may later correlate observations with declared Skill assets and identities. That integration is not part of this experiment.

Provider-specific evidence remains explicitly labeled. Normalization must not erase whether an observation came from Codex or turn a provider-specific signal into a stronger cross-provider claim.
