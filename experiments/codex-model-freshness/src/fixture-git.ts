import { spawnSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { LISTING_FIXTURE_NAME } from "../../codex-listing-freshness/src/listing.js";
import { barrierDeployment, barrierFixture } from "./barrier.js";
import type { Revision } from "./contract.js";

export interface FixtureGitEvidence {
  readonly provenance: "fixture-git-verifier";
  readonly verificationScope: "one-known-skill-file-at-commit";
  readonly commit: string;
  readonly contentDigest: string;
}
const relativeSkill = `.agents/skills/${LISTING_FIXTURE_NAME}/SKILL.md`;

/** Only for a new, owned temporary fixture workspace; never use caller Git config. */
export async function createFixtureGit(
  workspace: string,
  home: string,
  source: NodeJS.ProcessEnv,
) {
  try {
    await lstat(join(workspace, ".git"));
    throw new Error("Fixture repository must be new");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw new Error("Fixture repository must be new");
  }
  const env: NodeJS.ProcessEnv = {
    PATH: source.PATH,
    HOME: home,
    XDG_CONFIG_HOME: home,
    LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "Renma Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Renma Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
  const git = (args: string[], capture = false) => {
    const result = spawnSync(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: workspace,
        env,
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 4096,
        stdio: ["ignore", capture ? "pipe" : "ignore", "ignore"],
      },
    );
    if (result.status !== 0 || result.error)
      throw new Error("Synthetic Git operation failed");
    return result.stdout ?? "";
  };
  git(["init", "--quiet", "--template=", "--initial-branch=main"]);
  return Object.freeze({
    async commit(revision: Revision): Promise<FixtureGitEvidence> {
      if (revision !== "a" && revision !== "b")
        throw new Error("Unknown fixture revision");
      const bytes = barrierFixture(revision);
      const info = await lstat(join(workspace, relativeSkill));
      if (!info.isFile() || info.size !== Buffer.byteLength(bytes))
        throw new Error("Fixture bytes do not match");
      if ((await readFile(join(workspace, relativeSkill), "utf8")) !== bytes)
        throw new Error("Fixture bytes do not match");
      git(["add", "--", relativeSkill]);
      if (git(["ls-files", "--cached"], true) !== `${relativeSkill}\n`)
        throw new Error("Unexpected fixture index");
      git([
        "commit",
        "--quiet",
        "--only",
        "-m",
        `Synthetic fixture ${revision}`,
        "--",
        relativeSkill,
      ]);
      const commit = git(["rev-parse", "HEAD"], true).trim();
      if (
        !/^[a-f0-9]{40}$/u.test(commit) ||
        git(["show", `HEAD:${relativeSkill}`], true) !== bytes
      )
        throw new Error("Fixture Git verification failed");
      git(["diff", "--quiet", "HEAD", "--", relativeSkill]);
      return Object.freeze({
        provenance: "fixture-git-verifier",
        verificationScope: "one-known-skill-file-at-commit",
        commit,
        contentDigest: barrierDeployment(revision).digest,
      });
    },
  });
}
