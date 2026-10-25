/** Reject unsafe release contexts before candidate code or provider credentials are used. @file */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { SHA } from "./contract.mjs";

/** Validate event/target combinations independently of source-history access. */
export function releaseContext(env) {
  assert.ok(["dev", "production"].includes(env.CI_ENVIRONMENT));
  assert.match(env.CI_SOURCE_SHA ?? "", SHA);
  assert.ok(
    ["push", "pull_request", "workflow_dispatch"].includes(
      env.GITHUB_EVENT_NAME,
    ),
  );
  if (env.GITHUB_EVENT_NAME !== "pull_request")
    assert.equal(env.GITHUB_REF, "refs/heads/main");
  if (env.CI_ENVIRONMENT === "production") {
    assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
    assert.equal(
      env.GITHUB_RUN_ATTEMPT,
      "1",
      "Inspect failures; use a fresh production dispatch",
    );
    assert.ok(
      env.GITHUB_WORKFLOW_REF ===
        `${env.GITHUB_REPOSITORY}/.github/workflows/verify-and-deploy-prod.yml@refs/heads/main`,
    );
  }
}

/** Require ancestry in the trusted control checkout and reject stale automatic dev. */
export function source(env = process.env) {
  releaseContext(env);
  if (env.GITHUB_EVENT_NAME !== "pull_request") {
    execFileSync(
      "git",
      [
        "-C",
        "control",
        "merge-base",
        "--is-ancestor",
        env.CI_SOURCE_SHA,
        "origin/main",
      ],
      { stdio: "pipe" },
    );
    if (env.GITHUB_EVENT_NAME === "push") {
      const main = execFileSync(
        "git",
        ["-C", "control", "rev-parse", "origin/main"],
        { encoding: "utf8" },
      ).trim();
      assert.equal(
        env.CI_SOURCE_SHA,
        main,
        "Automatic dev source was superseded",
      );
    }
  }
  if (env.GITHUB_OUTPUT)
    appendFileSync(env.GITHUB_OUTPUT, `source_sha=${env.CI_SOURCE_SHA}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  source();
