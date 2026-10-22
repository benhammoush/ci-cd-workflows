/** Bounded provider adapters for prebuilt web output and prebundled Workers; never retry mutations. @file */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deliveryRecord } from "./artifact.mjs";
import { deployPrebuilt } from "./vercel-transport.mjs";

/** Fingerprint public configuration without retaining provider response bodies or credentials. */
export function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Reject target/source/rerun mistakes before any provider access. */
export function target(env) {
  assert.equal(env.DEPLOY_ENABLED, "true", "Deployment remains disabled");
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.match(env.CI_SOURCE_SHA ?? "", /^[a-f0-9]{40}$/);
  assert.ok(["dev", "production"].includes(env.CI_ENVIRONMENT));
  if (env.CI_ENVIRONMENT === "production") {
    assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
    assert.equal(env.GITHUB_RUN_ATTEMPT, "1");
  }
}

/** Read only fixed provider APIs; safe diagnostics never contain response bodies. */
export async function provider(origin, path, token, fetcher = fetch) {
  assert.ok(token, "Missing environment provider credential");
  const response = await fetcher(`${origin}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `Provider read failed (${response.status})`);
  const body = await response.json();
  if (origin.includes("cloudflare")) {
    assert.equal(body.success, true);
    return body.result;
  }
  return body;
}

/** Persist each mutation checkpoint before moving on; only completed smoke is promotable. */
export function checkpoint(record) {
  writeFileSync("delivery-record.json", `${JSON.stringify(record, null, 2)}\n`);
}

/** Bind a release record to the already-verified artifact and current target configuration. */
export function releaseRecord(env, configuration) {
  const build = JSON.parse(readFileSync("ci-build.json", "utf8"));
  assert.equal(build.sourceSha, env.CI_SOURCE_SHA);
  assert.equal(build.environment, env.CI_ENVIRONMENT);
  return {
    ...build,
    configurationDigest: fingerprint(configuration),
    workflowRunId: env.GITHUB_RUN_ID,
    deploymentId: null,
    previousDeploymentId: null,
    status: "preflight",
  };
}

/** Include deployment-relevant project settings and runtime-variable metadata, never secret values. */
export function webConfiguration(project, settings) {
  return {
    project: project.id,
    account: project.accountId,
    name: project.name,
    link: project.link ?? null,
    nodeVersion: project.nodeVersion,
    rootDirectory: project.rootDirectory,
    runtimeVariables: (project.env ?? []).map(
      ({ key, type, target, updatedAt }) => ({ key, type, target, updatedAt }),
    ),
    origin: settings.origin,
    buildEnvironment: settings.buildEnvironment,
  };
}

/** Reject a superseded automatic dev immediately before its external mutation. */
export async function freshness(env, fetcher = fetch) {
  if (env.GITHUB_EVENT_NAME !== "push") return;
  const main = await provider(
    "https://api.github.com",
    `/repos/${env.GITHUB_REPOSITORY}/branches/main`,
    env.GH_TOKEN,
    fetcher,
  );
  assert.equal(
    main.commit.sha,
    env.CI_SOURCE_SHA,
    "Automatic dev source was superseded",
  );
}

/** Deploy static files and optional precompiled Vercel functions without remote rebuilding. */
export async function publishWeb(
  env,
  settings,
  fetcher = fetch,
  publish = deployPrebuilt,
) {
  target(env);
  assert.match(env.VERCEL_ORG_ID ?? "", /^team_[a-zA-Z0-9]+$/);
  assert.match(env.VERCEL_PROJECT_ID ?? "", /^prj_[a-zA-Z0-9]+$/);
  const suffix = `?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`;
  const projectPath = `/v9/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}${suffix}`;
  const read = (path) =>
    provider("https://api.vercel.com", path, env.VERCEL_TOKEN, fetcher);
  const project = await read(projectPath);
  assert.equal(project.id, env.VERCEL_PROJECT_ID);
  assert.equal(project.accountId, env.VERCEL_ORG_ID);
  assert.equal(project.name, settings.name);
  assert.ok(!project.link, "Disconnect competing provider Git deployment");
  for (const variable of project.env ?? []) {
    if (variable.key?.startsWith("VITE_"))
      assert.ok(
        Object.hasOwn(settings.buildEnvironment, variable.key),
        "Undeclared provider-only public build input; review the target contract before delivery",
      );
  }
  const origin = new URL(settings.origin);
  assert.equal(origin.protocol, "https:");
  assert.equal(origin.origin, settings.origin);
  const record = releaseRecord(env, webConfiguration(project, settings));
  record.previousDeploymentId = project.targets?.production?.id ?? null;
  assert.ok(
    record.previousDeploymentId === null ||
      /^dpl_[a-zA-Z0-9]+$/.test(record.previousDeploymentId),
  );
  const identity = {
    sourceSha: record.sourceSha,
    environment: record.environment,
    artifactDigest: record.artifactDigest,
    configurationDigest: record.configurationDigest,
    workflowRunId: record.workflowRunId,
  };
  const staging = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), "ci-cd-web-"));
  try {
    const outputRoot = join(staging, ".vercel/output");
    mkdirSync(join(outputRoot, "static"), { recursive: true });
    cpSync("dist", join(outputRoot, "static"), {
      recursive: true,
      filter: (path) => !/(?:^|[\\/])_ci(?:[\\/]|$)/.test(path),
    });
    if (existsSync("dist/_ci/functions"))
      cpSync("dist/_ci/functions", join(outputRoot, "functions"), {
        recursive: true,
      });
    writeFileSync(
      join(outputRoot, "static/delivery.json"),
      JSON.stringify(identity),
    );
    writeFileSync(
      join(outputRoot, "config.json"),
      JSON.stringify(settings.hosting),
    );
    writeFileSync(
      join(staging, ".vercel/project.json"),
      JSON.stringify({
        orgId: env.VERCEL_ORG_ID,
        projectId: env.VERCEL_PROJECT_ID,
      }),
    );
    await freshness(env, fetcher);
    const before = await read(projectPath);
    assert.equal(
      before.targets?.production?.id ?? null,
      record.previousDeploymentId,
      "Target changed during preflight",
    );
    assert.equal(before.id, project.id);
    assert.ok(!before.link);
    assert.equal(
      fingerprint(webConfiguration(before, settings)),
      record.configurationDigest,
      "Project configuration drifted",
    );
    record.status = "mutation-requested";
    checkpoint(record);
    const output = await publish(
      staging,
      env,
      {
        name: settings.name,
        projectId: project.id,
        meta: {
          sourceSha: env.CI_SOURCE_SHA,
          artifactDigest: record.artifactDigest,
        },
      },
      fetcher,
      (deployment) => {
        record.deploymentId = deployment.id;
        record.status = "verification-pending";
        checkpoint(record);
      },
    );
    const immutable = new URL(output);
    assert.equal(immutable.protocol, "https:");
    assert.match(immutable.hostname, /^[a-z0-9-]+\.vercel\.app$/);
    const deployment = await read(
      `/v13/deployments/${encodeURIComponent(immutable.hostname)}${suffix}`,
    );
    assert.equal(deployment.projectId, project.id);
    assert.equal(deployment.readyState, "READY");
    assert.equal(deployment.meta?.sourceSha, env.CI_SOURCE_SHA);
    assert.equal(deployment.meta?.artifactDigest, record.artifactDigest);
    record.deploymentId = deployment.id;
    record.status = "verification-pending";
    checkpoint(record);
    for (const base of [immutable.origin, origin.origin]) {
      for (const path of ["/", "/delivery.json"]) {
        const response = await fetcher(`${base}${path}`, {
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
          headers: env.SMOKE_BYPASS
            ? { "x-vercel-protection-bypass": env.SMOKE_BYPASS }
            : {},
        });
        assert.equal(response.status, 200);
        if (path === "/delivery.json")
          assert.deepEqual(await response.json(), identity);
        else assert.ok((await response.text()).includes('<div id="root">'));
      }
    }
    if (settings.smoke) await settings.smoke(fetcher);
    const after = await read(projectPath);
    assert.equal(after.targets?.production?.id, deployment.id);
    assert.ok(!after.link);
    assert.equal(
      fingerprint(webConfiguration(after, settings)),
      record.configurationDigest,
      "Project configuration drifted during deployment",
    );
    record.status = "smoke-verified-not-user-accepted";
    checkpoint(record);
    deliveryRecord(record, env.CI_SOURCE_SHA, env.CI_ENVIRONMENT);
    return record;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Deploy one prepared Worker, retain previous version, then verify provider tag and application health. */
export async function publishWorker(
  env,
  settings,
  fetcher = fetch,
  execute = execFileSync,
) {
  target(env);
  assert.match(env.CLOUDFLARE_ACCOUNT_ID ?? "", /^[a-f0-9]{32}$/);
  assert.match(settings.name, /^[a-z0-9-]+$/);
  const base = `/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${settings.name}`;
  const read = (path) =>
    provider(
      "https://api.cloudflare.com",
      path,
      env.CLOUDFLARE_API_TOKEN,
      fetcher,
    );
  const before = await read(`${base}/deployments`);
  assert.ok(Array.isArray(before.deployments));
  const previous = before.deployments[0]?.versions;
  if (before.deployments.length)
    assert.ok(
      Array.isArray(previous) &&
        previous.length === 1 &&
        previous[0].percentage === 100,
      "Inspect split Worker versions before delivery",
    );
  else
    assert.equal(
      env.CI_ENVIRONMENT,
      "production",
      "Dev must be configured before normal delivery",
    );
  const record = releaseRecord(env, settings.configuration);
  record.previousDeploymentId = previous?.[0]?.version_id ?? null;
  record.previousProviderDeploymentId = before.deployments[0]?.id ?? null;
  await freshness(env, fetcher);
  const current = await read(`${base}/deployments`);
  assert.equal(
    current.deployments[0]?.id ?? null,
    record.previousProviderDeploymentId,
    "Worker changed during preflight",
  );
  record.status = "mutation-requested";
  checkpoint(record);
  execute(
    process.execPath,
    [
      resolve(env.CI_CONTROL_ROOT, "node_modules/wrangler/bin/wrangler.js"),
      "deploy",
      settings.entry,
      "--no-bundle",
      "--config",
      settings.config,
      ...(settings.environment ? ["--env", settings.environment] : []),
      "--tag",
      env.CI_SOURCE_SHA,
      "--message",
      `ci-cd:${env.GITHUB_RUN_ID}:${record.artifactDigest}`,
    ],
    {
      env,
      encoding: "utf8",
      timeout: 600_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const after = await read(`${base}/deployments`);
  const versions = after.deployments?.[0]?.versions;
  assert.ok(
    Array.isArray(versions) &&
      versions.length === 1 &&
      versions[0].percentage === 100,
  );
  const version = await read(`${base}/versions/${versions[0].version_id}`);
  assert.equal(version.annotations?.["workers/tag"], env.CI_SOURCE_SHA);
  assert.equal(
    version.annotations?.["workers/message"],
    `ci-cd:${env.GITHUB_RUN_ID}:${record.artifactDigest}`,
  );
  record.deploymentId = versions[0].version_id;
  record.providerDeploymentId = after.deployments[0].id;
  record.status = "verification-pending";
  checkpoint(record);
  await settings.smoke(fetcher);
  const final = await read(`${base}/deployments`);
  assert.equal(final.deployments[0].id, record.providerDeploymentId);
  record.status = "smoke-verified-not-user-accepted";
  checkpoint(record);
  deliveryRecord(record, env.CI_SOURCE_SHA, env.CI_ENVIRONMENT);
  return record;
}
