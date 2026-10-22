/** Upload only Build Output API files through Vercel's file/deployment APIs, with no CLI or mutation retries. @file */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";

/** Capture bounded regular files under the generated output root, including hidden function configuration. */
export function outputFiles(root) {
  const files = [];
  let total = 0;
  /** Reject links and unexpected nodes before reading or uploading any bytes. */
  function walk(directory, prefix) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const info = lstatSync(path);
      assert.ok(!info.isSymbolicLink(), "Build output links are forbidden");
      if (info.isDirectory()) walk(path, `${prefix}${name}/`);
      else {
        assert.ok(info.isFile());
        total += info.size;
        assert.ok(
          info.size <= 100_000_000 &&
            total <= 500_000_000 &&
            files.length < 20_000,
          "Build output exceeds transport limits",
        );
        const bytes = readFileSync(path);
        files.push({
          file: `${prefix}${name}`,
          sha: createHash("sha1").update(bytes).digest("hex"),
          size: bytes.length,
          bytes,
        });
      }
    }
  }
  walk(join(root, ".vercel/output"), ".vercel/output/");
  assert.ok(files.some(({ file }) => file === ".vercel/output/config.json"));
  return files;
}

/** Submit one prebuilt deployment and poll reads only; retain its identity immediately after creation. */
export async function deployPrebuilt(
  root,
  env,
  settings,
  fetcher = fetch,
  created = () => {},
) {
  const files = outputFiles(root);
  const query = `?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`;
  const headers = { Authorization: `Bearer ${env.VERCEL_TOKEN}` };
  assert.match(env.VERCEL_ORG_ID ?? "", /^team_[a-zA-Z0-9]+$/);
  assert.match(settings.projectId, /^prj_[a-zA-Z0-9]+$/);
  assert.ok(env.VERCEL_TOKEN);
  for (const file of files) {
    const response = await fetcher(`https://api.vercel.com/v2/files${query}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: {
        ...headers,
        "Content-Type": "application/octet-stream",
        "Content-Length": String(file.size),
        "x-now-digest": file.sha,
        "x-now-size": String(file.size),
      },
      body: file.bytes,
    });
    assert.equal(
      response.status,
      200,
      "File upload failed; inspect before another attempt",
    );
    await response.arrayBuffer();
  }
  const response = await fetcher(
    `https://api.vercel.com/v13/deployments${query}`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: settings.name,
        project: settings.projectId,
        target: "production",
        version: 2,
        meta: settings.meta,
        files: files.map(({ file, sha, size }) => ({ file, sha, size })),
      }),
    },
  );
  assert.ok(
    response.ok,
    "Deployment creation failed; inspect provider state before another attempt",
  );
  let deployment = await response.json();
  assert.match(deployment.id, /^dpl_[a-zA-Z0-9]+$/);
  created(deployment);
  for (let attempt = 0; attempt < 90; attempt++) {
    assert.ok(
      !["ERROR", "CANCELED", "BLOCKED"].includes(deployment.readyState),
      "Provider stopped the deployment",
    );
    if (deployment.readyState === "READY" && deployment.aliasAssigned === true)
      return `https://${deployment.url}`;
    await setTimeout(2_000);
    const read = await fetcher(
      `https://api.vercel.com/v13/deployments/${deployment.id}${query}`,
      { headers, redirect: "error", signal: AbortSignal.timeout(30_000) },
    );
    assert.ok(read.ok, "Deployment read failed; inspect provider state");
    const current = await read.json();
    assert.equal(current.id, deployment.id);
    deployment = current;
  }
  throw new Error(
    "Provider readiness deadline exceeded; inspect before another attempt",
  );
}
