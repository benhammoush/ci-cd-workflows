# Release contract

Automation 3.0 removes production deployment opt-ins, an intentional breaking behavior
change from 2.x; dev remains automatic. Consumer configuration, artifacts and records retain schema
version 1. Adopt only a verified published immutable SHA; local changes do not
update consumers or authorize deployment.

## Ownership and adoption

There are two profiles: web frontends and Worker backends. Applications retain
their meaningful tests and provider-specific adapters. Use the matching starter
files in `templates/`, replacing the automation SHA with an independently
reviewed, published full commit SHA and the Node version with the application's
supported major. Never use a branch or mutable tag in a consumer reference.
Consumer `.github/ci-cd.json` declares schema version 1, profile, Node major,
automation SHA, integration requirements, previous required-check display names,
allowed nonsecret deployment variables and public dev/production build inputs.

Required package scripts are `ci:quality`, `ci:browser` for web, and
`ci:integration` where declared. Quality includes lint/documentation, formatting,
types/version alignment, dependency checks, unit/integration tests and the final
production build. Web browser checks exercise the built output in Chromium,
Firefox and WebKit; specialized GPU/integration suites can remain focused.
Optional `ci:prepare` only packages tested output, including Worker dry-run
bundles; it does not deploy. Scripts existing in a package are not proof that
critical flows, accessibility, authorization or failure states are tested.

The fixed trusted-main `scripts/ci-deploy.mjs` consumes `dist` and `ci-build.json`
from verification. It validates target configuration and production dispatch guards, uses only
the selected target credential, records prior immutable provider identity before
mutation, deploys without rebuilding tested bytes, and checks provider identity
plus bounded read-only post-deployment verification. It writes `delivery-record.json` even on
uncertain mutation or post-deployment verification failure. No application source from a historical
candidate supplies a privileged adapter. Deployment credentials are unavailable
to verification jobs; provider tokens are step-scoped after native approval.

Web transport uses the file and deployment APIs, not a dynamically resolved
Vercel CLI. It sends only a fresh generated `.vercel/output` tree, including
function `.vc-config.json` files. This follows the official client's prebuilt
file-list and version-2 deployment payload; upload digest/size headers match its
uploader. File uploads and deployment creation are never retried, and a created
deployment ID is recorded before readiness/alias reads. See Vercel's
[Build Output API](https://vercel.com/docs/build-output-api) and
[client implementation](https://github.com/vercel/vercel/tree/main/packages/client/src).
Worker TOML is parsed into an allowlisted declarative JSON configuration; no
historical custom-build hook is passed to privileged Wrangler.

## Triggers and release evidence

Web verification prepares Ubuntu 24.04 browser dependencies using the official
HTTPS Ubuntu archive instead of the runner's Azure mirror, including hosted
runner configurations that resolve sources through `/etc/apt/apt-mirrors.txt`.
Preparation verifies that Azure is absent from all supported source layouts. Package suites,
signature verification and all three browser engines are unchanged. APT retries
and socket timeouts are bounded, with a separate ten-minute installation limit
inside the unchanged forty-minute verification budget. Installation failure fails
the job; it never skips a browser or resumes delivery without verification.

Foundation CI validates the host setup by installing and rendering a page with
Chromium, Firefox and WebKit on Ubuntu 24.04. Consumers still use their own locked
Playwright version and application-owned browser suites. All six consumers adopt
the reviewed patch through immutable SHA updates, including Worker profiles whose
browser-installation step remains disabled.

`CI` checks pull requests and main pushes. Only a successful main push's exact
merge SHA can automatically deliver dev. A main-only manual CI dispatch can
revalidate/redeploy an exact merged SHA for dev recovery. Failed, cancelled or PR
checks cannot deploy. Deploy jobs have their own non-cancelling environment lock;
do not put the whole caller workflow under cancelling concurrency.

Delivery has no boolean opt-in: absent or false `DEPLOY_ENABLED` and legacy
`DELIVERY_ENABLED` values cannot skip it. Missing configuration or credentials
fails delivery rather than reporting a successful disabled no-op. Production
manual dispatch, dev evidence and native approval remain unchanged. Not dispatching
the production workflow is the normal hold; native approval remains a separate gate.
Do not remove live flags until the verified immutable 3.0 release is adopted by
each consumer. Update project adapters and variable allowlists with that pin;
older releases still require their production flags. No production execution is
authorized by adopting this change.

`Deploy production` is a separate manual, main-only entry point. Require a full
merged SHA, retained successful same-repository dev delivery for that SHA,
target-configured verification, and native production approval. The owner checks
current dev acceptance, compatibility/configuration and eligible recovery before
approval. A selected SHA and successful post-deployment verification never imply human acceptance.
Production reruns are rejected; inspect provider state and start a fresh approved
dispatch after any uncertain or failed mutation. There is no automatic rollback.

Evidence lookup is deliberately bounded to the newest 500 successful CI runs.
Expired/missing/mismatched artifacts fail closed; revalidate the candidate in dev
instead of choosing another SHA or claiming an old deployment is still current.
GitHub Actions read access uses its built-in token, never another PAT or a dev
provider credential in production. Frontend environment substitutions may require
different dev/production bytes: verify each configured build, then deploy its exact
artifact. Retain both artifact and configuration identities.

## Naming and compatibility

- Files: lowercase kebab-case; jobs and step IDs: lower snake_case.
- Entry points: `ci.yml` / `CI`, `deploy-production.yml` / `Deploy production`.
- Environments: exactly `dev` and `production`; variables/secrets: UPPER_SNAKE_CASE.
- Artifacts: `build-<full-source-sha>-<environment>` and `delivery-record-<environment>`.
- Record: `delivery-record.json`, schemaVersion 1, camelCase fields including
  sourceSha, environment, artifactDigest, configurationDigest, workflowRunId,
  deploymentId, previousDeploymentId and status. Completed post-deployment verification status is exactly
  `smoke-verified-not-user-accepted`; a null predecessor explicitly means no known
  prior restore identity, not proof of recovery readiness. Extra provider fields
  retain project-specific evidence rather than discarding it.
- Task branches: `<type>/<kebab-case-description>`; Conventional Commit titles.
- Ubuntu runners: `ubuntu-24.04`. Node majors remain application-specific.

Preserve prior required-check contexts through explicit compatibility jobs until
native protection migration is approved and read back. Do not rename provider
resources or existing repositories for appearance. Retain stricter existing
mutation exclusion, transport/configuration guards and manual acceptance rules.

Public inputs, check names, artifacts and record schemas are versioned API.
Release intentional changes with semantic versions; consumers adopt reviewed SHAs
through PRs. Conformance validates parsed YAML and structured data and includes
negative tests. It cannot certify provider settings, token scopes, actual test
quality or native GitHub approvals: separately read back main-only environments,
required reviews/checks and disabled production admin bypass. Do not enable
targets, create credentials, perform payment operations or deploy as a side effect
of adoption. No application production release is authorized by this foundation.

The shared workflow code and tests are checked locally and in its own CI. Live
dev execution needs separately authorized application merges; native production
approval and actual production delivery require separate authorization. No real
device, minimum-browser, performance, legal or security certification is implied.
