/** Validate versioned consumer configuration and workflow structure without running it. @file */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const SHA = /^[a-f0-9]{40}$/;
export const DIGEST = /^[a-f0-9]{64}$/;
export const REPOSITORY = "benhammoush/ci-cd-workflows";
export const RUNNER = "ubuntu-24.04";

/** Check the bounded public configuration contract; never accept command strings. */
export function configuration(value) {
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      "schemaVersion",
      "profile",
      "nodeVersion",
      "automationSha",
      "integration",
      "legacyChecks",
      "deploymentVariables",
      "buildEnvironment",
      ...(value.workerRepository ? ["workerRepository", "workerSha"] : []),
      ...(value.manualRefresh !== undefined ? ["manualRefresh"] : []),
      ...(value.lockScope !== undefined ? ["lockScope"] : []),
    ].sort(),
  );
  assert.equal(value.schemaVersion, 1);
  assert.ok(["web", "worker"].includes(value.profile));
  assert.ok(["22", "24", "24.21.0"].includes(value.nodeVersion));
  assert.match(value.automationSha, SHA);
  assert.equal(typeof value.integration, "boolean");
  if (value.manualRefresh !== undefined)
    assert.equal(value.manualRefresh, true);
  if (value.lockScope !== undefined) assert.equal(value.lockScope, "all");
  assert.ok(Array.isArray(value.legacyChecks));
  assert.ok(Array.isArray(value.deploymentVariables));
  const reserved = /^(?:GITHUB|GH_|CI_|NODE|NPM|PATH|HOME|RUNNER|ACTIONS)/;
  for (const name of value.deploymentVariables) {
    assert.match(name, /^[A-Z][A-Z0-9_]*$/);
    assert.ok(
      !reserved.test(name),
      "Deployment variables cannot override execution context",
    );
    assert.ok(!/TOKEN|SECRET|PASSWORD|PRIVATE_KEY/.test(name));
  }
  for (const target of ["dev", "production"]) {
    const variables = value.buildEnvironment[target];
    assert.ok(
      variables && typeof variables === "object" && !Array.isArray(variables),
    );
    for (const [name, entry] of Object.entries(variables)) {
      assert.match(name, /^VITE_[A-Z0-9_]+$/);
      assert.equal(typeof entry, "string");
      assert.ok(entry.length <= 4096 && !/[\r\n]/.test(entry));
    }
  }
  if (value.workerRepository) {
    assert.match(value.workerRepository, /^benhammoush\/[a-z0-9_-]+$/);
    assert.match(value.workerSha, SHA);
    assert.equal(value.integration, true);
  }
  return value;
}

/** Parse YAML 1.2 with duplicate-key/alias rejection and validate its job names. */
export function workflow(text) {
  const document = parse(text, { uniqueKeys: true, maxAliasCount: 0 });
  assert.ok(document && typeof document === "object");
  assert.ok(document.jobs && Object.keys(document.jobs).length);
  for (const [id, job] of Object.entries(document.jobs)) {
    assert.match(id, /^[a-z][a-z0-9_]*$/);
    if (job["runs-on"]) assert.equal(job["runs-on"], RUNNER);
    for (const step of job.steps ?? []) {
      if (step.id) assert.match(step.id, /^[a-z][a-z0-9_]*$/);
      if (step.uses && !step.uses.startsWith("./"))
        assert.match(step.uses, /@[a-f0-9]{40}$/);
    }
  }
  return document;
}

/** Verify exact reusable references and fixed release dependencies in a consumer. */
export function consumer(root) {
  const config = configuration(
    JSON.parse(readFileSync(join(root, ".github/ci-cd.json"), "utf8")),
  );
  const workflows = join(root, ".github/workflows");
  for (const name of readdirSync(workflows).filter((name) =>
    /\.ya?ml$/.test(name),
  )) {
    assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*\.yml$/);
    workflow(readFileSync(join(workflows, name), "utf8"));
  }
  const ci = workflow(readFileSync(join(workflows, "ci.yml"), "utf8"));
  const production = workflow(
    readFileSync(join(workflows, "deploy-production.yml"), "utf8"),
  );
  assert.equal(ci.name, "CI");
  assert.equal(production.name, "Deploy production");
  assert.deepEqual(ci.on.push.branches, ["main"]);
  assert.ok(Object.hasOwn(ci.on, "pull_request"));
  assert.deepEqual(Object.keys(production.on), ["workflow_dispatch"]);
  assert.equal(production.on.workflow_dispatch.inputs.sha.required, true);
  assert.equal(production.on.workflow_dispatch.inputs.sha.type, "string");
  const reference = (file) =>
    `${REPOSITORY}/.github/workflows/${file}-${config.profile}.yml@${config.automationSha}`;
  for (const [job, file, target] of [
    [ci.jobs.verify, "verify", "dev"],
    [ci.jobs.deploy_dev, "deploy", "dev"],
    [production.jobs.verify_release, "verify", "production"],
    [production.jobs.deploy_production, "deploy", "production"],
  ]) {
    assert.equal(job.uses, reference(file));
    assert.equal(job.with.automation_sha, config.automationSha);
    assert.equal(job.with.environment, target);
    assert.equal(job.with.node_version, config.nodeVersion);
    assert.notEqual(job.secrets, "inherit", "Pass only named provider secrets");
  }
  assert.equal(ci.jobs.deploy_dev.needs, "verify");
  assert.deepEqual(Object.keys(ci.on).sort(), [
    "pull_request",
    "push",
    "workflow_dispatch",
  ]);
  assert.equal(
    ci.jobs.deploy_dev.if,
    "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')",
  );
  assert.equal(production.jobs.deploy_production.needs, "verify_release");
  assert.equal(
    production.jobs.deploy_production.if,
    "github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'",
  );
  for (const name of config.legacyChecks) {
    assert.ok(
      Object.values(ci.jobs).some(
        (job) =>
          job.name === name && job.needs === "verify" && job.if === "always()",
      ),
    );
  }
  const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const name of [
    "ci:quality",
    ...(config.profile === "web" ? ["ci:browser"] : []),
    ...(config.integration ? ["ci:integration"] : []),
  ]) {
    assert.ok(metadata.scripts[name]?.trim(), `Missing ${name}`);
  }
  return config;
}
