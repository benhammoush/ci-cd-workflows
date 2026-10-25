/** Render versioned callers without altering application source or provider resources. @file */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";
import { configuration } from "./contract.mjs";

/** Generate callers from the declared profile and preserve listed required checks. */
export function render(root, check = false) {
  const config = configuration(
    JSON.parse(readFileSync(join(root, ".github/ci-cd.json"), "utf8")),
  );
  const directory = join(root, ".github/workflows");
  mkdirSync(directory, { recursive: true });
  for (const name of ["ci.yml", "deploy-production.yml"])
    assert.ok(
      !existsSync(join(directory, name)),
      `Remove retired entry point before rendering: ${name}`,
    );
  for (const name of [
    "verify-pr.yml",
    "verify-and-deploy-dev.yml",
    "verify-and-deploy-prod.yml",
  ]) {
    const text = readFileSync(
      new URL(`../templates/${config.profile}/${name}`, import.meta.url),
      "utf8",
    )
      .replaceAll("__AUTOMATION_SHA__", config.automationSha)
      .replaceAll("__NODE_VERSION__", config.nodeVersion);
    const value = parse(text);
    if (name === "verify-pr.yml") {
      for (const [index, display] of config.legacyChecks.entries()) {
        if (display === "Verify") continue;
        value.jobs[`legacy_${index}`] = {
          name: display,
          needs: "verify",
          if: "always()",
          "runs-on": "ubuntu-24.04",
          steps: [
            {
              run: 'test "$VERIFY_RESULT" = success',
              env: { VERIFY_RESULT: "${{ needs.verify.result }}" },
            },
          ],
        };
      }
    }
    if (name === "verify-and-deploy-dev.yml" && config.manualRefresh)
      value.on.workflow_dispatch.inputs.refresh_dev = {
        description: "Explicitly refresh shared dev data after delivery",
        type: "boolean",
        default: false,
      };
    if (config.lockScope && name !== "verify-pr.yml")
      value.jobs[
        name === "verify-and-deploy-dev.yml"
          ? "deploy_dev"
          : "deploy_production"
      ].with.lock_scope = config.lockScope;
    const header =
      name === "verify-pr.yml"
        ? "# Verifies pull requests without deployment jobs or credentials.\n# The standalone Verify result preserves the existing required-check context.\n"
        : name === "verify-and-deploy-dev.yml"
          ? "# Verifies exact main revisions, then delivers the tested artifact to dev.\n"
          : "# Manually verifies and releases an exact dev-accepted source revision to production.\n# Calls shared CI/CD workflows with native environment approval.\n";
    const result = header + stringify(value, { lineWidth: 0 });
    const target = join(directory, name);
    if (check)
      assert.equal(
        readFileSync(target, "utf8"),
        result,
        `Template drift: ${name}`,
      );
    else writeFileSync(target, result);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  render(process.argv[2], process.argv[3] === "--check");
