# Handoff 2026-11-04: restore conventions-check.yml (conventions sync clean again)

- **State:** PR from `chore/restore-conventions-check`, based on main at c4cc9b9 (includes f85a448). Ready for review, not merged.
- **Cause:** Dependabot PR #36 (c6cef52) bumped `actions/setup-node` in `.github/workflows/conventions-check.yml` from v4.4.0 (`49933ea5288caeca8642d1e84afbd3f7d6820020`) to v7.1.0 (`949feb2413d6458794dcd2491c4babbbce0c15c1`). That file is managed by conventions v1.6.2 and recorded in `.conventions.lock.json`, so `sync.mjs --check` reported `CONFLICT ... (edited by hand since last sync)`.
- **Done:** restored only `.github/workflows/conventions-check.yml` to the v1.6.2 synced content (`git show 7668b5f:.github/workflows/conventions-check.yml`; a one-line diff: setup-node back to the v4.4.0 SHA). `.conventions.lock.json` and every other file untouched. The same #36 bump to `ci.yml` and `monitor.yml` stays, since those are not managed files.
- **Verified:** `node <conventions v1.6.2>/scripts/sync.mjs --repo . --check` went from `0 to write, 1 conflicts` (exit 1) to `0 to write, 0 conflicts` (exit 0).
- **Why Dependabot will do it again:** `.github/dependabot.yml` has one `actions` group over `*` for the whole repo. It can ignore a dependency repo-wide (as it already does for `actions/checkout >=5`) but not per file, so managed workflows get hunks in every weekly actions PR.
  - Managed files holding SHA pins: `conventions-check.yml` (checkout, setup-node), `deploy-secrets-lint.yml` (checkout, setup-node), `claude-code-review.yml` (checkout, claude-code-action).
  - `deploy-secrets-lint.yml` still pins setup-node v4.4.0 (`49933ea5...`), so it is the next file Dependabot will propose to bump.
  - 2026-11-02 decision (see `2026-11-02-deps-actions-split.md`): "conventions-check.yml pins stay until a conventions release". #36 merged anyway, because the actions group touches every workflow in one PR.
- **Proposals (not implemented):**
  1. Upstream: a conventions release that bumps the managed pins (setup-node to v7.1.0 in conventions-check.yml and deploy-secrets-lint.yml), then `sync.mjs` here. Fixes the cause for everyone; needs a conventions PR and tag, and the checkout v4.4.0 hold in claude-code-review.yml must be kept.
  2. Documented rule: any Dependabot actions PR must drop hunks in managed workflow files before merge (reviewer reverts them or runs sync `--check` and restores). No tooling change; relies on people, and `conventions-check` fails the PR if missed.
  3. (Stopgap, also not done) a repo-wide `ignore` for `actions/setup-node >=5` in dependabot.yml. Would also hold back ci.yml, monitor.yml, release.yml and repo-setup.yml, which were deliberately moved to v7 in the 2026-11-02 split, so not recommended.
- **Resume:** `git checkout chore/restore-conventions-check`; then `npm ci && node .github/scripts/check-syntax.js && npm test && npm audit --audit-level=high`, and `node <conventions-checkout-at-v1.6.2>/scripts/sync.mjs --repo . --check`.
- **Not done (by design):** no merge, no dependabot.yml change, no change to any other workflow or to `.conventions.lock.json`.
