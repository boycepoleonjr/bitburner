/** agent/rpc.js — headless control bridge. Connects OUT to the local bb server (ws://127.0.0.1:<port>/rpc)
 * so any agent can drive the game without Claude in Chrome. Works in the browser build and the Steam (Electron) build.
 * Config comes from agent/rpc-config.txt ({port, token}), which the server pushes via the Remote API on connect.
 * Ops:  eval {code}  -> ns code (async fn body using `ns`), run as a one-shot job script (RAM is calculated per job)
 *       js   {code}  -> page-context JS (async fn body; window.bb from bridge-lite is available), like a browser console
 *       read {file} / write {file,data,mode} / note {msg} / ping
 * @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL");
  const CFG = "agent/rpc-config.txt", LOG = "/data/agent-log.txt";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const AsyncFn = Object.getPrototypeOf(async function () { }).constructor;
  let seq = 0, ws = null, stop = false;
  ns.atExit(() => { stop = true; try { ws && ws.close(); } catch { } });

  const evalNs = async (code, timeoutMs = 120000, host = "home") => {
    const id = `${Date.now()}-${++seq}`, file = `/agent/jobs/rpc-${id}.js`, out = `/agent/jobs/rpc-${id}.txt`;
    ns.write(file, `/** @param {NS} ns */\nexport async function main(ns){let r;try{r={ok:true,value:await (async()=>{\n${code}\n})()};}catch(e){r={ok:false,error:String(e&&e.message||e)};}\nns.write(${JSON.stringify(out)},JSON.stringify(r),"w");}`, "w");
    const pid = ns.exec(file, host, { threads: 1, temporary: true });
    if (!pid) { ns.rm(file); return { ok: false, error: `exec failed (needs ${ns.getScriptRam(file)}GB)` }; }
    const t0 = Date.now();
    while (ns.isRunning(pid) && Date.now() - t0 < timeoutMs) await sleep(50);
    if (ns.isRunning(pid)) { ns.kill(pid); ns.rm(file); return { ok: false, error: "timeout" }; }
    const txt = ns.read(out); ns.rm(file); ns.rm(out);
    return txt ? JSON.parse(txt) : { ok: false, error: "no output" };
  };

  const handle = async (m) => {
    switch (m.op) {
      case "ping": return { ok: true, value: { pid: ns.pid, t: Date.now() } };
      case "eval": return await evalNs(m.code, m.timeoutMs, m.host);
      case "js": try { return { ok: true, value: await new AsyncFn(m.code)() }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
      case "read": return { ok: true, value: ns.read(m.file) };
      case "write": ns.write(m.file, m.data, m.mode || "w"); return { ok: true, value: true };
      case "note": ns.write(LOG, `[${new Date().toISOString()}] ${m.msg}\n`, "a"); return { ok: true, value: true };
      default: return { ok: false, error: "unknown op " + m.op };
    }
  };

  // keep window.bb available for page-context code (checkin-lib etc.)
  if (!ns.isRunning("agent/bridge-lite.js", "home")) ns.run("agent/bridge-lite.js");

  while (!stop) {
    let cfg = null;
    try { cfg = JSON.parse(ns.read(CFG) || "null"); } catch { }
    if (!cfg) { ns.print("waiting for " + CFG + " (start the bb server + enable Remote API)"); await sleep(5000); continue; }
    await new Promise((resolve) => {
      try { ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/rpc?token=${encodeURIComponent(cfg.token)}`); } catch (e) { ns.print("ws error " + e); return resolve(); }
      ws.onopen = () => { ns.print("connected"); ws.send(JSON.stringify({ hello: true, pid: ns.pid })); };
      ws.onmessage = async (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        let r; try { r = await handle(m); } catch (e) { r = { ok: false, error: String(e) }; }
        let s; try { s = JSON.stringify({ id: m.id, ...r }); } catch (e) { s = JSON.stringify({ id: m.id, ok: false, error: "unserializable result: " + e }); }
        try { ws.send(s); } catch { }
      };
      ws.onclose = () => resolve();
      ws.onerror = () => { try { ws.close(); } catch { } };
    });
    if (!stop) await sleep(3000);
  }
}
