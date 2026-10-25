/** Find successful same-repository dev delivery with retained, source-matching evidence. @file */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { deliveryRecord } from "./artifact.mjs";
import { SHA } from "./contract.mjs";

/** Read authenticated GitHub metadata without forwarding credentials to redirects. */
async function github(path, env) {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPOSITORY}${path}`,
    {
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  assert.ok(response.ok, "GitHub evidence read failed");
  return response.json();
}

/** Download one named evidence artifact with the runner's GitHub CLI, then clean it up. */
function download(run, env) {
  const directory = mkdtempSync(join(tmpdir(), "ci-cd-evidence-"));
  try {
    execFileSync(
      "gh",
      [
        "run",
        "download",
        String(run.id),
        "--repo",
        env.GITHUB_REPOSITORY,
        "--name",
        "delivery-record-dev",
        "--dir",
        directory,
      ],
      { env, stdio: "pipe", timeout: 60_000 },
    );
    return JSON.parse(
      readFileSync(join(directory, "delivery-record.json"), "utf8"),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Require an unexpired record from successful trusted-main CI, never PR CI or green tests alone. */
export async function devEvidence(
  env = process.env,
  read = github,
  readRecord = download,
) {
  assert.match(env.CI_SOURCE_SHA ?? "", SHA);
  assert.match(env.GITHUB_REPOSITORY ?? "", /^[\w.-]+\/[\w.-]+$/);
  assert.ok(env.GH_TOKEN);
  for (let page = 1; page <= 5; page++) {
    const { workflow_runs: runs } = await read(
      `/actions/runs?branch=main&status=success&per_page=100&page=${page}`,
      env,
    );
    for (const run of runs) {
      if (
        run.conclusion !== "success" ||
        run.head_branch !== "main" ||
        ![
          ".github/workflows/verify-and-deploy-dev.yml",
          ".github/workflows/ci.yml",
        ].includes(run.path) ||
        !["push", "workflow_dispatch"].includes(run.event) ||
        run.head_repository?.full_name?.toLowerCase() !==
          env.GITHUB_REPOSITORY.toLowerCase()
      )
        continue;
      const { artifacts } = await read(
        `/actions/runs/${run.id}/artifacts?per_page=100`,
        env,
      );
      if (
        !artifacts.some(
          (entry) => entry.name === "delivery-record-dev" && !entry.expired,
        )
      )
        continue;
      const record = await readRecord(run, env);
      if (record.sourceSha !== env.CI_SOURCE_SHA) continue;
      deliveryRecord(record, env.CI_SOURCE_SHA, "dev");
      assert.equal(String(record.workflowRunId), String(run.id));
      if (env.GITHUB_STEP_SUMMARY)
        appendFileSync(
          env.GITHUB_STEP_SUMMARY,
          `\nDev delivery evidence: ${run.html_url}\nSource: ${record.sourceSha}\nDeployment: ${record.deploymentId}\nOwner acceptance/configuration/recovery review is still required before approval.\n`,
        );
      return record;
    }
    if (runs.length < 100) break;
  }
  throw new Error(
    "No retained successful dev delivery for the selected SHA; revalidate in dev, never substitute another SHA",
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  await devEvidence();
