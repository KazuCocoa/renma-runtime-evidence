import { spawn, type ChildProcess } from "node:child_process";
import {
  object,
  ephemeralThreadId,
  startedTurnId,
  completedTurn,
  type TurnStatus,
} from "../../codex-model-freshness/src/contract.js";

/** Bounded control channel; retains only routing IDs until completion. */
export class FixtureRpc {
  private child: ChildProcess;
  private closed: Promise<void>;
  private failed = false;
  private next = 0;
  private pending:
    | {
        id: number;
        reduce: (v: unknown) => unknown;
        resolve: (v: unknown) => void;
        reject: () => void;
        timer: NodeJS.Timeout;
      }
    | undefined;
  private active:
    | {
        thread: string;
        id?: string;
        early?: { id: string; status: TurnStatus };
        status?: TurnStatus;
        done?: () => void;
      }
    | undefined;
  constructor(
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    observe?: (message: unknown) => void,
  ) {
    this.child = spawn("codex", args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.closed = new Promise((resolve) =>
      this.child.once("close", () => {
        this.fail();
        resolve();
      }),
    );
    this.child.on("error", () => this.fail());
    this.child.stdin!.on("error", () => this.fail());
    let buffer = "",
      bytes = 0;
    this.child.stdout!.on("data", (chunk: Buffer) => {
      if (this.failed) return;
      bytes += chunk.length;
      if (
        bytes > 16 * 1024 * 1024 ||
        Buffer.byteLength(buffer) + chunk.length > 1024 * 1024
      ) {
        buffer = "";
        this.fail();
        return;
      }
      buffer += chunk.toString("utf8");
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const msg = object(JSON.parse(line));
          if (!msg) throw new Error("RPC");
          // Observers must immediately project onto an explicit allowlist.
          observe?.(msg);
          if (
            this.pending &&
            msg.id === this.pending.id &&
            msg.method === undefined
          ) {
            if (msg.error !== undefined) throw new Error("RPC");
            const v = this.pending.reduce(msg.result),
              p = this.pending;
            this.pending = undefined;
            clearTimeout(p.timer);
            p.resolve(v);
          } else if (msg.id !== undefined && msg.method !== undefined)
            throw new Error("Unexpected request");
          else if (this.active && msg.method === "turn/completed") {
            const params = object(msg.params),
              t = object(params?.turn);
            if (
              params?.threadId === this.active.thread &&
              typeof t?.id === "string" &&
              t.id.length <= 256
            ) {
              const status = completedTurn(msg, this.active.thread, t.id);
              if (status) {
                if (this.active.id === t.id) {
                  this.active.status = status;
                  this.active.done?.();
                } else if (!this.active.id)
                  this.active.early = { id: t.id, status };
              }
            }
          }
        } catch {
          buffer = "";
          this.fail();
          return;
        }
      }
    });
  }
  private signal(signal: NodeJS.Signals) {
    try {
      if (this.child.pid)
        process.platform === "win32"
          ? this.child.kill(signal)
          : process.kill(-this.child.pid, signal);
    } catch {
      /* exited */
    }
  }
  private fail() {
    this.failed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject();
      this.pending = undefined;
    }
    if (this.active) {
      this.active.status = "unsupported";
      this.active.done?.();
    }
    this.signal("SIGTERM");
  }
  request<T>(
    method: string,
    params: unknown,
    reduce: (v: unknown) => T,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.failed || this.pending) {
        reject(new Error("RPC unavailable"));
        return;
      }
      const id = this.next++;
      this.pending = {
        id,
        reduce,
        resolve: (v) => resolve(v as T),
        reject: () => reject(new Error("RPC unavailable")),
        timer: setTimeout(() => this.fail(), 20000),
      };
      this.child.stdin!.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async initialize() {
    await this.request(
      "initialize",
      { clientInfo: { name: "renma_usage_fixture", version: "1" } },
      () => null,
    );
    this.child.stdin!.write(
      JSON.stringify({ method: "initialized", params: {} }) + "\n",
    );
  }
  startThread(cwd: string) {
    return this.request(
      "thread/start",
      {
        cwd,
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "workspace-write",
        experimentalRawEvents: false,
      },
      ephemeralThreadId,
    );
  }
  async turn(thread: string, input: unknown[]) {
    this.active = { thread };
    const timer = setTimeout(() => this.fail(), 180000);
    try {
      const id = await this.request(
        "turn/start",
        { threadId: thread, input },
        startedTurnId,
      );
      this.active.id = id;
      if (this.active.early?.id === id)
        this.active.status = this.active.early.status;
      if (!this.active.status)
        await new Promise<void>((resolve) => {
          this.active!.done = resolve;
        });
      if (this.failed || this.active.status !== "completed")
        throw new Error("Model turn failed");
      return "completed" as const;
    } finally {
      clearTimeout(timer);
      this.active = undefined;
    }
  }
  async close() {
    this.signal("SIGTERM");
    const timer = setTimeout(() => this.signal("SIGKILL"), 1000);
    await this.closed;
    clearTimeout(timer);
  }
}
