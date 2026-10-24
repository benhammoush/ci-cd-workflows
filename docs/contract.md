# Release contract

Automation 3.0 removes production deployment opt-ins, an intentional breaking behavior
change from 2.x; dev remains automatic. Consumer configuration, artifacts and records retain schema
version 1. Adopt only a verified published immutable SHA; local changes do not
update consumers or authorize deployment.

Automation 4.0 standardizes job/check names and adds the independently callable
weekly vulnerability audit. Check names are a breaking public API change; consumer
configuration remains schema version 1. Native protection migration requires
separate owner approval and readback; local source edits never change protections.

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

### Canonical job names and required-check migration

All six application callers use `Verify`, `Deploy dev`, `Verify production`,
`Deploy production` and `Audit vulnerabilities`. Reusable workflows may add caller
prefixes in GitHub's UI. A standalone `verify_result` job named exactly `Verify`
provides the stable required-check context: it always runs after verification and
passes only when verification succeeded, including its integration/browser checks.
It does not run the tests twice. Deployment and production jobs are not PR merge
requirements.

The prepared consumers set `legacyChecks: []` and replace old result bridges with
`verify_result`. The configuration field remains supported for consumers that
still need compatibility aliases; the renderer must not silently remove those.
Current native requirements still use these old names (read Oct 23, 2026):

| Repository              | Existing verification check names to replace |
| ----------------------- | -------------------------------------------- |
| iris-frontend           | `test-and-build`, `vertical`                 |
| iris-backend            | `test`                                       |
| crypto_gateway_frontend | `quality`, `browser`                         |
| crypto_gateway_backend  | `quality`                                    |
| Dripperz                | `Quality and build`, `Browser smoke`         |
| portfolio               | `Foundation quality`                         |

Do not merge these prepared naming changes under unchanged protections. For each
repository, after separate publication/settings authorization:

1. Publish and review the shared 4.0 workflow revision. Update the consumer's
   `automationSha` and every reusable release reference to that same published
   immutable SHA. Activate its pending audit caller at that SHA too.
2. Publish the consumer PR and require successful checks on its exact current
   head. Confirm that standalone `Verify` is reported by GitHub Actions
   (app ID 15368), not just a nested job with a similar name. Check a failing or
   skipped verification cannot produce a successful `Verify` result.
3. With explicit owner approval, replace only the old verification requirements
   with app-bound `Verify`; retain strict mode and app-bound `CodeRabbit`
   (app ID 347564). Preserve independent reviews, stale-review dismissal,
   resolved conversations, administrator enforcement and all other protections.
   Read back the resulting requirements before allowing the merge.
4. Merge only after the new required checks and current-head approval pass.
   Main CI can deploy dev as usual; this migration authorizes no production run.

Do not temporarily disable protection or bypass a missing check. If a naming PR
is abandoned after the settings switch, restore the old required contexts under
fresh owner approval before merging unrelated PRs that do not emit `Verify`.
No remote settings have been changed by preparing this rollout.

### Weekly vulnerability audits

Applications use `weekly-vuln-audit.yml` / `Weekly vulnerability audit`
to call the shared `weekly-vuln-audit.yml` at a reviewed, published immutable
SHA. The starter is `templates/weekly-vuln-audit.yml`; replace its SHA
placeholder and use the application's supported Node version. Keep schedules on
Monday UTC, staggered across consumers, plus a manual trigger. Execution is
main-only, read-only and has no environment or deployment secrets.

The audit installs locked dependencies without lifecycle scripts, then checks the
full and production-only trees against the configured npm registry. Any advisory
severity fails the run; registry/install errors also fail rather than certifying
safety. The production report still runs if the full audit finds vulnerabilities.
No automatic fixes, dependency upgrades, releases or deployments occur. Reports
are in Actions logs; GitHub notification settings control delivery to maintainers.
This supplements, rather than replaces, dependency checks in normal CI.

Locally prepared consumer files ending in `.yml.pending` are intentionally inactive.
Before publishing consumer changes, replace `PENDING_SHARED_WORKFLOW_SHA` with
the reviewed published shared-workflow SHA and remove `.pending`. Verify that the
workflow exists at that SHA. Do not merge the Iris audit deletions until their
replacement callers are activated in the same consumer change.

### Release naming

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
