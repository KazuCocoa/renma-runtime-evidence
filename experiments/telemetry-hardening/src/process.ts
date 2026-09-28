import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
export async function worker(
  mode: "backend" | "sender",
  path: string,
  target: string,
  token: string,
) {
  const child = fork(
    fileURLToPath(new URL("worker.js", import.meta.url)),
    [mode, path, target],
    {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, RENMA_TEST_TOKEN: token },
    },
  );
  let ordinal = 0;
  const waiting = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  const ready = await new Promise<{ endpoint: string | null }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Worker startup timeout"));
      }, 10000);
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Worker spawn failed"));
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Worker exited"));
      });
      child.on("message", (raw: any) => {
        if (raw?.ready === true) {
          clearTimeout(timer);
          resolve({
            endpoint: typeof raw.endpoint === "string" ? raw.endpoint : null,
          });
          return;
        }
        const pending = waiting.get(raw?.id);
        if (!pending) return;
        waiting.delete(raw.id);
        clearTimeout(pending.timer);
        if (raw.ok === true) pending.resolve(raw.result);
        else pending.reject(new Error("Worker operation failed"));
      });
    },
  );
  return {
    endpoint: ready.endpoint,
    request(action: string, value?: unknown): Promise<any> {
      const id = ++ordinal;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error("Worker request timeout"));
        }, 10000);
        waiting.set(id, { resolve, reject, timer });
        child.send({ id, action, value });
      });
    },
    async kill() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill("SIGKILL");
      await exited;
      for (const p of waiting.values()) {
        clearTimeout(p.timer);
        p.reject(new Error("Worker killed"));
      }
      waiting.clear();
    },
  };
}
