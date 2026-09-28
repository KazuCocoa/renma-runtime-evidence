import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  freezeManifest,
  resolveCandidates,
  DEPLOYMENTS,
  type Entry,
} from "./provenance.js";
export class SyncError extends Error {}
const object = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const digest = (bytes: string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const fixtureSkill = (
  alpha: boolean,
  revision: "initial" | "changed" | "dirty",
) =>
  `---\nname: renma-usage-${alpha ? "alpha" : "beta"}\ndescription: Synthetic sync telemetry fixture, explicitly requested only.\nmetadata:\n  renma.id: skill.fixture-${alpha ? "alpha" : "beta"}\n  renma.owner: fixture-team\n  renma.status: active\n  renma.version: "1.0.0"\n---\n\nReturn a short acknowledgement. Do not use tools, read files, or use other Skills. Fixture revision ${revision}.\n`;

/** Actual source commits -> clone/fetch/checkout -> actual Renma catalog -> exact copied bytes. */
export async function exerciseSync(
  renmaCli: string,
  consume?: (root: string, rows: readonly Entry[]) => Promise<unknown>,
) {
  const root = await mkdtemp(join(tmpdir(), "renma-local-sync-"));
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };
  const call = (exe: string, args: string[], cwd: string) => {
    const result = spawnSync(exe, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0) {
      const command =
        [
          "init",
          "add",
          "commit",
          "clone",
          "fetch",
          "checkout",
          "rev-parse",
          "show",
          "catalog",
          "--version",
        ].find((value) => args.includes(value)) ?? "unknown";
      const diagnostic = [
        "permission",
        "not found",
        "already exists",
        "unable",
        "invalid",
        "pathspec",
        "nothing to commit",
        "read-only",
        "module",
      ].filter((word) => result.stderr.toLowerCase().includes(word));
      throw new SyncError(
        JSON.stringify({ command, diagnostic, status: result.status }),
      );
    }
    return result.stdout;
  };
  const git = (args: string[], cwd: string) =>
    call(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      cwd,
    ).trim();
  try {
    const renmaVersion = call(
      process.execPath,
      [renmaCli, "--version"],
      root,
    ).trim();
    if (!/^(?:renma )?\d+\.\d+\.\d+$/.test(renmaVersion))
      throw new SyncError("Unknown version");
    for (const repository of ["repository-a", "repository-b"] as const) {
      const source = join(root, "sources", repository);
      await mkdir(
        join(
          source,
          `skills/renma-usage-${repository === "repository-a" ? "alpha" : "beta"}`,
        ),
        { recursive: true },
      );
      await writeFile(
        join(
          source,
          `skills/renma-usage-${repository === "repository-a" ? "alpha" : "beta"}/SKILL.md`,
        ),
        fixtureSkill(repository === "repository-a", "initial"),
      );
      git(["init", "-q"], source);
      git(["add", "skills"], source);
      git(["commit", "-qm", "Initial fixture"], source);
      await mkdir(join(root, "synced"), { recursive: true });
      git(
        ["clone", "-q", "--no-local", source, join(root, "synced", repository)],
        root,
      );
    }
    const rows: Entry[] = [];
    const checks = [];
    for (const deployment of DEPLOYMENTS) {
      for (const repository of ["repository-a", "repository-b"] as const) {
        const alpha = repository === "repository-a";
        const source = join(root, "sources", repository);
        const clone = join(root, "synced", repository);
        const relative = `skills/renma-usage-${alpha ? "alpha" : "beta"}/SKILL.md`;
        if (alpha && deployment === "same-content") {
          await writeFile(
            join(source, "README.md"),
            "Authored fixture metadata change.\n",
          );
          git(["add", "README.md"], source);
          git(["commit", "-qm", "Metadata only"], source);
        }
        if (alpha && deployment === "changed") {
          await writeFile(
            join(source, relative),
            fixtureSkill(true, "changed"),
          );
          git(["add", relative], source);
          git(["commit", "-qm", "Skill change"], source);
        }
        const sourceCommit = git(["rev-parse", "HEAD"], source);
        git(["fetch", "-q", "origin"], clone);
        git(["checkout", "-q", "--detach", sourceCommit], clone);
        if (alpha && deployment === "dirty")
          await writeFile(join(clone, relative), fixtureSkill(true, "dirty"));
        const revision =
          alpha && (deployment === "changed" || deployment === "dirty")
            ? deployment
            : "initial";
        const bytes = await readFile(join(clone, relative), "utf8");
        if (bytes !== fixtureSkill(alpha, revision))
          throw new SyncError("Unrecognized fixture bytes");
        const parsed = object(
          JSON.parse(
            call(
              process.execPath,
              [renmaCli, "catalog", clone, "--json"],
              clone,
            ),
          ),
        );
        const entries = object(parsed?.catalog)?.entries;
        if (
          parsed?.schemaVersion !== "renma.catalog.v1" ||
          !Array.isArray(entries)
        )
          throw new SyncError("Unknown catalog");
        const matched = entries
          .map(object)
          .filter((e) => e?.kind === "skill" && e.sourcePath === relative);
        const assetId = alpha ? "skill.fixture-alpha" : "skill.fixture-beta";
        const contentDigest = digest(bytes);
        if (
          matched.length !== 1 ||
          matched[0]?.id !== assetId ||
          ![contentDigest, contentDigest.slice(7)].includes(
            String(matched[0]?.contentHash),
          )
        )
          throw new SyncError(
            JSON.stringify({
              error: "Catalog mismatch",
              entries: entries.length,
              matched: matched.length,
              idMatches: matched[0]?.id === assetId,
              digestMatches: [contentDigest, contentDigest.slice(7)].includes(
                String(matched[0]?.contentHash),
              ),
            }),
          );
        const commitMatchesContent =
          call("git", ["show", `${sourceCommit}:${relative}`], clone) === bytes;
        const bundle = join(
          root,
          "bundles",
          deployment,
          alpha ? "renma-usage-alpha" : "renma-usage-beta",
        );
        await mkdir(bundle, { recursive: true });
        await copyFile(join(clone, relative), join(bundle, "SKILL.md"));
        if ((await readFile(join(bundle, "SKILL.md"), "utf8")) !== bytes)
          throw new SyncError("Bundle mismatch");
        rows.push({
          deployment,
          repository,
          assetId,
          skill: alpha ? "renma-usage-alpha" : "renma-usage-beta",
          plugin: "renma-usage-fixture",
          sourceCommit,
          contentDigest,
          commitMatchesContent,
          digestScope: "skill-file",
        });
        checks.push({
          deployment,
          repository,
          observedAt: new Date().toISOString(),
          cloneHeadMatchesSource:
            git(["rev-parse", "HEAD"], clone) === sourceCommit,
          catalogIdAndDigestMatch: true,
          packagedBytesMatch: true,
          commitMatchesContent,
        });
      }
    }
    const manifest = freezeManifest(rows);
    const label = "renma-usage-fixture_renma-usage-alpha";
    return {
      schemaVersion: "renma.local-sync-evidence.v1",
      evidenceClass: "real-git-sync-and-renma-catalog-authored-fixtures",
      renmaVersion,
      manifest,
      checks,
      resolution: [
        resolveCandidates(manifest, ["initial"], label),
        resolveCandidates(manifest, ["initial", "same-content"], label),
        resolveCandidates(manifest, ["initial", "changed"], label),
        resolveCandidates(manifest, ["dirty"], label),
        resolveCandidates(manifest, ["initial"], "unknown"),
      ],
      integration: consume ? await consume(root, manifest) : null,
      limits: {
        digestScope: "SKILL.md-only-not-supporting-files",
        injectedRevision: "unsupported",
        syncOwner: "experiment-wrapper",
        catalogOwner: "actual-renma-cli",
      },
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
