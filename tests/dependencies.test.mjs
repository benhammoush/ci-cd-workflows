/** Guard the patched glob matcher used by development lint tooling. @file */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("lint tooling resolves patched minimatch until upstream ranges support v11", () => {
  // GHSA-g3hv-75wg-m249 affects v10; keep the override until upstream adopts v11.
  const { overrides } = JSON.parse(readFileSync("package.json", "utf8"));
  const { packages } = JSON.parse(readFileSync("package-lock.json", "utf8"));
  assert.equal(overrides.minimatch, "11.0.4");
  const matches = Object.entries(packages).filter(([path]) =>
    path.endsWith("node_modules/minimatch"),
  );
  assert.ok(matches.length > 0);
  for (const [path, entry] of matches) {
    assert.equal(entry.version, overrides.minimatch, path);
  }
});
