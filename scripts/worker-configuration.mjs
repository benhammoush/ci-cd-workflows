/** Reduce historical TOML to declarative Worker settings; executable hooks are never forwarded. @file */
import assert from "node:assert/strict";
import { parse } from "smol-toml";

/** Select a supported target and fail on undeclared settings instead of silently changing behavior. */
export function workerConfiguration(text, environment) {
  assert.ok(["dev", "production"].includes(environment));
  const source = parse(text, { unsafeKeyBehaviour: "throw" });
  const selected = source.env?.[environment];
  assert.ok(selected);
  const globalKeys = [
    "name",
    "main",
    "compatibility_date",
    "compatibility_flags",
    "observability",
    "vars",
    "kv_namespaces",
    "env",
  ];
  const targetKeys = [
    "name",
    "workers_dev",
    "preview_urls",
    "vars",
    "kv_namespaces",
    "triggers",
  ];
  assert.ok(
    Object.keys(source).every((name) => globalKeys.includes(name)),
    "Unsupported global Worker settings",
  );
  assert.ok(
    Object.keys(selected).every((name) => targetKeys.includes(name)),
    "Unsupported target Worker settings",
  );
  assert.match(source.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(selected.workers_dev, true);
  assert.equal(selected.preview_urls, false);
  assert.ok(
    selected.vars &&
      Object.values(selected.vars).every((value) => typeof value === "string"),
  );
  assert.ok(Array.isArray(selected.kv_namespaces));
  for (const binding of selected.kv_namespaces) {
    assert.deepEqual(Object.keys(binding).sort(), ["binding", "id"]);
    assert.match(binding.binding, /^[A-Z_]+$/);
    assert.match(binding.id, /^[a-f0-9]{32}$/);
  }
  if (selected.triggers)
    assert.deepEqual(Object.keys(selected.triggers), ["crons"]);
  return {
    name: selected.name,
    compatibility_date: source.compatibility_date,
    ...(source.compatibility_flags
      ? { compatibility_flags: source.compatibility_flags }
      : {}),
    observability: source.observability,
    workers_dev: true,
    preview_urls: false,
    vars: selected.vars,
    kv_namespaces: selected.kv_namespaces,
    ...(selected.triggers ? { triggers: selected.triggers } : {}),
  };
}
