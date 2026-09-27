import { writeFileSync, renameSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { createUsageCollector } from "./collector.js";

// Installed as the synthetic plugin's MCP server. It exposes no model-callable tools.
const port = Number(process.argv[2]);
const output = process.argv[3];
if (
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535 ||
  !output ||
  !isAbsolute(output)
)
  throw new Error("Invalid fixture receiver options");
let collector: Awaited<ReturnType<typeof createUsageCollector>> | undefined;
const persist = () => {
  if (!collector) return;
  writeFileSync(
    join(output, "observations.tmp"),
    JSON.stringify(collector.snapshot()),
    { mode: 0o600 },
  );
  renameSync(
    join(output, "observations.tmp"),
    join(output, "observations.json"),
  );
};
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await collector?.close();
  persist();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
process.stdin.on("end", () => void stop());
process.stdout.on("error", () => void stop());
const deadline = setTimeout(() => void stop(), 900_000);
deadline.unref();
try {
  collector = await createUsageCollector(port, persist);
} catch (error) {
  const reason =
    error instanceof Error && "code" in error && error.code === "EADDRINUSE"
      ? "address-in-use"
      : "receiver-start-failed";
  writeFileSync(
    join(output, "startup-failure.json"),
    JSON.stringify({ reason }),
    { mode: 0o600 },
  );
  process.exit(1);
}
persist();
let buffer = "";
process.stdin.on("data", (chunk: Buffer) => {
  if (stopping) return;
  if (Buffer.byteLength(buffer) + chunk.length > 65536) {
    void stop();
    return;
  }
  buffer += chunk.toString("utf8");
  let end: number;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    try {
      const message = JSON.parse(line);
      if (message.id === undefined) continue;
      if (!(
        typeof message.id === "number" ||
        (typeof message.id === "string" && message.id.length <= 128)
      ))
        throw new Error("Invalid routing");
      let result: unknown;
      if (message.method === "initialize")
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "renma-usage-fixture", version: "1.0.0" },
        };
      else if (message.method === "tools/list") result = { tools: [] };
      else if (message.method === "ping") result = {};
      else {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Unsupported fixture method" },
          }) + "\n",
        );
        continue;
      }
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n",
      );
    } catch {
      void stop();
      return;
    }
  }
});
