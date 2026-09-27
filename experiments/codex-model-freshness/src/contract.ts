import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LISTING_DESCRIPTIONS,
  LISTING_FIXTURE_NAME,
} from "../../codex-listing-freshness/src/listing.js";

export const ARTIFACT = "renma-model-freshness-result.txt";
export const TOKENS = {
  a: "RENMA_MODEL_FRESHNESS_A",
  b: "RENMA_MODEL_FRESHNESS_B",
} as const;
export const SCENARIOS = [
  "initial-a",
  "same-thread-b-cached",
  "new-thread-b-cached",
  "same-thread-b-forced",
] as const;
export type Revision = "a" | "b";
export type Scenario = (typeof SCENARIOS)[number];
export type TurnStatus = "completed" | "failed" | "interrupted" | "unsupported";

export function fixture(revision: Revision): string {
  return `---\nname: ${LISTING_FIXTURE_NAME}\ndescription: ${LISTING_DESCRIPTIONS[revision]}\n---\n\nThis is a synthetic runtime-evidence freshness fixture. Write exactly ${TOKENS[revision]} with no newline into ${ARTIFACT} in the current workspace, overwriting any previous file. Do not inspect any other files, use any other Skill, or spawn agents. Return a short acknowledgement.\n`;
}

export function deployment(revision: Revision) {
  return Object.freeze({
    provenance: "experiment-wrapper" as const,
    revision,
    scope: "exact-known-fixture-bytes" as const,
    digest: `sha256:${createHash("sha256").update(fixture(revision)).digest("hex")}`,
  });
}

export function requireOptIn(args: readonly string[]): void {
  if (
    args.length !== 2 ||
    new Set(args).size !== 2 ||
    !args.includes("--use-chatgpt-login") ||
    !args.includes("--allow-codex-analytics")
  )
    throw new Error("Explicit ChatGPT-login and analytics opt-in required");
}

export const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** IDs are transient routing handles, never evidence or report fields. */
export function ephemeralThreadId(input: unknown): string {
  const thread = object(object(input)?.thread);
  if (
    thread?.ephemeral !== true ||
    typeof thread.id !== "string" ||
    !thread.id.length ||
    thread.id.length > 256
  )
    throw new Error("Ephemeral thread unavailable");
  return thread.id;
}

export function startedTurnId(input: unknown): string {
  const turn = object(object(input)?.turn);
  if (typeof turn?.id !== "string" || !turn.id.length || turn.id.length > 256)
    throw new Error("Turn unavailable");
  return turn.id;
}

export function completedTurn(
  input: unknown,
  threadId: string,
  turnId: string,
): TurnStatus | undefined {
  const message = object(input);
  if (message?.method !== "turn/completed") return undefined;
  const params = object(message.params);
  const turn = object(params?.turn);
  if (params?.threadId !== threadId || turn?.id !== turnId) return undefined;
  return turn.status === "completed" ||
    turn.status === "failed" ||
    turn.status === "interrupted"
    ? turn.status
    : "unsupported";
}

export async function artifactRevision(
  workspace: string,
): Promise<Revision | "absent" | "unknown"> {
  const path = join(workspace, ARTIFACT);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size !== Buffer.byteLength(TOKENS.a))
      return "unknown";
    const value = await readFile(path, "utf8");
    return value === TOKENS.a ? "a" : value === TOKENS.b ? "b" : "unknown";
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return "absent";
    throw new Error("Fixed artifact inspection failed");
  }
}
