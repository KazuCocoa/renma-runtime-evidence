import { startBackend } from "../../local-telemetry-system/src/backend.js";
import { durableSender } from "../../local-telemetry-system/src/sender.js";
const [mode, path, target] = process.argv.slice(2);
const token = process.env.RENMA_TEST_TOKEN;
if (!path || !target || !token) process.exit(1);
const backend =
  mode === "backend"
    ? await startBackend(path, token, Number(target))
    : undefined;
const sender =
  mode === "sender" ? durableSender(path, target, token) : undefined;
if (!backend && !sender) process.exit(1);
process.send?.({ ready: true, endpoint: backend?.endpoint ?? null });
process.on("message", async (message: unknown) => {
  const m = message as { id?: number; action?: string; value?: unknown };
  if (!Number.isSafeInteger(m.id)) return;
  try {
    if (m.action === "accept" && typeof m.value === "boolean")
      backend?.setAccepting(m.value);
    else if (m.action === "lose-ack") backend?.loseNextAcknowledgement();
    else if (m.action === "enqueue") sender?.enqueue(m.value);
    else if (m.action === "flush") await sender?.flush();
    else if (m.action !== "snapshot") throw new Error("Unknown control");
    const b = backend?.snapshot();
    process.send?.({
      id: m.id,
      ok: true,
      result: b
        ? {
            stored: b.records.length,
            duplicates: b.duplicates,
            unauthorized: b.unauthorized,
            rejected: b.rejected,
          }
        : sender!.snapshot(),
    });
  } catch {
    process.send?.({ id: m.id, ok: false });
  }
});
process.on("disconnect", () => process.exit(0));
