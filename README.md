# CI/CD Workflows

Versioned GitHub Actions workflows for consistent testing and controlled delivery
of web frontends and Cloudflare Worker APIs.

Applications retain their source, tests and provider-specific adapters. This
repository supplies shared verification, artifact integrity and release guards.
PR verification is separate from main-to-dev delivery; production is a manual,
exact-source release with native approval.

## Workflow overview

```mermaid
flowchart TD
    APP["Application repo<br/>Owns source, tests, build commands<br/>and deployment adapter"]

    subgraph CI["Shared CI/CD workflows"]
        COMMON["Common checks — ci:quality<br/>Lint, typecheck, test and build"]
        FRONT["Frontend<br/>ci:browser — browser tests<br/>ci:prepare — optional artifact preparation"]
        BACK["Backend<br/>ci:prepare — optional artifact preparation"]
        GUARDS["Protect tested build artifacts<br/>and enforce release rules"]

        COMMON --> FRONT
        COMMON --> BACK
        FRONT --> GUARDS
        BACK --> GUARDS
    end

    DEPLOY["Deploy tested build<br/>Dev: automatic · Production: dev evidence + approval"]

    APP --> COMMON
    GUARDS --> DEPLOY
```

Each application follows its matching frontend or backend path. Commands are
defined by the application and executed by the shared workflows. PR verification
stops before deployment.

The foundation uses Node.js, GitHub reusable workflows and explicitly pinned
Ubuntu 24.04 runners. See [the contract](docs/contract.md) for adoption, naming,
security boundaries and verification limits.
