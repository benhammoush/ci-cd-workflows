/** Prepare bounded Ubuntu browser dependencies without changing package authentication. @file */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const aptNetworkPolicy =
  'Acquire::Retries "2";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\n';

/** Replace only the runner's slow Azure Ubuntu mirror; preserve suites/signature keys. */
export function ubuntuMirror(text) {
  return text.replace(
    /https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu(?=[/\s]|$)/g,
    "https://archive.ubuntu.com/ubuntu",
  );
}

/** Configure only an Ubuntu 24.04 host (or a disposable fixture root in tests). */
export function browserHost(root = "/") {
  const release = readFileSync(join(root, "etc/os-release"), "utf8");
  assert.match(release, /^ID=(?:ubuntu|"ubuntu")$/m);
  assert.match(release, /^VERSION_ID=(?:24\.04|"24\.04")$/m);
  // Hosted runners may route both formats through a mirror+file source instead.
  const sources = [
    "etc/apt/sources.list",
    "etc/apt/sources.list.d/ubuntu.sources",
    "etc/apt/apt-mirrors.txt",
  ]
    .map((path) => join(root, path))
    .filter(existsSync);
  assert.ok(sources.length, "Ubuntu package sources are missing");
  for (const path of sources) {
    const original = readFileSync(path, "utf8");
    const updated = ubuntuMirror(original);
    if (updated.includes("mirror+file:/etc/apt/apt-mirrors.txt")) {
      assert.ok(
        existsSync(join(root, "etc/apt/apt-mirrors.txt")),
        "Referenced Ubuntu mirror list is missing",
      );
    }
    if (updated !== original) writeFileSync(path, updated);
  }
  for (const path of sources) {
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu(?=[/\s]|$)/,
      "Azure mirror remains in effective Ubuntu package configuration",
    );
  }
  writeFileSync(
    join(root, "etc/apt/apt.conf.d/80-ci-cd-network"),
    aptNetworkPolicy,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  browserHost();
