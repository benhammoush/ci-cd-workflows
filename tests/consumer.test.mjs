/** Exercise the deployment dispatcher with a synthetic adapter and no provider access. @file */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { digest } from "../scripts/artifact.mjs";

const sha = "a".repeat(40);

test("both environments invoke the adapter regardless of obsolete deployment flags", () => {
  for (const environment of ["dev", "production"])
    for (const enabled of [undefined, "false", "true"])
      for (const name of ["DEPLOY_ENABLED", "DELIVERY_ENABLED"]) {
        const root = mkdtempSync(join(tmpdir(), "ci-cd-dispatch-"));
        try {
          mkdirSync(join(root, "control/.github"), { recursive: true });
          mkdirSync(join(root, "control/scripts"));
          mkdirSync(join(root, "candidate/dist"), { recursive: true });
          writeFileSync(join(root, "candidate/dist/index.html"), "verified");
          const build = {
            schemaVersion: 1,
            sourceSha: sha,
            environment,
            artifactDigest: digest(join(root, "candidate/dist")),
          };
          writeFileSync(
            join(root, "candidate/ci-build.json"),
            JSON.stringify(build),
          );
          writeFileSync(
            join(root, "control/.github/ci-cd.json"),
            JSON.stringify({
              schemaVersion: 1,
              profile: "web",
              nodeVersion: "24",
              automationSha: sha,
              integration: false,
              legacyChecks: [],
              deploymentVariables: [name],
              buildEnvironment: { dev: {}, production: {} },
            }),
          );
          const record = {
            ...build,
            configurationDigest: "b".repeat(64),
            workflowRunId: "10",
            deploymentId: "synthetic",
            previousDeploymentId: null,
            status: "smoke-verified-not-user-accepted",
          };
          writeFileSync(
            join(root, "control/scripts/ci-deploy.mjs"),
            `import { writeFileSync } from 'node:fs'; writeFileSync('delivery-record.json', ${JSON.stringify(JSON.stringify(record))});`,
          );
          const env = { ...process.env };
          delete env.DEPLOY_ENABLED;
          delete env.DELIVERY_ENABLED;
          execFileSync(
            process.execPath,
            [
              fileURLToPath(
                new URL("../scripts/consumer.mjs", import.meta.url),
              ),
              "deploy",
            ],
            {
              cwd: root,
              env: {
                ...env,
                CI_AUTOMATION_SHA: sha,
                CI_SOURCE_SHA: sha,
                CI_ENVIRONMENT: environment,
                CI_CONFIGURATION: JSON.stringify(
                  enabled === undefined ? {} : { [name]: enabled },
                ),
                GITHUB_STEP_SUMMARY: join(root, "summary.md"),
              },
              stdio: "pipe",
            },
          );
          assert.equal(
            existsSync(join(root, "candidate/delivery-record.json")),
            true,
          );
          assert.equal(existsSync(join(root, "summary.md")), false);
          assert.deepEqual(
            JSON.parse(
              readFileSync(
                join(root, "candidate/delivery-record.json"),
                "utf8",
              ),
            ),
            record,
          );
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
});
