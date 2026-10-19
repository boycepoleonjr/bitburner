## What changed
<!-- One or two lines: what and why. -->

## Why
<!-- Link the issue or spec. -->

## Where it runs
- [ ] In-game (`game/`) — after merge: `bb push <files>`, restart the script, `bb note` what changed
- [ ] Hosted server / container (`server/`, `deploy/`, `Dockerfile`) — Railway redeploys main after CI passes
- [ ] Docs / tooling only

## Checks
- [ ] `npm test` passes (CI runs it too)
- [ ] `bb pull` done before editing in-game files (no newer in-game changes overwritten)
- [ ] Follows the owner's standing rules in AGENTS.md (aug order, NeuroFlux last, never touch saves / game options)
- [ ] No tokens, webhook URLs or passwords in the diff

## Commands run
| Command | Result |
|---|---|
| install (`npm ci`) | |
| test (`npm test`) | |
| audit (`npm audit --audit-level=high`) | |

## Risk
<!-- low / medium / high, and what could break: game loop, in-game money/RAM, saves/backups, auth, deploy, dependencies -->

## Needs a decision
<!-- Anything the reviewer must decide before merge. "None" if nothing. -->
