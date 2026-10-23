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
  const sources = [
    "etc/apt/sources.list",
    "etc/apt/sources.list.d/ubuntu.sources",
  ]
    .map((path) => join(root, path))
    .filter(existsSync);
  assert.ok(sources.length, "Ubuntu package sources are missing");
  for (const path of sources) {
    const original = readFileSync(path, "utf8");
    const updated = ubuntuMirror(original);
    if (updated !== original) writeFileSync(path, updated);
  }
  writeFileSync(
    join(root, "etc/apt/apt.conf.d/80-ci-cd-network"),
    aptNetworkPolicy,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  browserHost();
