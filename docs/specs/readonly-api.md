# Spec: read-only token for the supervisor routine (2026-11-13)

Owner decision 2026-11-02 (ledger F-010, raised by a reviewer note on #32): the read-only rule for the hourly supervisor routine must be enforced by the bb server, not only by the prompt text.

## Problem
The routine reaches `https://game-production-0b2d.up.railway.app/api` through the cloud environment's proxy, which injects the full `BB_TOKEN`. With that token `POST /api/eval` runs arbitrary ns code in the game (and `/api/js`, `/api/write`, `/api/settings`, `/api/push` ... all work). "Read-only" was a sentence in `docs/feedback/routine-prompt.md`.

## Design
A second bearer token, class `readonly`, checked in `server/index.js` before routing:

| Token | Reaches |
|---|---|
| full (`BB_TOKEN`, unchanged) | every route, as before |
| readonly | only `READONLY_ROUTES` in `server/readonly.js`; every other route (including unknown ones) answers 403 `read-only token: route not allowed` |
| anything else | 401, as before |

Allowed for the read-only token:
- `GET /api/status`, `/api/drift`, `/api/report`, `/api/settings`, `/api/plan`, `/api/dashboard` (cached or derived state; `drift` runs one hashing eval the server builds itself).
- `POST /api/ro/read` `{file, tailLines?}`: one `data/<name>.txt` file. Anything else (`agent/rpc-config.txt`, which holds the full token, other directories, `..`, absolute paths) is 400. `data/telemetry.txt` needs `tailLines`; output is capped at 2 MB (the end is kept) and `truncated` says so.
- `POST /api/ro/query` `{query, ...ints}`: a fixed server-side ns snippet chosen by name: `resetInfo`, `homeRam`, `files` (data file sizes), `predCoverage` (`n`, 1 to 1000, default 200). The caller never supplies code. `test/readonly-api.js` fails if a snippet calls an ns function that is not on `ALLOWED_NS` or touches a browser global.

The full token can also call `/api/ro/*`.

## The token
- **Generated server-side**: on first start the server writes 32 random bytes (hex) to `<BB_STATE_DIR>/readonly-token`, mode 0600, atomically. On Railway `BB_STATE_DIR=/data/state`, so the file is `/data/state/readonly-token` on the volume and survives redeploys. The server never logs the value (startup logs only "read-only API: enabled (token generated into <path>)" or "read from").
- **Override**: set the Railway secret variable `BB_READONLY_TOKEN` (at least 32 characters, different from `BB_TOKEN`); it wins over the file.
- **Off**: `BB_READONLY=0` disables the class (its token then gets 401). A too-short, equal-to-full or unreadable token also disables the class and logs why, never the value.
- **Rotate**: delete the file (or change the variable) and restart the service; the old value stops working at once.
- **Handing it to the routine**: the owner reads the file privately on the service (for example in a Railway shell) and stores it as a secret in the routine's environment. It is never put in the repo, a prompt, a log or chat. Agents must not go looking for it.
- **Proxy note**: the cloud proxy injects the full token only when the client sends no `Authorization` header (see the comment on `cliAuthHeader` in `server/config.js`). The routine must send `Authorization: Bearer <read-only token>` itself; confirm with one call that returns 200 on `/api/status` and 403 on `POST /api/eval` before relying on it.

## Not done here (needs the owner)
- `docs/feedback/routine-prompt.md` is unchanged on purpose (the owner wants to approve it as written before it is pasted into claude.ai). It still tells the routine to use `POST /api/eval` with proxy auth. Until a follow-up changes it to send the read-only token to `/api/ro/read` and `/api/ro/query`, the routine still holds the full token and this guarantee is not in effect for it.
- The token has to be created on the live service (a deploy of this change does it on first start) and placed in the routine's environment.

## Tests
`test/readonly-api.js` (20 checks): token loader (off, env, short, equal to full, generated 0600 and reused, unwritable dir), `tokenClass`, the exact allowlist and a list of denied mutating routes, path rules, tail and size caps, query snippet allowlist and compilation, `predCoverage` behaviour, and a real server with a fake rpc socket: the read-only token gets 403 on every mutating route and no mutating op reaches the game, the full token keeps eval, a generated token is stored 0600, reused after restart and never appears in the server output.

## Risks
- A bug in the allowlist could widen the token: it is deny by default and the test lists the allowed routes exactly.
- The read-only token can read `data/*.txt`, which holds logs and settings but no credentials (the full token is only in `agent/rpc-config.txt`, which is refused).
