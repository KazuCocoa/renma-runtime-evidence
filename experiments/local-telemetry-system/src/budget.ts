import { open, readFile, rename, unlink } from "node:fs/promises";
import { FixtureRpc } from "../../codex-plugin-usage/src/rpc.js";

const SCHEMA = "renma.local-goal.turn-budget.v1";
export type Purpose =
  "plugin-integration" | "version-compatibility" | "lifecycle-boundary";
/** Reserve before dispatch. A crashed or failed call consumes its reservation. */
export async function reserveTurn(path: string, purpose: Purpose) {
  if (
    ![
      "plugin-integration",
      "version-compatibility",
      "lifecycle-boundary",
    ].includes(purpose)
  )
    throw new Error("Unknown purpose");
  const lock = await open(`${path}.lock`, "wx", 0o600);
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (
      raw.schemaVersion !== SCHEMA ||
      raw.limit !== 60 ||
      !Array.isArray(raw.attempts) ||
      raw.attempts.length >= 60
    )
      throw new Error("Turn budget unavailable");
    const attempts = raw.attempts.map(
      (
        row: { ordinal: number; purpose: string; reservedAt: string },
        i: number,
      ) => {
        if (
          row.ordinal !== i + 1 ||
          ![
            "plugin-integration",
            "version-compatibility",
            "lifecycle-boundary",
          ].includes(row.purpose) ||
          typeof row.reservedAt !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
            row.reservedAt,
          ) ||
          !Number.isFinite(Date.parse(row.reservedAt))
        )
          throw new Error("Invalid budget ledger");
        return {
          ordinal: row.ordinal,
          purpose: row.purpose,
          reservedAt: row.reservedAt,
        };
      },
    );
    const ordinal = attempts.length + 1;
    attempts.push({ ordinal, purpose, reservedAt: new Date().toISOString() });
    const file = await open(`${path}.tmp`, "w", 0o600);
    try {
      await file.writeFile(
        JSON.stringify(
          { schemaVersion: SCHEMA, limit: 60, attempts },
          null,
          2,
        ) + "\n",
      );
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(`${path}.tmp`, path);
    return ordinal;
  } finally {
    await lock.close();
    await unlink(`${path}.lock`);
  }
}

export class BudgetedRpc extends FixtureRpc {
  constructor(
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    private ledger: string,
    private purpose: Purpose,
  ) {
    super(args, cwd, env);
  }
  override async turn(thread: string, input: unknown[]) {
    await reserveTurn(this.ledger, this.purpose);
    return super.turn(thread, input);
  }
}
