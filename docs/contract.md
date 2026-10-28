# CI/CD integration contract

Shared verification and controlled delivery for web frontends and Cloudflare
Worker APIs. Applications own their tests, product behavior and provider adapters;
this tooling owns artifact integrity, credential separation and release guards.

## Repository interactions

- **`ci-cd-workflows` — shared foundation.** Supplies the reusable verification,
  delivery and audit workflows, starter templates, configuration validation and
  artifact/release guards. Application repositories call a published, full-SHA-pinned
  revision; changes here do not automatically update their pins. The foundation's
  own CI tests the shared tooling, not the hosted applications.

- **[`iris-frontend`](https://github.com/benhammoush/iris-frontend) — dashboard.**
  Calls the web profile for quality/build, browser checks and Vercel delivery.
  Its integration checks also check out an explicitly pinned `iris-backend`
  revision and run the frontend/backend checks locally, without deploying that
  backend. Hosted builds select the matching dev or production API origin.
  [Integration configuration](https://github.com/benhammoush/iris-frontend/blob/main/.github/ci-cd.json).

- **[`iris-backend`](https://github.com/benhammoush/iris-backend) — market API.**
  Calls the Worker profile for quality/build and Cloudflare delivery. Its adapter
  passes `wrangler.toml` through the shared configuration allowlist before deploying
  the tested Worker bundle. It owns its cache bindings, provider integration and
  explicit refresh behavior. Delivery is independent of frontend delivery.
  [Integration configuration](https://github.com/benhammoush/iris-backend/blob/main/.github/ci-cd.json).

- **[`crypto_gateway_frontend`](https://github.com/benhammoush/crypto_gateway_frontend) — checkout UI.**
  Calls the web profile for quality/build, browser checks and Vercel delivery.
  Builds select the matching dev or production gateway API. Unlike Iris, its
  shared configuration does not request a pinned-backend integration checkout;
  the application owns its API compatibility tests and deployment adapter.
  [Integration configuration](https://github.com/benhammoush/crypto_gateway_frontend/blob/main/.github/ci-cd.json).

- **[`crypto_gateway_backend`](https://github.com/benhammoush/crypto_gateway_backend) — payment API.**
  Calls the Worker profile for quality/build and Cloudflare delivery. Its own
  adapter validates Worker configuration, isolated D1 selection and schema
  attestation. The frontend and backend are delivered independently; shared CI
  does not perform payment acceptance or migrate the database for them.
  [Integration configuration](https://github.com/benhammoush/crypto_gateway_backend/blob/main/.github/ci-cd.json).

- **[`dripperz`](https://github.com/benhammoush/dripperz) — collection site.**
  Calls the web profile for quality/build, browser checks and Vercel delivery
  to separate dev and production projects. No paired Worker checkout is declared.
  [Integration configuration](https://github.com/benhammoush/dripperz/blob/main/.github/ci-cd.json).

- **[`portfolio`](https://github.com/benhammoush/portfolio) — portfolio site.**
  Calls the web profile for quality/build, browser checks and Vercel delivery.
  Its adapter owns target-project validation; its declared lock scope serializes
  delivery across both environments. No paired Worker checkout is declared.
  [Integration configuration](https://github.com/benhammoush/portfolio/blob/main/.github/ci-cd.json).

All six application repositories use the shared dependency audit. Each retains
its own tests, environment settings, credentials and trusted deployment adapter.
The linked configurations own the selected revisions and declared inputs; this
list describes the connections, not live deployment or acceptance status.

## Capabilities

- **Pull-request verification:** tests the PR merge revision without deployment
  credentials, a target environment or deployment side effects.
- **Dev delivery:** verifies an exact main revision and automatically deploys its
  tested artifact. A main-only manual request can revalidate a merged revision
  for dev recovery. Failed, cancelled or PR checks cannot deploy.
- **Production delivery:** manual and main-only, requiring a full merged SHA,
  successful same-repository dev-delivery evidence, production-configured checks
  and native environment approval. Successful deployment is not user acceptance.
- **Dependency audits:** weekly and manually requested, main-only and read-only,
  without environment or deployment secrets. Audits install locked dependencies
  without lifecycle scripts and check both full and production-only dependency
  trees. Any advisory severity or registry/install failure fails the audit; the
  production report still runs if the full audit finds vulnerabilities. No fixes,
  upgrades or deployments are performed. Results live in Actions logs, with
  notifications controlled by GitHub settings.

Delivery cannot be disabled through `DEPLOY_ENABLED` or `DELIVERY_ENABLED` flags.
Missing credentials or configuration fail rather than produce a successful no-op.
Production stays on hold by not requesting it; native approval is a separate gate.
Production reruns and automatic rollback are not supported. Inspect provider state
before a fresh approved request after an uncertain or failed mutation.

## Application interface

Use the web or Worker starters in `templates/`, pinned to an independently reviewed,
published full commit SHA. Branches and mutable tags are not supported references.
All shared references and `automationSha` must agree. Local edits do not update
consumers, enable resources or authorize deployment.

`.github/ci-cd.json` uses schema version 1 and declares the profile, supported Node
major, automation SHA, integration requirements, compatibility check names,
allowed nonsecret deployment variables and public dev/production build inputs.

Applications provide:

- `ci:quality`: lint/documentation, formatting, types/version alignment, dependency
  checks, unit/integration tests and the production build.
- `ci:browser` for web: built-output coverage in Chromium, Firefox and WebKit;
  specialized GPU/integration suites may remain focused.
- `ci:integration` where declared.
- Optional `ci:prepare`: packaging only, including Worker dry-run bundles.
- `scripts/ci-deploy.mjs`: a trusted-main provider adapter consuming verified
  `dist` and `ci-build.json`, never privileged code from a historical candidate.

Verification uses `ubuntu-24.04`; Node and locked Playwright versions remain
application-owned. Browser preparation uses the official HTTPS Ubuntu archive,
not Azure mirrors, including mirror-file source layouts. Signature and suite
checks remain enabled. APT retries/timeouts are bounded; installation has a
ten-minute limit within the forty-minute verification budget. Installation failure
never skips browser coverage or permits deployment. Shared CI checks browser-host
setup across all three engines; Worker profiles do not install browsers.

## Delivery guarantees

- Verification has no provider deployment credentials. Delivery uses only the
  selected environment's credential; provider tokens are step-scoped, with native
  approval before production access.
- Deploy tested bytes without rebuilding during privileged delivery. Different
  dev/production build inputs require separately verified configured artifacts.
- Serialize deployment per environment with a non-cancelling lock; cancelling
  whole-caller concurrency must not interrupt deployment.
- Record the prior immutable provider identity before mutation. Verify the new
  provider identity and perform bounded read-only post-deployment checks.
- Write `delivery-record.json` even when mutation or verification is uncertain.
  Never infer recovery readiness from missing prior identity.
- Look up dev evidence within the newest 500 successful main runs. Only
  `verify-and-deploy-dev.yml` and historical `ci.yml` delivery records qualify,
  under the same repository, event, artifact and exact-source checks. PR checks,
  audits and production runs do not qualify. Missing, expired or mismatched
  evidence fails closed; revalidate the candidate in dev.
- Evidence reads use GitHub's built-in token, not another PAT or a dev provider
  credential in production.

Web delivery uploads only a fresh generated `.vercel/output` tree, including
function `.vc-config.json` files, through Vercel's file/deployment APIs. It uses
the prebuilt file-list and version-2 payload with matching digest/size headers;
no dynamically resolved Vercel CLI is executed. Uploads and deployment creation
are never retried. Record the created deployment ID before readiness/alias reads.
See the [Build Output API](https://vercel.com/docs/build-output-api) and
[client implementation](https://github.com/vercel/vercel/tree/main/packages/client/src).

## Worker configuration

Worker TOML is reduced to allowlisted declarative JSON before privileged Wrangler
execution. Custom build hooks and unknown settings are rejected, not forwarded.
The complete list of supported environment-scoped bindings is:

- **Variables (`vars`):** required object of string values for nonsecret application
  settings. Secrets are configured separately with the provider, not written here.
- **KV storage (`kv_namespaces`):** required array, which may be empty. Each entry
  contains exactly `binding` (uppercase letters/underscores) and `id` (32 lowercase
  hexadecimal characters).
- **D1 databases (`d1_databases`):** optional array. Each entry contains exactly
  `binding`, `database_name` and an explicit nonzero
  UUID `database_id`. Missing IDs cannot trigger automatic provisioning.
- **Rate limiting (`ratelimits`):** optional array. Each entry contains exactly
  `name`, a positive-integer string
  `namespace_id`, and `simple` containing a positive safe-integer `limit` and a
  `period` of 10 or 60 seconds.

Bindings come only from the selected `env.dev` or `env.production` section, not
top-level defaults. D1 and limiter names use uppercase letters, digits and
underscores, cannot start with a digit, and must be unique across both new arrays,
KV bindings and variables. D1 names/IDs and limiter names/IDs reject surrounding
whitespace. Malformed values and extra binding fields fail closed. Other binding
types, preview bindings, migration options and remote-development settings are
unsupported. Configurations without D1 or rate-limit arrays remain unchanged.

The other allowed settings are configuration, not resource bindings:

- **Selected environment:** `name`, `workers_dev` (must be `true`), `preview_urls`
  (must be `false`) and optional `triggers` containing only `crons`.
- **Top level:** `compatibility_date`, optional `compatibility_flags` and
  `observability` supply runtime/logging settings. `name`, `main`, `vars`,
  `kv_namespaces` and `env` are also accepted input keys, but the filter uses the
  selected environment's name/bindings and does not forward `main`; the trusted
  adapter supplies the tested bundle entry point.

This path neither creates resources nor applies migrations. Resource ownership,
environment isolation and rate-limit namespace isolation require provider
verification. Rate limits are approximate per Cloudflare location, not global quotas.

## Stable interfaces and compatibility

- Entry points: `verify-pr.yml` / `Verify PR`, `verify-and-deploy-dev.yml` /
  `Verify and deploy to dev`, `verify-and-deploy-prod.yml` / `Verify and deploy to prod`,
  and `weekly-vuln-audit.yml` / `Weekly vulnerability audit`. Audits run on staggered
  Monday UTC schedules plus a manual trigger.
- Caller jobs: `PR checks`, `Dev checks`, `Dev delivery`, `Production checks` and
  `Production delivery`. Reusable layers name validation, tests/build and provider
  delivery. The standalone PR result `Verify` (`verify_result`) always runs and
  passes only after all required checks succeed; it does not repeat the tests.
  Deployment jobs are not PR merge requirements.
- Environments: `dev` and `production`; variables/secrets: UPPER_SNAKE_CASE.
  Files use kebab-case; job and step IDs use snake_case.
- Artifacts: `build-<full-source-sha>-<environment>` and
  `delivery-record-<environment>`.
- Delivery records: `delivery-record.json`, schema version 1, with `sourceSha`,
  `environment`, `artifactDigest`, `configurationDigest`, `workflowRunId`,
  `deploymentId`, `previousDeploymentId` and `status`. Verified delivery status is
  exactly `smoke-verified-not-user-accepted`. A null predecessor means no known
  recovery identity, not proven recovery readiness. Provider-specific fields
  retain additional evidence.

Public inputs, check names, artifacts and record schemas follow semantic
versioning. Consumers adopt reviewed immutable revisions through PRs, preserving
explicit `legacyChecks` aliases until any required-check migration is approved
and read back. Retired entry points must be removed before rendering replacements;
competing delivery callers fail conformance. `.yml.pending` starters are inactive:
replace the SHA placeholder with a verified published revision before activation.

Native protections require app-bound `Verify` (GitHub Actions, app ID 15368) and
`CodeRabbit` (app ID 347564), independent reviews, stale-review dismissal, resolved
conversations, strict checks and no administrator bypass. Never bypass a missing
check or temporarily weaken protection for adoption. Abandoned check-name changes
require separately approved restoration before merging incompatible callers.
Preserve stronger application guards; do not rename provider resources as part of
adoption. Task branches use `<type>/<kebab-case-description>` and Conventional
Commit titles.
