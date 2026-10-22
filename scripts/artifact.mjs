/** Fingerprint only regular build files and bind the artifact to source and public configuration. @file */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SHA, DIGEST } from "./contract.mjs";

/** Hash a bounded regular-file tree, including relative filenames and exact bytes. */
export function digest(root) {
  const hash = createHash("sha256");
  let total = 0;
  /** Walk deterministically without following links outside the artifact. */
  function walk(directory, prefix = "") {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const info = lstatSync(path);
      assert.ok(!info.isSymbolicLink(), "Artifact symlinks are forbidden");
      if (info.isDirectory()) walk(path, `${prefix}${name}/`);
      else {
        assert.ok(info.isFile());
        total += info.size;
        assert.ok(total <= 500_000_000, "Artifact exceeds transport bound");
        hash.update(`${prefix}${name}\0${info.size}\0`);
        hash.update(readFileSync(path));
      }
    }
  }
  walk(root);
  assert.ok(total > 0, "Build output is empty");
  return hash.digest("hex");
}

/** Check the versioned release-record identity; smoke success is not owner acceptance. */
export function deliveryRecord(record, sha, environment) {
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.sourceSha, sha);
  assert.match(record.sourceSha, SHA);
  assert.equal(record.environment, environment);
  assert.match(record.artifactDigest, DIGEST);
  assert.match(record.configurationDigest, DIGEST);
  assert.match(String(record.workflowRunId), /^\d+$/);
  assert.equal(typeof record.deploymentId, "string");
  assert.ok(record.deploymentId.length > 0);
  assert.ok(
    record.previousDeploymentId === null ||
      typeof record.previousDeploymentId === "string",
  );
  assert.equal(record.status, "smoke-verified-not-user-accepted");
  return record;
}

/** Create or check the artifact manifest using the same deterministic algorithm. */
export function artifact(mode, env = process.env) {
  assert.match(env.CI_SOURCE_SHA ?? "", SHA);
  assert.ok(["dev", "production"].includes(env.CI_ENVIRONMENT));
  if (mode === "prepare") {
    assert.equal(
      execFileSync("git", ["-C", "candidate", "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      env.CI_SOURCE_SHA,
    );
    assert.equal(
      execFileSync(
        "git",
        ["-C", "candidate", "status", "--porcelain", "--untracked-files=no"],
        { encoding: "utf8" },
      ).trim(),
      "",
      "Tracked source changed during checks",
    );
  }
  const current = {
    schemaVersion: 1,
    sourceSha: env.CI_SOURCE_SHA,
    environment: env.CI_ENVIRONMENT,
    artifactDigest: digest("candidate/dist"),
  };
  if (mode === "prepare")
    writeFileSync("candidate/ci-build.json", `${JSON.stringify(current)}\n`);
  else {
    assert.equal(mode, "verify");
    assert.deepEqual(
      JSON.parse(readFileSync("candidate/ci-build.json", "utf8")),
      current,
    );
  }
  return current;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  artifact(process.argv[2]);
