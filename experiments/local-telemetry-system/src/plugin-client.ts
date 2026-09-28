// This self-contained module is embedded in node -e args, avoiding installation-path assumptions.
const endpoint = process.argv[1];
if (!endpoint || !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/health$/.test(endpoint))
  process.exit(1);
try {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(2000) });
  let text = "";
  if (!response.body) throw new Error("No response");
  for await (const chunk of response.body) {
    if (text.length + chunk.length > 256) throw new Error("Limit");
    text += Buffer.from(chunk).toString("utf8");
  }
  if (
    response.status !== 200 ||
    text !== JSON.stringify({ service: "renma-usage-fixture", version: 1 })
  )
    throw new Error("Incompatible broker");
} catch {
  process.exit(1);
}
let buffer = "";
const stop = () => process.exit(0);
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdin.on("end", stop);
process.stdout.on("error", stop);
setTimeout(stop, 900000).unref();
process.stdin.on("data", (chunk: Buffer) => {
  if (buffer.length + chunk.length > 65536) return stop();
  buffer += chunk.toString("utf8");
  let end: number;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    try {
      const msg = JSON.parse(line);
      if (msg.id === undefined) continue;
      if (!(
        Number.isSafeInteger(msg.id) ||
        (typeof msg.id === "string" && msg.id.length <= 128)
      ))
        return stop();
      const result =
        msg.method === "initialize"
          ? {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: {
                name: "renma-local-telemetry-client",
                version: "1.0.0",
              },
            }
          : msg.method === "tools/list"
            ? { tools: [] }
            : msg.method === "ping"
              ? {}
              : null;
      process.stdout.write(
        JSON.stringify(
          result === null
            ? {
                jsonrpc: "2.0",
                id: msg.id,
                error: { code: -32601, message: "Unsupported" },
              }
            : { jsonrpc: "2.0", id: msg.id, result },
        ) + "\n",
      );
    } catch {
      return stop();
    }
  }
});
export {};
