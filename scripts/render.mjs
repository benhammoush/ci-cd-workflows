/** Render versioned callers without altering application source or provider resources. @file */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  for (const name of ["ci.yml", "deploy-production.yml"]) {
    const text = readFileSync(
      new URL(`../templates/${config.profile}/${name}`, import.meta.url),
      "utf8",
    )
      .replaceAll("__AUTOMATION_SHA__", config.automationSha)
      .replaceAll("__NODE_VERSION__", config.nodeVersion);
    const value = parse(text);
    if (name === "ci.yml") {
      for (const [index, display] of config.legacyChecks.entries())
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
      if (config.manualRefresh)
        value.on.workflow_dispatch.inputs.refresh_dev = {
          description: "Explicitly refresh shared dev data after delivery",
          type: "boolean",
          default: false,
        };
    }
    if (config.lockScope)
      value.jobs[
        name === "ci.yml" ? "deploy_dev" : "deploy_production"
      ].with.lock_scope = config.lockScope;
    const header =
      name === "ci.yml"
        ? "# Verifies PRs and exact main revisions; successful main checks deliver to dev.\n# Calls the shared CI/CD workflows; production uses deploy-production.yml.\n"
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
