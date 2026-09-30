// Bundled fixture hook. Persist only finite predicates about authored Skills.
const fs = require("node:fs");
const path = require("node:path");
let input = "";
process.stdin.on("data", (chunk) => {
  input += chunk;
  if (input.length > 1048576) process.exit(1);
});
process.stdin.on("end", () => {
  try {
    const v = JSON.parse(input);
    if (
      !["SessionStart", "PreToolUse", "PostToolUse", "Stop"].includes(
        v.hook_event_name,
      )
    )
      return;
    const root = fs.realpathSync(process.env.PLUGIN_ROOT);
    const fixtures = ["A", "B"].map((alias) => {
      const relative = `skills/${alias.toLowerCase()}/code-review/SKILL.md`;
      const full = path.join(root, relative);
      return { alias, relative, full, content: fs.readFileSync(full, "utf8") };
    });
    const strings = (x, depth = 0) =>
      depth > 8
        ? []
        : typeof x === "string"
          ? [x]
          : x && typeof x === "object"
            ? Object.values(x).flatMap((y) => strings(y, depth + 1))
            : [];
    const args = strings(v.tool_input),
      result = strings(v.tool_response);
    const row = {
      event: v.hook_event_name,
      observedAtUTC: new Date().toISOString(),
      pluginRootAvailable: true,
      tool: ["Bash", "exec_command", "read_file"].includes(v.tool_name)
        ? v.tool_name
        : "other",
      pathReferences: fixtures
        .filter((f) => args.some((t) => t.includes(f.full)))
        .map((f) => ({
          asset: f.alias,
          name: "code-review",
          relativePath: f.relative,
        })),
      fullFixtureReturned: fixtures
        .filter((f) => result.some((t) => t.includes(f.content)))
        .map((f) => f.alias),
    };
    fs.appendFileSync(process.argv[2], JSON.stringify(row) + "\n", {
      mode: 0o600,
    });
  } catch {
    process.exitCode = 1;
  }
});
