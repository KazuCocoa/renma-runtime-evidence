import { setTimeout as delay } from "node:timers/promises";
// Installed as two distinct synthetic plugins. No listener, tools, or persistent payloads.
const [base, producer, consumer] = process.argv.slice(2);
if (
  !base ||
  !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/.test(base) ||
  !["first", "second", "restarted"].includes(producer ?? "") ||
  !["alpha", "beta"].includes(consumer ?? "")
)
  process.exit(1);
const call = async (path: string, method = "POST") =>
  fetch(`${base}/${path}/${producer}/${consumer}`, {
    method,
    signal: AbortSignal.timeout(2000),
  });
let registered = false,
  stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  if (registered)
    try {
      const r = await call("stop");
      await r.body?.cancel();
    } catch {
      /* finite failure visible as missing stop */
    }
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
process.stdin.on("end", () => void stop());
process.stdout.on("error", () => void stop());
setTimeout(() => void stop(), 900000).unref();
try {
  for (let i = 0; i < 80; i++) {
    const r = await call("start");
    await r.body?.cancel();
    if (r.status === 200) {
      registered = true;
      break;
    }
    if (r.status !== 425) throw new Error("Hub unavailable");
    await delay(100);
  }
  if (!registered) throw new Error("Hub unavailable");
} catch {
  process.exit(1);
}
let buffer = "";
process.stdin.on("data", (chunk: Buffer) => {
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
      const m = JSON.parse(line);
      if (m.id === undefined) continue;
      if (!(
        Number.isSafeInteger(m.id) ||
        (typeof m.id === "string" && m.id.length <= 128)
      ))
        throw new Error("Routing");
      const result =
        m.method === "initialize"
          ? {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: {
                name: `renma-observer-${consumer}`,
                version: "1.0.0",
              },
            }
          : m.method === "tools/list"
            ? { tools: [] }
            : m.method === "ping"
              ? {}
              : null;
      process.stdout.write(
        JSON.stringify(
          result === null
            ? {
                jsonrpc: "2.0",
                id: m.id,
                error: { code: -32601, message: "Unsupported method" },
              }
            : { jsonrpc: "2.0", id: m.id, result },
        ) + "\n",
      );
    } catch {
      void stop();
    }
  }
});
while (!stopping) {
  try {
    const r = await call("view", "GET");
    let text = "";
    if (!r.body) throw new Error("Missing view");
    for await (const chunk of r.body) {
      if (text.length + chunk.length > 128) throw new Error("Limit");
      text += Buffer.from(chunk).toString("utf8");
    }
    const n = JSON.parse(text).sampleCount;
    if (r.status !== 200 || !Number.isSafeInteger(n) || n < 0 || n > 256)
      throw new Error("Invalid view");
    const ack = await fetch(`${base}/ack/${producer}/${consumer}/${n}`, {
      method: "POST",
      signal: AbortSignal.timeout(2000),
    });
    await ack.body?.cancel();
  } catch {
    /* No fabricated delivery; hub retains last successful acknowledgement. */
  }
  await delay(250);
}
