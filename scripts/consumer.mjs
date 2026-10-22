/** Run fixed consumer operations; project commands never arrive as workflow input strings. @file */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { consumer, configuration } from "./contract.mjs";
import { artifact, deliveryRecord } from "./artifact.mjs";

const command = process.argv[2];
const config = configuration(
  JSON.parse(readFileSync("control/.github/ci-cd.json", "utf8")),
);
assert.equal(config.automationSha, process.env.CI_AUTOMATION_SHA);
if (command === "validate") consumer("control");
else if (command === "build-env") {
  for (const [name, value] of Object.entries(
    config.buildEnvironment[process.env.CI_ENVIRONMENT],
  ))
    appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
} else if (command === "deploy") {
  artifact("verify");
  const variables = JSON.parse(process.env.CI_CONFIGURATION);
  const env = { ...process.env };
  env.CI_AUTOMATION_ROOT = resolve("_automation");
  env.CI_CONTROL_ROOT = resolve("control");
  for (const name of config.deploymentVariables)
    if (variables[name] !== undefined) env[name] = variables[name];
  const enabled =
    env.DEPLOY_ENABLED ??
    (config.deploymentVariables.includes("DELIVERY_ENABLED")
      ? env.DELIVERY_ENABLED
      : undefined);
  if (enabled !== "true") {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      "\nDelivery remains disabled; no provider request or deployment occurred.\n",
    );
  } else {
    try {
      execFileSync(
        process.execPath,
        [resolve("control/scripts/ci-deploy.mjs")],
        {
          cwd: "candidate",
          env,
          // Provider subprocess diagnostics can contain credentials; retain only sanitized records.
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 900_000,
        },
      );
    } catch {
      throw new Error(
        "Delivery stopped. Inspect the retained checkpoint and provider state before a fresh authorized dispatch.",
      );
    }
    deliveryRecord(
      JSON.parse(readFileSync("candidate/delivery-record.json", "utf8")),
      env.CI_SOURCE_SHA,
      env.CI_ENVIRONMENT,
    );
  }
} else throw new Error("Unknown fixed consumer operation");
