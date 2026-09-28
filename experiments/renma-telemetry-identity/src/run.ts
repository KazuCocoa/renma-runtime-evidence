import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { manifest, type Mapping } from "./manifest.js";
import { liveDeployments } from "./live.js";
import { requireOptIn } from "../../codex-model-freshness/src/contract.js";
const hash = (s: string | Buffer) =>
  `sha256:${createHash("sha256").update(s).digest("hex")}`;
const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
async function run() {
  const [flag, cli, ...consent] = process.argv.slice(2);
  const live = consent.length > 0;
  if (live) requireOptIn(consent);
  if (
    flag !== "--renma-cli" ||
    !cli ||
    !isAbsolute(cli) ||
    (!live && process.argv.length !== 4)
  )
    throw new Error("Explicit Renma CLI path required");
  const root = await mkdtemp(join(tmpdir(), "renma-identity-"));
  const call = (exe: string, args: string[], cwd: string) =>
    spawnSync(exe, args, {
      cwd,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        HOME: root,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.invalid",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      },
    });
  const git = (args: string[], cwd: string) => {
    const r = call("git", args, cwd);
    if (r.status !== 0) throw new Error("Fixture Git failed");
    return r.stdout.trim();
  };
  try {
    const version = call(
      process.execPath,
      [cli, "--version"],
      root,
    ).stdout.trim();
    if (!/^(?:renma )?\d+\.\d+\.\d+$/.test(version))
      throw new Error("Unsupported Renma version");
    const repositories = ["repository-a", "repository-b"] as const;
    for (const repo of repositories) {
      await mkdir(join(root, repo));
      git(["init", "-q"], join(root, repo));
    }
    const rows: Mapping[] = [];
    const observations: {
      deployment: string;
      repository: string;
      explicitIdRecognized: boolean;
      sourcePathMatched: boolean;
      contentHashMatched: boolean;
      catalogExit: number | null;
      gitCommit: string;
      packagedBytesMatch: boolean;
    }[] = [];
    let nestedIdRecognized: boolean | null = null;
    for (const deployment of ["before", "after"] as const) {
      for (const repo of repositories) {
        const isAlpha = repo === "repository-a";
        const name = isAlpha
          ? deployment === "before"
            ? "renma-usage-alpha"
            : "renma-renamed-alpha"
          : "renma-usage-beta";
        const id = isAlpha ? "skill.fixture-alpha" : "skill.fixture-beta";
        const plugin =
          deployment === "before"
            ? "renma-bundle"
            : isAlpha
              ? "renma-moved-bundle"
              : "renma-bundle";
        const version = deployment === "before" ? "1.0.0" : "2.0.0";
        const repoPath = join(root, repo);
        await rm(join(repoPath, "skills"), { recursive: true, force: true });
        const relative = `skills/${name}/SKILL.md`,
          path = join(repoPath, relative);
        await mkdir(join(repoPath, "skills", name), { recursive: true });
        const body = `---\nname: ${name}\ndescription: Synthetic identity measurement only.\nmetadata:\n  renma.id: ${id}\n  renma.owner: fixture-team\n  renma.status: active\n  renma.version: "${version}"\n---\n\nReturn a short acknowledgement. Do not use tools or other Skills. Revision ${deployment}.\n`;
        if (deployment === "before" && isAlpha) {
          await writeFile(
            path,
            body.replace(`  renma.id: ${id}`, `  renma:\n    id: ${id}`),
          );
          const raw = call(
            process.execPath,
            [cli, "catalog", repoPath, "--json"],
            repoPath,
          );
          const entries = obj(obj(JSON.parse(raw.stdout))?.catalog)?.entries;
          if (!Array.isArray(entries)) throw new Error("Catalog unavailable");
          nestedIdRecognized = entries.some((e) => obj(e)?.id === id);
        }
        await writeFile(path, body);
        git(["add", "skills"], repoPath);
        git(
          ["-c", "commit.gpgsign=false", "commit", "-qm", deployment],
          repoPath,
        );
        const commit = git(["rev-parse", "HEAD"], repoPath);
        if (!/^[a-f0-9]{40}$/.test(commit))
          throw new Error("Commit unavailable");
        const raw = call(
          process.execPath,
          [cli, "catalog", repoPath, "--json"],
          repoPath,
        );
        const parsed = obj(JSON.parse(raw.stdout));
        const entries = obj(parsed?.catalog)?.entries;
        if (
          parsed?.schemaVersion !== "renma.catalog.v1" ||
          !Array.isArray(entries)
        )
          throw new Error("Catalog unavailable");
        const matches = entries
          .map(obj)
          .filter((e) => e?.kind === "skill" && e.sourcePath === relative);
        if (matches.length !== 1) throw new Error("Skill unavailable");
        const e = matches[0]!;
        const explicitIdRecognized = e.id === id && obj(e.metadata)?.id === id;
        const digest = hash(body);
        const contentHashMatched =
          e.contentHash === digest || e.contentHash === digest.slice(7);
        if (!explicitIdRecognized || !contentHashMatched)
          throw new Error("Catalog identity mismatch");
        const bundled = join(
          root,
          "bundles",
          deployment,
          plugin,
          "skills",
          name,
        );
        await mkdir(bundled, { recursive: true });
        await copyFile(path, join(bundled, "SKILL.md"));
        const packagedBytesMatch =
          (await readFile(join(bundled, "SKILL.md"), "utf8")) === body;
        rows.push({
          deployment,
          repository: repo,
          assetId: id,
          plugin,
          name,
          version,
          digest,
        });
        observations.push({
          deployment,
          repository: repo,
          explicitIdRecognized,
          sourcePathMatched: true,
          contentHashMatched,
          catalogExit: raw.status,
          gitCommit: commit,
          packagedBytesMatch,
        });
      }
    }
    const mapping = manifest(rows);
    const resolution = mapping.rows.map((r) => ({
      deployment: r.deployment,
      label: r.providerLabelCandidate,
      resolved: mapping.resolve(r.deployment, r.providerLabelCandidate),
    }));
    let duplicateNameRejected = false;
    try {
      manifest([
        ...rows,
        { ...rows[0]!, assetId: "skill.another", repository: "repository-b" },
      ]);
    } catch {
      duplicateNameRejected = true;
    }
    const liveResults = live ? await liveDeployments(root, rows) : null;
    return {
      schemaVersion: "renma.identity-evolution-experiment.v1",
      evidenceClass: "real-renma-catalog-and-git-on-authored-fixtures",
      renmaVersion: version,
      cliEntryDigest: hash(await readFile(cli)),
      nestedIdRecognized,
      canonicalMetadataKey: "metadata[renma.id]",
      observations,
      manifest: mapping.rows,
      resolution,
      duplicateNameRejected,
      crossDeploymentLabelRejected:
        mapping.resolve("after", mapping.rows[0]!.providerLabelCandidate) ===
        null,
      liveCodexRenamedLabel: live ? "see-live-results" : "not-tested",
      liveResults,
      injectedRevision: "unsupported",
      packagingOwner: "experiment-wrapper-not-renma",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
run()
  .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
  .catch(() => {
    process.stderr.write('{"outcome":"identity-experiment-failed"}\n');
    process.exitCode = 1;
  });
