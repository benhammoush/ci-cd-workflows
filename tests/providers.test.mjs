/** Actual provider controllers exercised entirely with synthetic reads and intercepted commands. @file */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishWeb, publishWorker } from "../scripts/providers.mjs";

const sha = "a".repeat(40);
const hash = "b".repeat(64);
const baseEnv = {
  CI_SOURCE_SHA: sha,
  CI_ENVIRONMENT: "dev",
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF: "refs/heads/main",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_RUN_ID: "10",
  GITHUB_REPOSITORY: "owner/app",
  GH_TOKEN: "synthetic-github",
  VERCEL_TOKEN: "synthetic-vercel",
  VERCEL_ORG_ID: "team_test",
  VERCEL_PROJECT_ID: "prj_test",
  CLOUDFLARE_API_TOKEN: "synthetic-cloudflare",
  CLOUDFLARE_ACCOUNT_ID: "c".repeat(32),
  CI_CONTROL_ROOT: "/trusted/control",
  CI_AUTOMATION_ROOT: "/trusted/automation",
};

/** Keep test-generated records and output inside a disposable directory. */
async function fixture(run) {
  const previous = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "ci-cd-provider-"));
  try {
    process.chdir(directory);
    mkdirSync("dist");
    writeFileSync("dist/index.html", '<div id="root"></div>');
    writeFileSync(
      "ci-build.json",
      JSON.stringify({
        schemaVersion: 1,
        sourceSha: sha,
        environment: "dev",
        artifactDigest: hash,
      }),
    );
    await run();
  } finally {
    process.chdir(previous);
    rmSync(directory, { recursive: true, force: true });
  }
}

test("web adapter ignores deployment flags, rejects automatic production/stale/wrong targets and never retries uncertain mutations", async () => {
  for (const scenario of [
    "success",
    "dev-disabled",
    "production",
    "production-automatic",
    "stale",
    "wrong-project",
    "linked",
    "ambiguous",
    "smoke-failure",
    "configuration-drift",
  ])
    await fixture(async () => {
      const env = {
        ...baseEnv,
        ...(scenario === "dev-disabled" ? { DEPLOY_ENABLED: "false" } : {}),
        ...(scenario.startsWith("production")
          ? {
              CI_ENVIRONMENT: "production",
              DEPLOY_ENABLED: "false",
              GITHUB_EVENT_NAME:
                scenario === "production" ? "workflow_dispatch" : "push",
            }
          : {}),
      };
      const build = JSON.parse(readFileSync("ci-build.json", "utf8"));
      build.environment = env.CI_ENVIRONMENT;
      writeFileSync("ci-build.json", JSON.stringify(build));
      let mutations = 0;
      let reads = 0;
      let staging;
      mkdirSync(".vercel/output/functions/unverified.func", {
        recursive: true,
      });
      writeFileSync(
        ".vercel/output/functions/unverified.func/index.js",
        "unverified",
      );
      writeFileSync(".npmrc", "registry=https://attacker.invalid");
      const fetcher = async (input) => {
        const url = new URL(input);
        if (url.hostname === "api.github.com")
          return Response.json({
            commit: { sha: scenario === "stale" ? "d".repeat(40) : sha },
          });
        if (url.hostname === "api.vercel.com") {
          if (url.pathname.startsWith("/v9/projects/")) {
            reads++;
            return Response.json({
              id: scenario === "wrong-project" ? "prj_other" : "prj_test",
              name: "app-dev",
              accountId: "team_test",
              link: scenario === "linked" ? {} : null,
              nodeVersion:
                scenario === "configuration-drift" && reads > 1
                  ? "22.x"
                  : "24.x",
              targets: {
                production: {
                  id: mutations ? "dpl_created" : "dpl_previous",
                },
              },
            });
          }
          if (url.pathname.startsWith("/v13/deployments/"))
            return Response.json({
              id: "dpl_created",
              projectId: "prj_test",
              readyState: "READY",
              meta: { sourceSha: sha, artifactDigest: hash },
            });
        }
        if (
          ["app-dev.vercel.app", "immutable.vercel.app"].includes(url.hostname)
        ) {
          if (scenario === "smoke-failure")
            return new Response("unavailable", { status: 503 });
          return url.pathname === "/delivery.json"
            ? Response.json(
                JSON.parse(
                  readFileSync(
                    join(staging, ".vercel/output/static/delivery.json"),
                    "utf8",
                  ),
                ),
              )
            : new Response('<div id="root"></div>');
        }
        throw new Error("Unexpected network access");
      };
      const execute = (root, values, settings) => {
        mutations++;
        assert.equal(values.VERCEL_TOKEN, baseEnv.VERCEL_TOKEN);
        assert.equal(settings.meta.sourceSha, sha);
        staging = root;
        assert.notEqual(staging, process.cwd());
        assert.equal(existsSync(join(staging, ".npmrc")), false);
        assert.equal(
          existsSync(join(staging, ".vercel/output/functions/unverified.func")),
          false,
        );
        assert.equal(
          readFileSync(
            join(staging, ".vercel/output/static/index.html"),
            "utf8",
          ),
          '<div id="root"></div>',
        );
        if (scenario === "ambiguous") throw new Error("Lost response");
        return "https://immutable.vercel.app";
      };
      const run = () =>
        publishWeb(
          env,
          {
            name: "app-dev",
            origin: "https://app-dev.vercel.app",
            buildEnvironment: {},
            hosting: { version: 3 },
          },
          fetcher,
          execute,
        );
      if (["success", "dev-disabled", "production"].includes(scenario)) {
        const record = await run();
        assert.equal(record.previousDeploymentId, "dpl_previous");
        assert.equal(record.status, "smoke-verified-not-user-accepted");
        assert.equal(mutations, 1);
        assert.equal(existsSync(staging), false);
      } else {
        await assert.rejects(run);
        assert.equal(
          mutations,
          ["ambiguous", "smoke-failure"].includes(scenario) ? 1 : 0,
        );
        if (mutations)
          assert.equal(
            JSON.parse(readFileSync("delivery-record.json", "utf8")).status,
            scenario === "ambiguous"
              ? "mutation-requested"
              : "verification-pending",
          );
      }
    });
});

