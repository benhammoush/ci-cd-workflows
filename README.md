# CI/CD Workflows

Versioned GitHub Actions workflows for consistent testing and controlled delivery
of web frontends and Cloudflare Worker APIs.

Applications retain their source, tests and provider-specific adapters. This
repository supplies shared verification, artifact integrity and release guards.
Successful main CI can deliver to dev; production is a separate manual,
exact-source release with native approval.

The foundation uses Node.js, GitHub reusable workflows and explicitly pinned
Ubuntu 24.04 runners. See [the contract](docs/contract.md) for adoption, naming,
security boundaries and verification limits.
