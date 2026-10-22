/** Real prebuilt transport exercised with synthetic HTTP and no deployment credentials. @file */
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployPrebuilt } from "../scripts/vercel-transport.mjs";

test("prebuilt transport sends only generated output, includes hidden function config and never retries mutation failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "ci-cd-transport-"));
  try {
    mkdirSync(join(root, ".vercel/output/static"), { recursive: true });
    mkdirSync(join(root, ".vercel/output/functions/api/demo/status.func"), {
      recursive: true,
    });
    writeFileSync(join(root, ".vercel/output/config.json"), '{"version":3}');
    writeFileSync(join(root, ".vercel/output/static/index.html"), "tested");
    writeFileSync(
      join(
        root,
        ".vercel/output/functions/api/demo/status.func/.vc-config.json",
      ),
      '{"runtime":"nodejs24.x"}',
    );
    writeFileSync(join(root, ".npmrc"), "registry=https://attacker.invalid");
    writeFileSync(join(root, "secret.txt"), "must-never-upload");
    for (const scenario of [
      "success",
      "upload-failure",
      "ambiguous",
      "failed-deployment",
      "delayed-alias",
      "poll-failure",
      "wrong-poll-id",
    ]) {
      let uploads = 0;
      let mutations = 0;
      let retained;
      const fetcher = async (input, options) => {
        const url = new URL(input);
        assert.equal(url.origin, "https://api.vercel.com");
        assert.equal(options.redirect, "error");
        assert.equal(options.headers.Authorization, "Bearer synthetic");
        if (options.method !== "POST") {
          assert.equal(retained, "dpl_created");
          assert.equal(url.pathname, "/v13/deployments/dpl_created");
          if (scenario === "poll-failure")
            return new Response("", { status: 503 });
          return Response.json({
            id: scenario === "wrong-poll-id" ? "dpl_wrong" : "dpl_created",
            url: "immutable.vercel.app",
            readyState: "READY",
            aliasAssigned: true,
          });
        }
        if (url.pathname === "/v2/files") {
          uploads++;
          assert.match(options.headers["x-now-digest"], /^[a-f0-9]{40}$/);
          assert.equal(
            options.headers["x-now-size"],
            String(options.body.length),
          );
          if (scenario === "upload-failure")
            return new Response("", { status: 503 });
          assert.ok(!options.body.toString().includes("must-never-upload"));
          return new Response("", { status: 200 });
        }
        assert.equal(url.pathname, "/v13/deployments");
        mutations++;
        const body = JSON.parse(options.body);
        assert.equal(body.target, "production");
        assert.equal(body.project, "prj_test");
        assert.equal(body.files.length, 3);
        assert.ok(
          body.files.every(({ file }) => file.startsWith(".vercel/output/")),
        );
        assert.ok(
          body.files.some(({ file }) => file.endsWith("/.vc-config.json")),
        );
        assert.ok(!Object.hasOwn(body, "gitSource"));
        assert.ok(!Object.hasOwn(body, "buildCommand"));
        if (scenario === "ambiguous") throw new Error("Lost response");
        return Response.json({
          id: "dpl_created",
          url: "immutable.vercel.app",
          readyState: scenario === "failed-deployment" ? "ERROR" : "READY",
          aliasAssigned: ![
            "delayed-alias",
            "poll-failure",
            "wrong-poll-id",
          ].includes(scenario),
        });
      };
      const run = () =>
        deployPrebuilt(
          root,
          { VERCEL_ORG_ID: "team_test", VERCEL_TOKEN: "synthetic" },
          {
            name: "app",
            projectId: "prj_test",
            meta: { sourceSha: "a".repeat(40) },
          },
          fetcher,
          (deployment) => {
            retained = deployment.id;
          },
        );
      if (["success", "delayed-alias"].includes(scenario)) {
        assert.equal(await run(), "https://immutable.vercel.app");
        assert.equal(retained, "dpl_created");
      } else {
        await assert.rejects(run);
        if (scenario === "failed-deployment")
          assert.equal(retained, "dpl_created");
      }
      assert.equal(mutations, scenario === "upload-failure" ? 0 : 1);
      assert.equal(uploads, scenario === "upload-failure" ? 1 : 3);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
