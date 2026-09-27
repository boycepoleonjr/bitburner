# bitburner-agent

An autonomous Bitburner run. In-game scripts do the work. An AI agent supervises through a local bridge, so no
browser extension is needed, and it works with the Steam build and the browser build.

- **Agents: read [AGENTS.md](AGENTS.md) first.** It covers the vision, goals, the owner's rules, the architecture and the handoff.
- **Connecting the game:** see [docs/STEAM.md](docs/STEAM.md).

```
game (Steam/browser) ──Remote API ws──▶ bb server (127.0.0.1:12525) ◀──HTTP── agent / `npx bb`
          agent/rpc.js ──────ws /rpc──▶        │
                                               └─ save backups, file sync (game/ ⇄ in-game home)
```

| Path | What |
|---|---|
| `server/` | bb server (`npm start`), CLI (`npx bb ...`), sync and backups |
| `game/` | mirror of the in-game home server (`bb pull` / `bb push`). `game/agent/` is our code |
| `docs/` | setup and troubleshooting |
| `test/` | `npm test`: smoke test with a fake game |

Status: `game/agent/` is a partial snapshot. The first `npx bb pull` brings in the rest (autopilot, daemon, etc.), so commit after it.
