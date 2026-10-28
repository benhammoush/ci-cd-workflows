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
    "d1_databases",
    "ratelimits",
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
  const names = new Set([
    ...Object.keys(selected.vars),
    ...selected.kv_namespaces.map((binding) => binding.binding),
  ]);
  for (const key of ["d1_databases", "ratelimits"]) {
    if (selected[key] === undefined) continue;
    assert.ok(Array.isArray(selected[key]), `${key} must be an array`);
    for (const binding of selected[key]) {
      if (key === "d1_databases") {
        assert.deepEqual(Object.keys(binding).sort(), [
          "binding",
          "database_id",
          "database_name",
        ]);
        assert.match(binding.database_name, /^[A-Za-z0-9][A-Za-z0-9_-]*$/);
        assert.equal(binding.database_name, binding.database_name.trim());
        assert.match(
          binding.database_id,
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
        );
        assert.notEqual(
          binding.database_id,
          "00000000-0000-0000-0000-000000000000",
        );
        assert.equal(binding.database_id, binding.database_id.trim());
      } else {
        assert.deepEqual(Object.keys(binding).sort(), [
          "name",
          "namespace_id",
          "simple",
        ]);
        assert.match(binding.namespace_id, /^[1-9][0-9]*$/);
        assert.equal(binding.namespace_id, binding.namespace_id.trim());
        assert.deepEqual(Object.keys(binding.simple).sort(), [
          "limit",
          "period",
        ]);
        assert.ok(
          Number.isSafeInteger(binding.simple.limit) &&
            binding.simple.limit > 0,
        );
        assert.ok([10, 60].includes(binding.simple.period));
      }
      const name = key === "d1_databases" ? binding.binding : binding.name;
      assert.match(name, /^[A-Z_][A-Z0-9_]*$/);
      assert.equal(name, name.trim());
      assert.ok(!names.has(name), "Duplicate Worker binding name");
      names.add(name);
    }
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
    ...(selected.d1_databases ? { d1_databases: selected.d1_databases } : {}),
    ...(selected.ratelimits ? { ratelimits: selected.ratelimits } : {}),
    ...(selected.triggers ? { triggers: selected.triggers } : {}),
  };
}
