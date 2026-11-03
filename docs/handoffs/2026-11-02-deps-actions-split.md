# Handoff 2026-11-02: split bump of actions/checkout and actions/setup-node

- **State:** draft PR from `chore/deps-actions-split` replaces Dependabot #27 (left open; owner closes it).
- **Done:** `actions/checkout` 4 -> 7 and `actions/setup-node` 4 -> 7 in ci.yml, monitor.yml, release.yml, repo-setup.yml, using the same `@v7` refs as #27 (the hunks match #27's for those four files). New guard `test/workflow-checkout-pin.js` fails if claude-code-review.yml's checkout is not a full SHA with a `# vN` comment below v5.
- **Left on v4 on purpose:**
  - claude-code-review.yml: checkout pinned at v4.4.0 (`11d5960a326750d5838078e36cf38b85af677262`). v6+ persists the token via `includeIf.gitdir`, which claude-code-action does not clear.
  - claude.yml: now SHA-pinned at v4.4.0 (same SHA as claude-code-review.yml), same risk, per Boyce's decision.
  - conventions-check.yml: synced from conventions v1.3.0 (pinned SHAs); a bump would drift from the standard.
- **Decided (Boyce, via PR comment):** pin claude.yml at v4.4.0 (done); dependabot.yml ignore `actions/checkout >=5` with a comment pointing at claude-code-review.yml (done); Aside closes #27 after merge; conventions-check.yml pins stay until a conventions release.
- **Resume:** `git checkout chore/deps-actions-split`; run `npm ci && node .github/scripts/check-syntax.js && npm test && npm audit --audit-level=high`.
- **Not done (by design):** no edit to #27 from this branch, no merge (Aside merges and closes #27). The guard test still covers claude-code-review.yml only.
