# Repository invariants

- Never collect privacy-sensitive content by default.
- Raw prompts, responses, reasoning, transcripts, tool inputs, and tool outputs are prohibited.
- Build every observation from an explicit allowlist; discard everything else before persistence.
- Report unsupported runtime behavior as unsupported. Do not infer, simulate, or fabricate evidence.
- Keep provider-specific evidence distinguishable from normalized evidence.
- Do not expand this project into task evaluation, threat detection, or agent orchestration without an explicit design decision.