test("Worker adapter deploys prebundled bytes once and binds active provider version to exact source/artifact", async () => {
  for (const scenario of [
    "success",
    "dev-disabled",
    "production",
    "production-automatic",
    "stale",
    "split",
    "wrong-tag",
    "ambiguous",
    "smoke-failure",
  ])
    await fixture(async () => {
      let mutations = 0;
      const env = {
        ...baseEnv,
        ...(scenario === "dev-disabled" ? { DEPLOY_ENABLED: "false" } : {}),
        ...(scenario.startsWith("production")
          ? {
              CI_ENVIRONMENT: "production",
              DEPLOY_ENABLED: "false",
              GITHUB_EVENT_NAME:
                scenario === "production" ? "workflow_dispatch" : "push",
            }
          : {}),
      };
      const build = JSON.parse(readFileSync("ci-build.json", "utf8"));
      build.environment = env.CI_ENVIRONMENT;
      writeFileSync("ci-build.json", JSON.stringify(build));
      const fetcher = async (input) => {
        const url = new URL(input);
        if (url.hostname === "api.github.com")
          return Response.json({
            commit: { sha: scenario === "stale" ? "d".repeat(40) : sha },
          });
        assert.equal(url.hostname, "api.cloudflare.com");
        if (url.pathname.endsWith("/deployments"))
          return Response.json({
            success: true,
            result: {
              deployments: [
                {
                  id: mutations ? "deployment-created" : "deployment-prior",
                  versions: [
                    {
                      version_id: mutations
                        ? "version-created"
                        : "version-prior",
                      percentage: scenario === "split" ? 50 : 100,
                    },
                  ],
                },
              ],
            },
          });
        if (url.pathname.endsWith("/versions/version-created"))
          return Response.json({
            success: true,
            result: {
              annotations: {
                "workers/tag": scenario === "wrong-tag" ? "other" : sha,
                "workers/message": `ci-cd:10:${hash}`,
              },
            },
          });
        throw new Error("Unexpected network access");
      };
      const execute = (command, args) => {
        mutations++;
        assert.equal(command, process.execPath);
        assert.ok(args.includes("--no-bundle"));
        assert.ok(args.includes("--tag"));
        if (scenario === "ambiguous") throw new Error("Lost response");
        return "";
      };
      const run = () =>
        publishWorker(
          env,
          {
            name: "app-dev",
            entry: "dist/index.js",
            config: "wrangler.toml",
            configuration: {},
            smoke: async () => {
              if (scenario === "smoke-failure")
                throw new Error("Health failed");
            },
          },
          fetcher,
          execute,
        );
      if (["success", "dev-disabled", "production"].includes(scenario)) {
        const record = await run();
        assert.equal(record.deploymentId, "version-created");
        assert.equal(record.previousDeploymentId, "version-prior");
        assert.equal(mutations, 1);
      } else {
        await assert.rejects(run);
        assert.equal(
          mutations,
          ["wrong-tag", "ambiguous", "smoke-failure"].includes(scenario)
            ? 1
            : 0,
        );
        if (mutations)
          assert.notEqual(
            JSON.parse(readFileSync("delivery-record.json", "utf8")).status,
            "smoke-verified-not-user-accepted",
          );
      }
    });
});

