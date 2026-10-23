/** Ubuntu mirror/timeout regressions; fixture roots never mutate this host. @file */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  aptNetworkPolicy,
  browserHost,
  ubuntuMirror,
} from "../scripts/browser-host.mjs";

/** Create the exact runner source layouts without needing sudo or network access. */
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "browser-host-"));
  try {
    for (const directory of ["etc/apt/sources.list.d", "etc/apt/apt.conf.d"])
      mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(
      join(root, "etc/os-release"),
      'ID=ubuntu\nVERSION_ID="24.04"\n',
    );
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("switches only the Azure Ubuntu archive and leaves signature/suite/security settings intact", () => {
  const original =
    "Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nURIs: http://security.ubuntu.com/ubuntu\n";
  const expected = original.replace(
    "http://azure.archive.ubuntu.com/ubuntu/",
    "https://archive.ubuntu.com/ubuntu/",
  );
  assert.equal(ubuntuMirror(original), expected);
  assert.equal(ubuntuMirror(expected), expected);
  assert.equal(
    ubuntuMirror("deb https://azure.archive.ubuntu.com/ubuntu noble main"),
    "deb https://archive.ubuntu.com/ubuntu noble main",
  );
  for (const source of [
    "http://azure.archive.ubuntu.com/ubuntu-evil",
    "http://other.example/ubuntu",
    "https://archive.ubuntu.com/ubuntu",
  ])
    assert.equal(ubuntuMirror(source), source);
});

test("handles both source formats idempotently and bounds APT's retries/timeouts", () =>
  fixture((root) => {
    for (const file of ["sources.list", "sources.list.d/ubuntu.sources"])
      writeFileSync(
        join(root, "etc/apt", file),
        "http://azure.archive.ubuntu.com/ubuntu noble main\n",
      );
    browserHost(root);
    browserHost(root);
    for (const file of ["sources.list", "sources.list.d/ubuntu.sources"])
      assert.equal(
        readFileSync(join(root, "etc/apt", file), "utf8"),
        "https://archive.ubuntu.com/ubuntu noble main\n",
      );
    assert.equal(
      readFileSync(join(root, "etc/apt/apt.conf.d/80-ci-cd-network"), "utf8"),
      aptNetworkPolicy,
    );
    assert.equal(
      aptNetworkPolicy,
      'Acquire::Retries "2";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n',
    );
  }));

test("rejects unsupported runner releases and missing package sources before configuration", () =>
  fixture((root) => {
    assert.throws(() => browserHost(root), /sources are missing/);
    writeFileSync(
      join(root, "etc/os-release"),
      'ID=debian\nVERSION_ID="24.04"\n',
    );
    assert.throws(() => browserHost(root));
    writeFileSync(
      join(root, "etc/os-release"),
      'ID=ubuntu\nVERSION_ID="22.04"\n',
    );
    assert.throws(() => browserHost(root));
  }));

test("web installation is bounded without weakening runner, job budget or engine coverage", () => {
  const workflow = parse(
    readFileSync(
      new URL("../.github/workflows/verify.yml", import.meta.url),
      "utf8",
    ),
  );
  const job = workflow.jobs.verify;
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job["timeout-minutes"], 40);
  const prepare = job.steps.find(
    (step) => step.name === "Prepare bounded browser dependency downloads",
  );
  const install = job.steps.find((step) =>
    step.run?.startsWith("npx --no-install playwright install"),
  );
  assert.equal(prepare.if, "inputs.profile == 'web'");
  assert.equal(prepare["timeout-minutes"], 2);
  assert.equal(install.if, prepare.if);
  assert.equal(install["timeout-minutes"], 10);
  assert.equal(
    install.run,
    "npx --no-install playwright install --with-deps chromium firefox webkit",
  );
  assert.ok(job.steps.indexOf(prepare) < job.steps.indexOf(install));
  assert.ok(
    job.steps.indexOf(install) <
      job.steps.findIndex((step) => step.run === "npm run ci:quality"),
  );
});
