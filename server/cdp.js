// Import a save into the hosted Chromium through the DevTools protocol (BB_CDP_PORT, localhost only).
// The game tab is navigated to a same-origin 404 page first, so the running game can't autosave over the import,
// then the save bytes are written to IndexedDB (bitburnerSave/savestring/"save") and the game is loaded again.
import WebSocket from "ws";

const GAME = "https://bitburner-official.github.io/";
const BLANK = GAME + "bb-import-blank"; // any same-origin URL works; GitHub Pages serves a 404 page

async function session(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === "page" && t.url.startsWith(GAME)) || targets.find((t) => t.type === "page");
  if (!page) throw new Error("no Chromium page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0; const waits = new Map(), events = [];
  ws.on("message", (d) => { const m = JSON.parse(d); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } else if (m.method) events.push(m); });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waits.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
  const loaded = async (url, ms = 30000) => { const t0 = Date.now(); for (;;) { const r = await send("Runtime.evaluate", { expression: "document.readyState + ' ' + location.href", returnByValue: true }).catch(() => null); if (r && r.result.value === "complete " + url) return r.result.value; if (Date.now() - t0 > ms) throw new Error("page load timeout"); await new Promise((s) => setTimeout(s, 300)); } };
  return { send, loaded, close: () => ws.close() };
}

export async function importSave(b64, port = Number(process.env.BB_CDP_PORT || 0)) {
  if (!port) throw new Error("import-save only works in the hosted container (BB_CDP_PORT unset)");
  const buf = Buffer.from(b64, "base64");
  if (!(buf.length > 1000 && buf[0] === 0x1f && buf[1] === 0x8b)) throw new Error("expected a .json.gz Bitburner save");
  const s = await session(port);
  try {
    await s.send("Page.navigate", { url: BLANK });
    await s.loaded(BLANK); // the game page must be gone before the write, or its autosave overwrites the import
    const code = `(async () => {
      const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const db = await new Promise((res, rej) => { const r = indexedDB.open("bitburnerSave"); r.onupgradeneeded = () => r.result.createObjectStore("savestring"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      await new Promise((res, rej) => { const t = db.transaction("savestring", "readwrite"); t.objectStore("savestring").put(u, "save"); t.oncomplete = res; t.onerror = () => rej(t.error); });
      db.close(); return u.length; })()`;
    const r = await s.send("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("IndexedDB write failed: " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    await s.send("Page.navigate", { url: GAME });
    return { ok: true, bytes: r.result.value };
  } finally { s.close(); }
}
