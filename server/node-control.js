// Backup half of the BitNode-destroy handshake (game half: game/lib/nodectl.js). While the rpc bridge is up, polls the
// in-game data/node-request.txt; for each new {action:"destroy"} id it runs a save backup and writes data/node-ack.txt
// {id, backupOk, key, error?, at}. Acks are remembered per id (state/node-control.json), so a repeated id gets the same
// ack without a second backup. Cancel requests are recorded, never acted on. The server NEVER destroys anything:
// destruction is decided in-game from settings (node.autoDestroy) and only after this ack.
// Must stay in sync with game/lib/nodectl.js (test/node-control.js checks). Not imported: game modules use Bitburner's
// bare "lib/..." specifiers, which plain Node cannot resolve at runtime.
export const REQUEST_FILE = "data/node-request.txt";
export const ACK_FILE = "data/node-ack.txt";
const parseJson = (raw) => { try { const v = JSON.parse(raw || "null"); return v && typeof v === "object" && !Array.isArray(v) ? v : null; } catch { return null; } };

export const POLL_MS = 60 * 1000;
export const STATE_FILE = "node-control.json";
const KEEP = 50;

export function createNodeControl({ rpc, isUp, backup, state, log = () => {}, nowMs = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval, pollMs = POLL_MS }) {
  let timer = null, inflight = null, mem = null;
  const load = async () => (mem ??= (await state?.readJson(STATE_FILE, null)) || { acks: {}, cancels: {} });
  const save = async () => { if (state) await state.writeJsonAtomic(STATE_FILE, mem); };
  const writeAck = (ack) => rpc("write", { file: ACK_FILE, data: JSON.stringify(ack), mode: "w" });

  async function tick() {
    if (!isUp()) return { skipped: "rpc down" };
    const r = await rpc("read", { file: REQUEST_FILE });
    if (!r || r.ok === false) return { error: r?.error || "read failed" };
    const req = parseJson(r.value);
    if (!req || typeof req.id !== "string" || !req.id) return { idle: true };
    await load();
    if (req.action === "cancel") {
      if (!mem.cancels[req.id]) { mem.cancels[req.id] = nowMs(); trim(mem.cancels); await save(); log(`node-control: request ${req.id} cancelled in-game`); }
      return { cancelled: req.id };
    }
    if (req.action !== "destroy") return { ignored: req.action };
    const prev = mem.acks[req.id];
    if (prev) { // idempotent: re-write the same ack if the game lost it
      const cur = parseJson((await rpc("read", { file: ACK_FILE }))?.value);
      if (!cur || cur.id !== req.id) await writeAck(prev);
      return { ack: prev, repeated: true };
    }
    let ack;
    try {
      const b = await backup();
      ack = b && b.ok && b.bytes > 0 ? { id: req.id, backupOk: true, key: String(b.file || "").split("/").pop(), bytes: b.bytes, at: nowMs() }
        : { id: req.id, backupOk: false, error: "backup returned no file", at: nowMs() };
    } catch (e) { ack = { id: req.id, backupOk: false, error: String(e?.message || e).slice(0, 200), at: nowMs() }; }
    mem.acks[req.id] = ack; trim(mem.acks); await save();
    await writeAck(ack);
    log(`node-control: ${req.id} -> backup ${ack.backupOk ? `ok (${ack.key})` : `FAILED (${ack.error})`}`);
    return { ack };
  }
  const run = () => (inflight ??= tick().catch((e) => ({ error: e.message })).finally(() => { inflight = null; }));

  return {
    tick: run,
    start() { if (!timer) timer = setTimer(() => { run(); }, pollMs); return true; },
    stop() { if (timer) clearTimer(timer); timer = null; },
  };
}

/** GET /api/plan: parsed data/aug-plan.txt, or a 503 error when missing/invalid. */
export async function readPlan(rpc) {
  const r = await rpc("read", { file: "data/aug-plan.txt" });
  if (!r || r.ok === false) throw Object.assign(new Error(`could not read data/aug-plan.txt: ${r?.error ?? "no response"}`), { status: 502 });
  const plan = parseJson(r.value);
  if (!plan) throw Object.assign(new Error("no aug plan yet (agent/sl-plan.js writes data/aug-plan.txt every ~2 min)"), { status: 503 });
  return { ok: true, value: plan };
}

function trim(o) { const k = Object.keys(o); if (k.length > KEEP) for (const x of k.slice(0, k.length - KEEP)) delete o[x]; }
