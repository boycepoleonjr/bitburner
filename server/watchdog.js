// Watchdog: proves the game bridge is alive (socket + 20 s ping) and restarts Chromium when it isn't.
// Bounded authority: at most two restart attempts per outage, then one escalation and probe-only until recovery.
import { spawn } from "node:child_process";
import { sanitize } from "./notify.js";

export const RESTART_WINDOW_MS = 30 * 60 * 1000;
export const PING_TIMEOUT_MS = 20 * 1000;
const FILE = "watchdog-state.json";
const fresh = () => ({ version: 1, downSince: null, restartTimes: [], backoffUntil: null, escalatedAt: null });

// Runs an allowlisted executable with argv (no shell). Resolves {started, exitCode, error}; never rejects.
export function spawnRestart(cmd, args, timeoutMs = 10000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    let child;
    try { child = spawn(cmd, args, { stdio: "ignore", shell: false }); }
    catch (e) { return resolve({ started: false, exitCode: null, error: sanitize(e) }); }
    const t = setTimeout(() => { try { child.kill(); } catch { } finish({ started: true, exitCode: null, error: "timeout" }); }, timeoutMs);
    child.on("error", (e) => finish({ started: false, exitCode: null, error: sanitize(e) }));
    child.on("exit", (code) => finish({ started: true, exitCode: code, error: null }));
  });
}

export function createWatchdog({
  isGameConnected, ping, restartBrowser, notifyText = async () => {}, escalate = async () => {}, checkin, state,
  log = () => {}, watchdogMin, nowMs = () => Date.now(), intervalMs = 60000,
}) {
  const minMs = watchdogMin * 60 * 1000;
  let s = null, ticking = false, handle = null;
  const bg = (p, what) => { Promise.resolve().then(p).catch((e) => log(`watchdog ${what}: ${sanitize(e)}`)); };
  const load = async () => {
    if (s) return s;
    const v = await state.readJson(FILE, null, { versioned: true });
    s = { ...fresh(), ...(v && typeof v === "object" ? v : {}), version: 1 };
    if (!Array.isArray(s.restartTimes)) s.restartTimes = [];
    return s;
  };
  const save = () => state.writeJsonAtomic(FILE, s);

  async function probe() {
    if (!isGameConnected()) return "rpc socket absent";
    try {
      const r = await ping();
      return r && r.ok !== false ? null : "rpc ping rejected";
    } catch (e) {
      log("watchdog ping: " + sanitize(e));
      return /timeout/i.test(String(e?.message || e)) ? "rpc ping timeout" : "rpc ping rejected";
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await load();
      const reason = await probe();
      const now = nowMs();
      if (!reason) {
        if (s.downSince != null) {
          // Only a real outage (past the threshold, or after a restart attempt) is announced; boot/reconnect blips clear quietly.
          const outage = s.restartTimes.length > 0 || now - s.downSince >= minMs;
          s = fresh(); await save();
          if (outage) {
            log("watchdog: recovered");
            bg(() => notifyText("watchdog: recovered"), "notify");
            bg(() => checkin?.run({ manual: false }), "recovery check-in");
          }
        }
        return;
      }
      if (s.downSince == null) { s.downSince = now; await save(); return; } // first detection: quiet
      if (s.escalatedAt != null) return; // probe-only until recovery
      if (now - s.downSince < minMs) return;
      if (s.backoffUntil != null && now < s.backoffUntil) return;
      const attempts = s.restartTimes.filter((t) => t >= s.downSince && now - t < RESTART_WINDOW_MS);
      const last = attempts.length ? attempts[attempts.length - 1] : null;
      if (last != null && now - last < minMs) return; // give the last restart time to recover
      if (attempts.length >= 2) {
        s.escalatedAt = now; s.backoffUntil = now + RESTART_WINDOW_MS; await save();
        log(`watchdog: still down after 2 browser restarts (${reason}); escalating`);
        bg(() => notifyText(`watchdog: game down after 2 browser restarts (${reason})`), "notify");
        bg(() => escalate(`Bitburner escalation\n\nWatchdog: game down after 2 browser restarts (${reason}). Down since ${new Date(s.downSince).toISOString()}.`), "escalate");
        return;
      }
      s.restartTimes = [...attempts, now];
      await save(); // persisted before the restart so a crash can't cause a restart loop
      log(`watchdog: restarting Chromium (${reason})`);
      bg(() => notifyText(`watchdog: restarting Chromium (${reason})`), "notify");
      const r = await restartBrowser();
      if (r?.exitCode === 0) log("watchdog: restart signal sent");
      else if (r?.exitCode === 1) log("watchdog: no Chromium process matched");
      else log(`watchdog: restart command failed (${r?.error ? sanitize(r.error) : "exit " + r?.exitCode})`);
    } catch (e) {
      log("watchdog tick: " + sanitize(e));
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    start() { if (minMs > 0 && !handle) { handle = setInterval(tick, intervalMs); handle.unref?.(); } return !!handle; },
    stop() { if (handle) clearInterval(handle); handle = null; },
    _state: () => s,
  };
}