test("first production Worker accepts only confirmed absence and rejects preflight drift or uncertain mutations", async () => {
  for (const scenario of [
    "production-missing",
    "omitted-result",
    "production-empty",
    "dev-missing",
    "forbidden",
    "server-error",
    "unknown-missing",
    "mixed-errors",
    "missing-errors",
    "malformed",
    "malformed-success",
    "wrong-success",
    "nonempty-result",
    "string-code",
    "appeared",
    "disappeared",
    "ambiguous",
    "missing-after-mutation",
  ]) {
    await fixture(async () => {
      const env = {
        ...baseEnv,
        CI_ENVIRONMENT: scenario === "dev-missing" ? "dev" : "production",
        GITHUB_EVENT_NAME: "workflow_dispatch",
      };
      const build = JSON.parse(readFileSync("ci-build.json", "utf8"));
      build.environment = env.CI_ENVIRONMENT;
      writeFileSync("ci-build.json", JSON.stringify(build));
      let mutations = 0;
      let deploymentReads = 0;
      let smokeChecks = 0;
      const fetcher = async (input) => {
        const url = new URL(input);
        assert.equal(url.hostname, "api.cloudflare.com");
        assert.ok(
          url.pathname.startsWith(
            `/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/app-production/`,
          ),
        );
        if (url.pathname.endsWith("/versions/version-created")) {
          return Response.json({
            success: true,
            result: {
              annotations: {
                "workers/tag": sha,
                "workers/message": `ci-cd:10:${hash}`,
              },
            },
          });
        }
        assert.ok(url.pathname.endsWith("/deployments"));
        deploymentReads++;
        if (mutations && scenario !== "missing-after-mutation") {
          return Response.json({
            success: true,
            result: {
              deployments: [
                {
                  id: "deployment-created",
                  versions: [
                    { version_id: "version-created", percentage: 100 },
                  ],
                },
              ],
            },
          });
        }
        const empty =
          scenario === "production-empty" ||
          (scenario === "appeared" && deploymentReads === 2) ||
          (scenario === "disappeared" && deploymentReads === 1);
        if (empty)
          return Response.json({ success: true, result: { deployments: [] } });
        if (["malformed", "malformed-success"].includes(scenario))
          return new Response("private-invalid-body", {
            status: scenario === "malformed" ? 404 : 200,
          });
        return Response.json(
          {
            success: scenario === "wrong-success",
            ...(scenario === "omitted-result"
              ? {}
              : { result: scenario === "nonempty-result" ? {} : null }),
            errors:
              scenario === "missing-errors"
                ? []
                : [
                    {
                      code:
                        scenario === "unknown-missing"
                          ? 10000
                          : scenario === "string-code"
                            ? "10007"
                            : 10007,
                      message: "private-provider-message",
                    },
                    ...(scenario === "mixed-errors" ? [{ code: 10000 }] : []),
                  ],
          },
          {
            status:
              scenario === "forbidden"
                ? 403
                : scenario === "server-error"
                  ? 500
                  : 404,
          },
        );
      };
      const execute = () => {
        mutations++;
        const record = JSON.parse(readFileSync("delivery-record.json", "utf8"));
        assert.equal(record.status, "mutation-requested");
        assert.equal(record.previousDeploymentId, null);
        assert.equal(record.previousProviderDeploymentId, null);
        if (scenario === "ambiguous") throw new Error("Lost response");
      };
      const run = () =>
        publishWorker(
          env,
          {
            name: "app-production",
            entry: "dist/index.js",
            config: "wrangler.toml",
            configuration: {},
            smoke: async () => {
              smokeChecks++;
            },
          },
          fetcher,
          execute,
        );
      if (
        ["production-missing", "omitted-result", "production-empty"].includes(
          scenario,
        )
      ) {
        const record = await run();
        assert.equal(record.status, "smoke-verified-not-user-accepted");
        assert.equal(record.deploymentId, "version-created");
        assert.equal(record.previousDeploymentId, null);
        assert.equal(mutations, 1);
        assert.equal(smokeChecks, 1);
      } else {
        await assert.rejects(run, (error) => {
          assert.ok(!error.message.includes("private-"));
          return true;
        });
        const mutated = ["ambiguous", "missing-after-mutation"].includes(
          scenario,
        );
        assert.equal(mutations, mutated ? 1 : 0);
        assert.equal(smokeChecks, 0);
        assert.equal(existsSync("delivery-record.json"), mutated);
        if (mutated)
          assert.equal(
            JSON.parse(readFileSync("delivery-record.json", "utf8")).status,
            "mutation-requested",
          );
      }
    });
  }
});
