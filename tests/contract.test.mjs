/** Positive and deliberately broken fixtures for the shared, versioned release contract. @file */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { consumer, configuration, workflow } from "../scripts/contract.mjs";
import { digest, artifact, deliveryRecord } from "../scripts/artifact.mjs";
import { devEvidence } from "../scripts/dev-evidence.mjs";
import { releaseContext } from "../scripts/source.mjs";
import { target } from "../scripts/providers.mjs";

const sha = "a".repeat(40);
const hash = "b".repeat(64);
const config = {
  schemaVersion: 1,
  profile: "web",
  nodeVersion: "24",
  automationSha: sha,
  integration: false,
  legacyChecks: [],
  deploymentVariables: ["DEPLOY_ENABLED"],
  buildEnvironment: { dev: {}, production: {} },
};
const env = {
  CI_SOURCE_SHA: sha,
  CI_ENVIRONMENT: "production",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_REPOSITORY: "owner/application",
  GH_TOKEN: "synthetic",
  GITHUB_WORKFLOW_REF:
    "owner/application/.github/workflows/deploy-production.yml@refs/heads/main",
};
const record = {
  schemaVersion: 1,
  sourceSha: sha,
  environment: "dev",
  artifactDigest: hash,
  configurationDigest: hash,
  workflowRunId: "10",
  deploymentId: "immutable-provider-version",
  previousDeploymentId: null,
  status: "smoke-verified-not-user-accepted",
};

/** Create disposable rendered caller templates without touching an application repository. */
function fixture(profile, run) {
  const root = mkdtempSync(join(tmpdir(), "ci-cd-contract-"));
  try {
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(
      join(root, ".github/ci-cd.json"),
      JSON.stringify({ ...config, profile }),
    );
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          "ci:quality": "node checks.mjs",
          "ci:browser": "playwright test",
        },
      }),
    );
    for (const name of ["ci.yml", "deploy-production.yml"]) {
      const text = readFileSync(
        new URL(`../templates/${profile}/${name}`, import.meta.url),
        "utf8",
      )
        .replaceAll("__AUTOMATION_SHA__", sha)
        .replaceAll("__NODE_VERSION__", "24");
      writeFileSync(join(root, ".github/workflows", name), text);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("web and Worker starter templates conform to the same release and naming contract", () => {
  for (const profile of ["web", "worker"])
    fixture(profile, (root) => assert.equal(consumer(root).profile, profile));
});

test("consumer checks reject floating references, wrong targets, missing dependencies and missing main checks", () => {
  for (const mutate of [
    (value) => {
      value.jobs.verify.uses = value.jobs.verify.uses.replace(sha, "main");
    },
    (value) => {
      value.jobs.deploy_dev.with.environment = "prod";
    },
    (value) => {
      value.jobs.deploy_dev.needs = [];
    },
    (value) => {
      value.on.push.branches = ["feature"];
    },
    (value) => {
      value.jobs.deploy_dev.if = "always()";
    },
    (value) => {
      value.jobs.verify.with.automation_sha = "c".repeat(40);
    },
    (value) => {
      value.jobs.deploy_dev.secrets = "inherit";
    },
  ])
    fixture("web", (root) => {
      const path = join(root, ".github/workflows/ci.yml");
      const value = parse(readFileSync(path, "utf8"));
      mutate(value);
      writeFileSync(path, stringify(value));
      assert.throws(() => consumer(root));
    });
});

test("production cannot acquire an automatic trigger or bypass verification", () => {
  for (const mutate of [
    (value) => {
      value.on.push = { branches: ["main"] };
    },
    (value) => {
      value.on.workflow_dispatch.inputs.sha.required = false;
    },
    (value) => {
      value.jobs.deploy_production.needs = [];
    },
    (value) => {
      value.jobs.verify_release.with.environment = "dev";
    },
  ])
    fixture("worker", (root) => {
      const path = join(root, ".github/workflows/deploy-production.yml");
      const value = parse(readFileSync(path, "utf8"));
      mutate(value);
      writeFileSync(path, stringify(value));
      assert.throws(() => consumer(root));
    });
});

test("public configuration rejects executable environment overrides, secrets and unknown schema fields", () => {
  assert.doesNotThrow(() => configuration(config));
  for (const name of [
    "NODE_OPTIONS",
    "GH_TOKEN",
    "CI_SOURCE_SHA",
    "PATH",
    "VERCEL_TOKEN",
  ])
    assert.throws(() =>
      configuration({ ...config, deploymentVariables: [name] }),
    );
  assert.throws(() => configuration({ ...config, profile: "universal" }));
  assert.throws(() =>
    configuration({ ...config, arbitraryCommand: "deploy everything" }),
  );
  assert.throws(() =>
    configuration({
      ...config,
      buildEnvironment: { dev: { VITE_API: "x\ny" }, production: {} },
    }),
  );
});

test("all reusable job runners are Ubuntu 24.04; actions are immutable; verification never receives provider secrets", () => {
  for (const name of readdirSync(".github/workflows")) {
    const value = workflow(readFileSync(`.github/workflows/${name}`, "utf8"));
    for (const job of Object.values(value.jobs))
      if (job.concurrency)
        assert.equal(job.concurrency["cancel-in-progress"], false);
  }
  const verify = readFileSync(".github/workflows/verify.yml", "utf8");
  assert.ok(!/secrets\./.test(verify));
  const deploy = workflow(readFileSync(".github/workflows/deploy.yml", "utf8"))
    .jobs.deploy;
  assert.equal(deploy.environment, "${{ inputs.environment }}");
  assert.ok(
    deploy.steps.some(
      (step) => step.run === "node _automation/scripts/artifact.mjs verify",
    ),
  );
  assert.ok(
    deploy.steps.some(
      (step) =>
        step.run === "node _automation/scripts/dev-evidence.mjs" &&
        step.if === "inputs.environment == 'production'",
    ),
  );
  assert.throws(() =>
    workflow("jobs:\n  unsafe:\n    runs-on: ubuntu-latest\n"),
  );
  assert.throws(() => workflow("jobs:\n  a: {}\n  a: {}\n"));
  assert.throws(() => workflow("jobs:\n  BadName: {}\n"));
});

test("release contexts reject PR production, non-main dispatch, SHA aliases and production reruns", () => {
  releaseContext(env);
  for (const patch of [
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_REF: "refs/heads/feature" },
    { CI_SOURCE_SHA: "main" },
    { CI_ENVIRONMENT: "prod" },
    { GITHUB_RUN_ATTEMPT: "2" },
    {
      GITHUB_WORKFLOW_REF: "owner/app/.github/workflows/ci.yml@refs/heads/main",
    },
  ])
    assert.throws(() => releaseContext({ ...env, ...patch }));
});

