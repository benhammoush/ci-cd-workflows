/** Historical custom build commands never reach privileged Wrangler. @file */
import assert from "node:assert/strict";
import { test } from "node:test";
import { workerConfiguration } from "../scripts/worker-configuration.mjs";

const configuration = `compatibility_date = "2026-10-02"
[env.dev]
name = "worker-dev"
workers_dev = true
preview_urls = false
[env.dev.vars]
CORS_ORIGINS = "https://frontend.example"
[[env.dev.kv_namespaces]]
binding = "SNAPSHOTS"
id = "${"a".repeat(32)}"
`;
test("only declarative supported settings survive target selection", () => {
  const safe = workerConfiguration(configuration, "dev");
  assert.equal(safe.name, "worker-dev");
  assert.equal(safe.env, undefined);
  assert.equal(safe.build, undefined);
  assert.equal(safe.preview_urls, false);
});
test("global, target-nested and alternate-spacing custom build syntax fail closed", () => {
  for (const suffix of [
    '[build]\ncommand="malicious"',
    '[ build ]\ncommand="malicious"',
    '[env.dev.build]\ncommand="malicious"',
    '[ env.dev.build ]\ncommand="malicious"',
    '[env.dev.assets]\ndirectory="../../unverified"',
  ])
    assert.throws(() => workerConfiguration(configuration + suffix, "dev"));
});
