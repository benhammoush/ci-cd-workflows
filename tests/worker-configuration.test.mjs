/** Historical custom build commands never reach privileged Wrangler. @file */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parse, stringify } from "smol-toml";
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

const database = {
  binding: "WATCHLIST_DB",
  database_name: "watchlists-dev",
  database_id: "11111111-2222-3333-4444-555555555555",
};
const limiter = {
  name: "WATCHLIST_RATE_LIMITER",
  namespace_id: "1001",
  simple: { limit: 60, period: 60 },
};

/** Build synthetic target configuration without referencing hosted resources.
 * @param {object} additions - Settings added to the dev environment.
 * @returns {string} TOML input for the sanitizer.
 */
function withBindings(additions) {
  const source = parse(configuration);
  Object.assign(source.env.dev, additions);
  return stringify(source);
}

/** Compare the JSON values written to the delivery configuration, not TOML parser prototypes.
 * @param {unknown} value - Parsed or plain configuration value.
 * @returns {unknown} Its JSON representation.
 */
function jsonValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

test("optional D1 and rate-limit bindings survive unchanged, alone or together", () => {
  for (const additions of [
    { d1_databases: [database] },
    { ratelimits: [limiter] },
    { d1_databases: [database], ratelimits: [limiter] },
    { d1_databases: [], ratelimits: [] },
  ]) {
    const safe = workerConfiguration(withBindings(additions), "dev");
    assert.deepEqual(jsonValue(safe.d1_databases), additions.d1_databases);
    assert.deepEqual(jsonValue(safe.ratelimits), additions.ratelimits);
  }
  const original = workerConfiguration(configuration, "dev");
  assert.ok(!Object.hasOwn(original, "d1_databases"));
  assert.ok(!Object.hasOwn(original, "ratelimits"));
  const tenSeconds = { ...limiter, simple: { limit: 1, period: 10 } };
  assert.deepEqual(
    jsonValue(
      workerConfiguration(withBindings({ ratelimits: [tenSeconds] }), "dev")
        .ratelimits,
    ),
    [tenSeconds],
  );
});

test("bindings belong only to the selected environment, never the other target", () => {
  const source = parse(
    withBindings({ d1_databases: [database], ratelimits: [limiter] }),
  );
  source.env.production = {
    ...source.env.dev,
    name: "worker-production",
    d1_databases: [
      {
        ...database,
        database_name: "watchlists-production",
        database_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
    ],
    ratelimits: [{ ...limiter, namespace_id: "1002" }],
  };
  for (const target of ["dev", "production"]) {
    const safe = workerConfiguration(stringify(source), target);
    assert.deepEqual(
      jsonValue(safe.d1_databases),
      jsonValue(source.env[target].d1_databases),
    );
    assert.deepEqual(
      jsonValue(safe.ratelimits),
      jsonValue(source.env[target].ratelimits),
    );
  }
  delete source.env.production.d1_databases;
  delete source.env.production.ratelimits;
  const safe = workerConfiguration(stringify(source), "production");
  assert.ok(!Object.hasOwn(safe, "d1_databases"));
  assert.ok(!Object.hasOwn(safe, "ratelimits"));
  source.d1_databases = [database];
  assert.throws(() => workerConfiguration(stringify(source), "production"));
  delete source.d1_databases;
  source.ratelimits = [limiter];
  assert.throws(() => workerConfiguration(stringify(source), "production"));
});

test("malformed or unsupported D1 and limiter settings fail closed", () => {
  const { database_id: ignored, ...withoutId } = database;
  assert.ok(ignored);
  for (const additions of [
    { d1_databases: "invalid" },
    { ratelimits: "invalid" },
    { d1_databases: [{}] },
    { ratelimits: [{}] },
    { d1_databases: [withoutId] },
    ...["", "invalid", 123, "00000000-0000-0000-0000-000000000000"].map(
      (database_id) => ({ d1_databases: [{ ...database, database_id }] }),
    ),
    ...["", "bad name", 123].map((database_name) => ({
      d1_databases: [{ ...database, database_name }],
    })),
    ...["", "bad-name", 123].map((binding) => ({
      d1_databases: [{ ...database, binding }],
    })),
    ...["remote", "migrations_dir", "preview_database_id", "unexpected"].map(
      (field) => ({ d1_databases: [{ ...database, [field]: "unsupported" }] }),
    ),
    ...["", "0", "-1", "1.5", "1e3", 1001].map((namespace_id) => ({
      ratelimits: [{ ...limiter, namespace_id }],
    })),
    ...["", "bad-name", 123].map((name) => ({
      ratelimits: [{ ...limiter, name }],
    })),
    ...[0, -1, 1.5, "60", Number.MAX_SAFE_INTEGER + 1].map((limit) => ({
      ratelimits: [{ ...limiter, simple: { limit, period: 60 } }],
    })),
    ...[0, 30, "60"].map((period) => ({
      ratelimits: [{ ...limiter, simple: { limit: 60, period } }],
    })),
    { ratelimits: [{ ...limiter, unexpected: true }] },
    { ratelimits: [{ ...limiter, simple: {} }] },
    {
      ratelimits: [
        { ...limiter, simple: { limit: 60, period: 60, unexpected: true } },
      ],
    },
  ]) {
    assert.throws(
      () => workerConfiguration(withBindings(additions), "dev"),
      JSON.stringify(additions),
    );
  }
});

test("new binding names cannot collide with bindings or variables", () => {
  for (const additions of [
    { d1_databases: [database, database] },
    { ratelimits: [limiter, limiter] },
    {
      d1_databases: [database],
      ratelimits: [{ ...limiter, name: database.binding }],
    },
    { d1_databases: [{ ...database, binding: "SNAPSHOTS" }] },
    { ratelimits: [{ ...limiter, name: "SNAPSHOTS" }] },
    { d1_databases: [{ ...database, binding: "CORS_ORIGINS" }] },
    { ratelimits: [{ ...limiter, name: "CORS_ORIGINS" }] },
  ]) {
    assert.throws(
      () => workerConfiguration(withBindings(additions), "dev"),
      /Duplicate Worker binding name/,
    );
  }
});

test("identifiers reject trailing line terminators, including padded zero UUIDs", () => {
  for (const ending of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    for (const additions of [
      {
        d1_databases: [
          { ...database, database_id: database.database_id + ending },
        ],
      },
      {
        d1_databases: [
          {
            ...database,
            database_id: "00000000-0000-0000-0000-000000000000" + ending,
          },
        ],
      },
      {
        d1_databases: [
          { ...database, database_name: database.database_name + ending },
        ],
      },
      { d1_databases: [{ ...database, binding: database.binding + ending }] },
      {
        ratelimits: [
          { ...limiter, namespace_id: limiter.namespace_id + ending },
        ],
      },
      { ratelimits: [{ ...limiter, name: limiter.name + ending }] },
    ]) {
      assert.throws(() => workerConfiguration(withBindings(additions), "dev"));
    }
  }
});
