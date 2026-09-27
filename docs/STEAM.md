# Connecting the game (Steam or browser) to the bb server

## 1. Start the server (on the machine running the game)
```sh
git clone https://github.com/boycepoleonjr/bitburner.git && cd bitburner
npm install
npm start            # listens on 127.0.0.1:12525, creates .bb-token
```
Optional environment variables:
- `BB_PORT`: default 12525.
- `BB_BACKUP_DIR`: e.g. `~/Documents/Bitburner/MySaves`.
- `BB_BACKUP_MIN`: backup interval in minutes, default 60; 0 turns backups off.

## 2. Point the game at it
In Bitburner, open Options → Remote API:
- Hostname: `localhost`. Port: `12525`. Leave `wss` unchecked.
- Click Connect. The server log should print `game connected (Remote API)`.

This works the same in the Steam build (Electron) and in bitburner-official.github.io.
- Browser note: Chrome allows an https page to open `ws://localhost`. If it's blocked, check extensions and privacy settings.
- Use one game instance at a time. If the Steam build and the browser tab are both open, they are two separate saves.

## 3. Start the in-game bridge (once; post-install restarts it after installs)
In the game terminal:
```
run agent/rpc.js
```
The server log should print `rpc bridge connected`. Then:
```sh
npx bb status        # {"game":true,"rpc":true}
npx bb checkin       # the standard check-in report
npx bb pull          # mirror game files into ./game, then commit
```

## Troubleshooting
| Symptom | Check |
|---|---|
| `game:false` | Remote API port matches BB_PORT. Server is running. Firewall allows localhost. In the Steam build, click Connect again after restarting the server. |
| `game:true, rpc:false` | Is `agent/rpc.js` running (`ps` in the game terminal)? It waits for `agent/rpc-config.txt`, which the server pushes on connect. The tail of rpc.js shows its status. |
| `401 bad token` | CLI and server must share the repo's `.bb-token`. Run the CLI from the repo folder. |
| eval `exec failed` | Not enough free RAM on home for the job script. Lower `homeReserveGb`, or free RAM. |
| checkin fails on Steam | checkin-lib's browser-only parts (IndexedDB backup, folder export) may warn. Server-side `bb backup` replaces them. |
| Steam save location | Windows: `%APPDATA%/bitburner/`. macOS: `~/Library/Application Support/bitburner/`. Backups via `bb backup` are the portable option. |

## Security
- The server binds to 127.0.0.1 only.
- HTTP and the rpc socket require the random token in `.bb-token`, which is gitignored.
- `bb js` and `bb eval` run arbitrary code in your game. Treat the token like a password.
