# GitHub setup

What the repo uses on GitHub, and the one-time settings that only the owner can switch on.

## What's in the repo

| File | What it does |
|---|---|
| `.github/workflows/ci.yml` | `npm test` + a parse check of every in-game script (`.github/scripts/check-syntax.js`) on every PR and every push to main. Check name: `test`. |
| `.github/workflows/monitor.yml` | Every 30 min: checks `/healthz` and the cached check-in (`/api/report`), and opens/closes issues: `incident` (game unreachable, check-ins stalled), `attention` and `owner-decision` (the latest check-in's attention items). All carry the `monitor` label; each one closes itself when the problem clears. Logic: `.github/scripts/monitor.js`, tests: `test/monitor.js`. |
| `.github/workflows/release.yml` | Push a tag (`bn5-destroyed`, `v2026.10.07`) or run it from the Actions tab: publishes a release with notes generated from merged PRs (`.github/release.yml` groups them by label). |
| `.github/workflows/repo-setup.yml` | Creates/updates the labels in `.github/labels.json` and milestones in `.github/milestones.json` (never deletes). Runs when either file changes on main, or by hand. |
| `.github/workflows/claude-review.yml` | Claude reviews every non-draft PR (bugs, AGENTS.md rules, security, missing tests). Skipped until a Claude secret is set. |
| `.github/workflows/claude.yml` | `@claude` in an issue, PR comment or review runs Claude on the request (owner/collaborators only). |
| `.github/dependabot.yml` | Weekly update PRs for npm, GitHub Actions and the Docker base image. |
| `.github/rulesets/main.json` | Branch ruleset for main, to import (below). |
| `.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/` | PR checklist (bb push / restart / note) and bug/task issue forms. |

## One-time settings (owner)

Do these after the PR that adds the files above is merged.

1. **Ruleset for main**: Settings → Rules → Rulesets → New ruleset → **Import a ruleset** → `.github/rulesets/main.json`.
   It blocks deleting and force-pushing main and requires a PR whose `test` check passed. Admins can merge a PR
   past the requirements in an emergency, but nobody pushes to main directly; agents work on a branch and open a PR.
2. **Railway: Wait for CI**: Railway → project bitburner → service game → Settings → Source → turn on **Wait for CI**
   (it appears once `ci.yml` is on main). Then a main commit deploys only after CI passes; a failed run skips the deploy.
   If the toggle is missing, accept the Railway GitHub App's updated permissions at https://github.com/settings/installations.
3. **Monitor secret**: Settings → Secrets and variables → Actions → New repository secret `BB_TOKEN` (same value as the
   Railway variable). Without it the monitor only checks `/healthz`. Optional variable `BB_URL` if the host changes.
   Then Actions → Monitor → Run workflow once to check it works.
4. **Secret scanning**: Settings → Advanced Security → make sure **Secret Protection** and **Push protection** are
   enabled (free on public repos). A full-history grep for common token patterns found nothing on 2026-10-07.
5. **Dependabot**: Settings → Advanced Security → enable **Dependabot alerts** and **Dependabot security updates**.
6. **Auto-delete branches**: Settings → General → Pull Requests → tick **Automatically delete head branches**.
   Also delete the two old merged branches once: `claude/daemon-lite-bn5`, `claude/upbeat-pascal-62e3hl`.
7. **Labels and milestones**: Actions → Repo setup → Run workflow (it also runs on its own when the merge touches
   the JSON files).
8. **Claude review and @claude**: install the Claude GitHub App on this repo (https://github.com/apps/claude, or
   `/install-github-app` in Claude Code), then add ONE repository secret: `CLAUDE_CODE_OAUTH_TOKEN` (run
   `claude setup-token`; bills your Claude subscription) or `ANTHROPIC_API_KEY`.

## Conventions

- Milestones track the AGENTS.md goals (BN5.1 bootstrap, BN5 destroyed, Ops & reliability); put issues and PRs on them.
- Label PRs `autopilot` / `server` / `predictor` / `bug` so release notes group them; `skip-changelog` hides one.
- Tag a release at each BitNode destroyed (`bnN-destroyed`) so there is always a known-good version to roll back to.
- Monitor issues are owned by the workflow: comment on them freely, but let it open and close them.
