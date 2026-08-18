# Git Integration for Cloudflare Workers Builds

Use Cloudflare Workers Builds' GitHub App authorization for repository-connected deployments. The authorization opens through Cloudflare's setup flow and should be limited to the repository or organization that owns this project. Cloudflare manages that integration; Cloudflare Ops MCP does not need, request, or store a GitHub personal access token.

This repository contains two separately deployable Worker projects:

| Project | Root directory | Purpose |
| --- | --- | --- |
| Cloudflare Ops MCP | `worker/` | Public OAuth MCP endpoint and guarded Cloudflare tools |
| AMH WT Agent Harness | `agent/` | Private coordinator, schedules, audit, health checks, and authenticated console |

Configure them as two Workers Builds projects pointing at the same repository. Set each project's root directory explicitly so a change builds the intended Worker configuration.

## Recommended branch policy

- Treat `main` as the production branch.
- Send feature and maintenance branches to preview deployments first.
- Run tests and the Worker dry-run build before promotion.
- Verify the preview's public health endpoint or intended target before merging.
- Promote only the immutable reviewed commit that passed verification.
- Do not configure automatic production writes or approval bypasses from branch names.

## Exact setup checklist

1. In the Cloudflare dashboard, create or open the first Workers Builds project.
2. Choose **Connect to Git** and authorize the Cloudflare Workers Builds GitHub App in its pop-up flow.
3. Grant access only to the required GitHub account or organization and this repository where GitHub permits repository-level selection.
4. Select the `cloudflare-ops-mcp` repository.
5. Set the first project root directory to `worker/`.
6. Set its production branch to `main`; leave non-production branches as previews.
7. Use `worker/wrangler.jsonc` and provision its documented secrets and bindings in Cloudflare, not in Git.
8. Create a second Workers Builds project from the same repository.
9. Set the second project root directory to `agent/`.
10. Set its production branch to `main`; leave non-production branches as previews.
11. Provision the Agent Harness secrets and bindings from `agent/wrangler.jsonc` and `.dev.vars.example` through Cloudflare's secret controls.
12. Bind the MCP Worker to the deployed harness with the private `AGENT_HARNESS` service binding and matching internal secret; do not replace it with a public harness URL.
13. Push a preview branch and confirm both affected projects build successfully.
14. Run the relevant public verification: require a 2xx response, reject redirects, and require the expected version or page marker when one is configured.
15. Merge the reviewed commit to `main` only after the preview passes.
16. Record the immutable Git commit and verified deployment receipt for rollback and audit.

## Private artifacts and lessons

Local stashes, scratch files, private exports, tokens, `.dev.vars`, audit dumps, and operator notes stay ignored and out of the repository. The `agent/knowledge-vault/` directory may contain only approved, redacted, public-safe lessons. Never promote raw job context, customer data, connector keys, OAuth tokens, email contents, or secret values into the vault.

## Rollback

Rollback means selecting a known-good immutable Git commit and running the same verified deployment path again. Do not use a broad reset, force-push, or an agent-authored shell command as recovery. Re-deploy the exact commit to the correct Worker project, then repeat the public 2xx/no-redirect/expected-marker verification and retain the new receipt.
