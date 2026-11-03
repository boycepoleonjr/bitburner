# Handoff 2026-11-02: split bump of actions/checkout and actions/setup-node

- **State:** draft PR from `chore/deps-actions-split` replaces Dependabot #27 (left open; owner closes it).
- **Done:** `actions/checkout` 4 -> 7 and `actions/setup-node` 4 -> 7 in ci.yml, monitor.yml, release.yml, repo-setup.yml, using the same `@v7` refs as #27 (the hunks match #27's for those four files). New guard `test/workflow-checkout-pin.js` fails if claude-code-review.yml's checkout is not a full SHA with a `# vN` comment below v5.
- **Left on v4 on purpose:**
  - claude-code-review.yml: checkout pinned at v4.4.0 (`11d5960a326750d5838078e36cf38b85af677262`). v6+ persists the token via `includeIf.gitdir`, which claude-code-action does not clear.
  - claude.yml: floating `actions/checkout@v4` next to claude-code-action, same risk. Not changed here.
  - conventions-check.yml: synced from conventions v1.3.0 (pinned SHAs); a bump would drift from the standard.
- **Open decisions:** see "Needs Boyce's decision" in the PR (claude.yml, dependabot.yml ignore rules, #27 disposition, conventions repo bump).
- **Resume:** `git checkout chore/deps-actions-split`; run `npm ci && node .github/scripts/check-syntax.js && npm test && npm audit --audit-level=high`.
- **Not done (by design):** no dependabot.yml change, no edit to #27, no merge.