test("both pre-checkout and pre-mutation guards reject every malformed production attempt", () => {
  for (const attempt of ["2", "", "0", "01", "invalid"]) {
    const values = {
      ...env,
      DEPLOY_ENABLED: "true",
      GITHUB_RUN_ATTEMPT: attempt,
    };
    assert.throws(() => releaseContext(values));
    assert.throws(() => target(values));
  }
  releaseContext({ ...env, CI_ENVIRONMENT: "dev", GITHUB_RUN_ATTEMPT: "2" });
  target({
    ...env,
    DEPLOY_ENABLED: "true",
    CI_ENVIRONMENT: "dev",
    GITHUB_RUN_ATTEMPT: "2",
  });
  for (const environment of [
    "staging",
    "local",
    "",
    "Production",
    "dev; exit 0",
  ])
    assert.throws(() =>
      releaseContext({ ...env, CI_ENVIRONMENT: environment }),
    );
  for (const value of [
    "",
    "main",
    "a".repeat(39),
    "a".repeat(41),
    "G".repeat(40),
  ])
    assert.throws(() => releaseContext({ ...env, CI_SOURCE_SHA: value }));
});

test("shared verification gates candidate execution and retains failure diagnostics", () => {
  const value = workflow(readFileSync(".github/workflows/verify.yml", "utf8"));
  const steps = value.jobs.verify.steps;
  const guard = steps.findIndex(
    (step) => step.run === "node _automation/scripts/source.mjs",
  );
  const candidate = steps.findIndex((step) => step.with?.path === "candidate");
  const install = steps.findIndex(
    (step) =>
      step.run === "npm ci" && step["working-directory"] === "candidate",
  );
  assert.ok(guard >= 0 && guard < candidate && candidate < install);
  const productionEvidence = steps.findIndex(
    (step) => step.run === "node _automation/scripts/dev-evidence.mjs",
  );
  assert.ok(productionEvidence > guard && productionEvidence < candidate);
  const artifact = steps.find((step) => step.with?.name?.startsWith("build-"));
  assert.equal(artifact.with["include-hidden-files"], true);
  const diagnostics = steps.find(
    (step) =>
      step.if === "failure()" &&
      step.with?.name?.startsWith("browser-diagnostics-"),
  );
  assert.equal(diagnostics.with["retention-days"], 7);
});

test("build fingerprint detects byte/name changes and rejects links and empty builds", () => {
  const root = mkdtempSync(join(tmpdir(), "ci-cd-artifact-"));
  try {
    assert.throws(() => digest(root));
    writeFileSync(join(root, "index.html"), "tested");
    const before = digest(root);
    writeFileSync(join(root, "index.html"), "tampered");
    assert.notEqual(digest(root), before);
    symlinkSync(join(root, "index.html"), join(root, "link"));
    assert.throws(() => digest(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dev evidence requires trusted successful CI, a retained artifact and exact source/deployment identity", async () => {
  const run = {
    id: 10,
    conclusion: "success",
    event: "push",
    head_branch: "main",
    head_repository: { full_name: env.GITHUB_REPOSITORY },
    html_url: "https://github.com/owner/application/actions/runs/10",
  };
  for (const scenario of [
    "success",
    "pr",
    "failed",
    "fork",
    "expired",
    "wrong-sha",
    "wrong-run",
    "failed-smoke",
  ]) {
    const current = structuredClone(run);
    const evidence = structuredClone(record);
    if (scenario === "pr") current.event = "pull_request";
    if (scenario === "failed") current.conclusion = "failure";
    if (scenario === "fork")
      current.head_repository.full_name = "attacker/application";
    if (scenario === "wrong-sha") evidence.sourceSha = "c".repeat(40);
    if (scenario === "wrong-run") evidence.workflowRunId = "11";
    if (scenario === "failed-smoke") evidence.status = "mutation-requested";
    const read = async (path) =>
      path.includes("/artifacts?")
        ? {
            artifacts: [
              { name: "delivery-record-dev", expired: scenario === "expired" },
            ],
          }
        : { workflow_runs: [current] };
    const result = () => devEvidence(env, read, async () => evidence);
    if (scenario === "success") assert.deepEqual(await result(), record);
    else await assert.rejects(result);
  }
});

test("delivery records reject missing digests, wrong environments and fabricated success", () => {
  deliveryRecord(record, sha, "dev");
  for (const patch of [
    { artifactDigest: "" },
    { configurationDigest: "" },
    { deploymentId: "" },
    { environment: "production" },
    { status: "accepted" },
    { previousDeploymentId: undefined },
  ])
    assert.throws(() => deliveryRecord({ ...record, ...patch }, sha, "dev"));
});
