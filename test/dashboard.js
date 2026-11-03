// Dashboard: render smoke with a fake React (records createElement, evaluates components), design-rule checks against
// lib/ui/tokens.js, controller data/actions with a fake ns, and static checks on the in-game import graph (RAM, timers).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { importGame, fakeFsNs, GAME } from "./helpers/game-import.js";
import { SCHEMA, GROUPS, SETTINGS_FILE, SETTINGS_LOG } from "../game/lib/settings-schema.js";
import { SPACE_SCALE, RADIUS, TYPE_SIZES, ACCENT_VALUES } from "../game/lib/ui/tokens.js";
import { CONTROL_FOR_UI } from "../game/lib/ui/settings-model.js";
import { createStore } from "../game/lib/ui/store.js";
import { NOW, latest, ring, autopilot, ramStatus, augPlan, pred2Tail } from "./fixtures/dashboard-data.js";
import { fresh } from "./helpers/aug-cases.js";
import * as MODEL from "../game/lib/ui/augorder-model.js";
import { buildCatalog, ORDER_KEYS } from "../game/lib/augorder.js";

const { createViews, SECTIONS } = await importGame("lib/ui/views.js");
const { createController } = await importGame("lib/ui/controller.js");
const { tailSize } = await importGame("dashboard.js");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------- fake React ----------------
function fakeReact() {
  const calls = [];
  class Component { constructor(p) { this.props = p; this.state = {}; } setState() {} }
  const R = {
    calls, Component, Fragment: "Fragment",
    createElement(type, props, ...children) {
      const p = { ...(props || {}) };
      const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);
      if (kids.length) p.children = kids.length === 1 ? kids[0] : kids;
      const el = { type, props: p };
      calls.push(el);
      return el;
    },
    memo: (f) => { const m = (p) => f(p); m.memoized = true; return m; },
    useState: (i) => [typeof i === "function" ? i() : i, () => {}],
    useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f, useRef: (v) => ({ current: v }),
  };
  return R;
}
/** Evaluate function/class components down to host elements: {type: "div", props, kids: [...]}. */
function render(el) {
  if (el === null || el === undefined || el === false || el === true) return null;
  if (Array.isArray(el)) return el.map(render).filter((x) => x !== null);
  if (typeof el !== "object") return String(el);
  const { type, props } = el;
  if (typeof type === "function") {
    if (type.prototype && type.prototype.render) { const inst = new type(props); return render(inst.render()); }
    return render(type(props));
  }
  const kids = props.children === undefined ? [] : [].concat(props.children);
  return { type, props, kids: kids.map(render).flat(Infinity).filter((x) => x !== null) };
}
function* walk(n) { if (!n || typeof n !== "object") return; if (Array.isArray(n)) { for (const x of n) yield* walk(x); return; } yield n; for (const k of n.kids || []) yield* walk(k); }
const all = (tree, pred) => [...walk(tree)].filter(pred);
const text = (tree) => [...(function* t(n) { if (typeof n === "string") yield n; else if (n && typeof n === "object") for (const k of (Array.isArray(n) ? n : n.kids || [])) yield* t(k); })(tree)].join(" ");

// ---------------- harness ----------------
function files(extra = {}) {
  return {
    "data/telemetry-latest.txt": JSON.stringify({ ...latest, t: NOW - 20000 }), "data/telemetry-ring.txt": ring.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "data/ram-status.txt": JSON.stringify(ramStatus), "data/aug-plan.txt": JSON.stringify(augPlan), "data/autopilot-status.txt": JSON.stringify(autopilot),
    "data/pred2.txt": pred2Tail.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "data/agent-log.txt": "[2026-10-08T10:54:38.880Z] checkin(auto): ok\n[2026-10-08T11:00:00.000Z] second line\n",
    "data/events.txt": "08:30:49 [autopilot] home RAM 33554432GB -> 67108864GB\n",
    "data/audit.txt": '{"t":1791298693417,"kind":"flags","flags":["x"]}\n', "data/install-log.txt": '{"t":1790785904960,"why":"6 augs buyable"}\n',
    "data/telemetry.txt": "MUST NOT BE READ", ...extra,
  };
}
function harness({ fileSet = files(), now = NOW } = {}) {
  const ns = fakeFsNs(fileSet);
  const reads = {};
  const read0 = ns.read;
  ns.read = (f) => { const k = f.replace(/^\//, ""); reads[k] = (reads[k] || 0) + 1; return read0(f); };
  const store = createStore();
  const ctl = createController(ns, store, { now: () => now, clock: () => 0 });
  const R = fakeReact();
  const V = createViews(R, { schema: SCHEMA, groups: GROUPS });
  const view = (id, extra = {}) => { store.ui({ view: id, ...extra }); ctl.tick(); return render(R.createElement(V.App, { store, actions: ctl.actions })); };
  return { ns, reads, store, ctl, R, V, view };
}

// ---------------- layout ----------------
test("every view: persistent sidebar + workspace, one dominant h1, at most one primary action, in the header", () => {
  const H = harness();
  for (const s of SECTIONS) {
    const tree = H.view(s.id);
    assert.equal(all(tree, (n) => n.props["data-role"] === "sidebar").length, 1, `${s.id} sidebar`);
    assert.equal(all(tree, (n) => n.props["data-role"] === "workspace").length, 1, `${s.id} workspace`);
    assert.equal(all(tree, (n) => n.type === "h1").length, 1, `${s.id} single h1`);
    const prim = all(tree, (n) => n.props["data-kind"] === "primary");
    assert.ok(prim.length <= 1, `${s.id} primary count ${prim.length}`);
    if (prim.length) { const header = all(tree, (n) => n.type === "header")[0]; assert.ok([...walk(header)].includes(prim[0]), `${s.id} primary in header`); }
    const nav = all(tree, (n) => n.props["data-nav"]);
    assert.equal(nav.length, SECTIONS.length);
    assert.equal(nav.filter((n) => n.props["data-accent"] === "selected").map((n) => n.props["data-nav"]).join(), s.id, `${s.id} selected nav`);
  }
});
test("selecting a record opens its detail alongside the list (and only then)", () => {
  const H = harness();
  const cases = [["overview", "destroy"], ["ram", "ecorp"], ["augs", 1], ["pred", "a2"], ["settings", "strategy.mid"]];
  for (const [v, id] of cases) {
    const without = H.view(v, { sel: {} });
    assert.equal(all(without, (n) => n.props["data-role"] === "detail").length, 0, `${v} no detail without selection`);
    const withSel = H.view(v, { sel: { [v]: id } });
    const det = all(withSel, (n) => n.props["data-role"] === "detail");
    assert.equal(det.length, 1, `${v} detail with selection`);
    const sel = all(withSel, (n) => n.props["data-accent"] === "selected" && !n.props["data-nav"] && n.props["data-control"] !== "toggle" && n.props.type !== "range");
    assert.ok(sel.length >= 1, `${v} selected record highlighted`);
  }
  // logs: the controller loads tails while Logs is open
  H.ctl.actions.refresh();
  let t = H.view("logs", { sel: {} });
  assert.match(text(t), /checkin\(auto\): ok/);
  t = H.view("logs", { sel: { logs: 0 } });
  assert.equal(all(t, (n) => n.props["data-role"] === "detail").length, 1);
  // raw: the selected file is read and shown as a tree, KPI field highlighted
  t = H.view("raw", { rawFile: "data/aug-plan.txt", rawField: "worldDaemon" });
  assert.equal(all(t, (n) => n.props["data-role"] === "detail").length, 1);
  assert.match(text(t), /worldDaemon/);
});
test("overview: KPI detail lists raw sources; destroy tile is the large one; attention shows READY", () => {
  const H = harness();
  const t = H.view("overview", { sel: { overview: "destroy" } });
  const tiles = all(t, (n) => n.props["data-kpi"]);
  assert.equal(tiles.length, 9);
  assert.equal(tiles[0].props.style.gridColumn, "span 2");
  assert.match(text(t), /READY · awaiting decision/);
  assert.match(text(t), /data\/aug-plan\.txt/);
  assert.match(text(t), /w0r1d_d43m0n READY/);
});

// ---------------- settings ----------------
test("settings: one control per schema key, control type from the schema ui hint", () => {
  const H = harness();
  const t = H.view("settings");
  const rows = all(t, (n) => n.props["data-setting"]);
  assert.equal(rows.length, SCHEMA.length);
  for (const f of SCHEMA) {
    const row = rows.find((r) => r.props["data-setting"] === f.key);
    assert.ok(row, f.key);
    assert.equal(row.props["data-control-type"], CONTROL_FOR_UI[f.ui], f.key);
    assert.equal(all(row, (n) => n.props["data-control"] === CONTROL_FOR_UI[f.ui]).length, 1, `${f.key} renders a ${f.ui}`);
  }
  // slider end labels (money <-> faction rep)
  const early = rows.find((r) => r.props["data-setting"] === "strategy.early");
  assert.match(text(early), /Money.*Faction rep/);
});
test("settings: writes go through writeSettings as 'ui'; invalid shows inline error; reset + reset-all (two-step)", () => {
  const H = harness();
  const a = H.ctl.actions;
  assert.equal(a.saveSetting("strategy.mid", "0.3").ok, true);
  assert.equal(JSON.parse(H.ns.files[SETTINGS_FILE]).values["strategy.mid"], 0.3);
  assert.match(H.ns.files[SETTINGS_LOG], /"by":"ui"/);
  assert.equal(H.store.get("settings").values["strategy.mid"], 0.3, "settings slice refreshed immediately");
  assert.equal(a.saveSetting("strategy.mid", 5).ok, false);
  let t = H.view("settings");
  const err = all(t, (n) => n.props["data-error"] === "strategy.mid");
  assert.equal(err.length, 1);
  assert.match(text(err[0]), /must be <= 1/);
  assert.equal(JSON.parse(H.ns.files[SETTINGS_FILE]).values["strategy.mid"], 0.3, "invalid value not written");
  assert.equal(a.saveSetting("node.order", "3,10").ok, true);
  assert.equal(a.saveSetting("node.autoDestroy", true).ok, true);
  assert.equal(a.resetSetting("node.autoDestroy").ok, true);
  assert.equal("node.autoDestroy" in JSON.parse(H.ns.files[SETTINGS_FILE]).values, false);
  assert.equal(a.resetAll().armed, true);
  t = H.view("settings");
  assert.match(text(t), /Confirm reset of 2/);
  a.resetAll();
  assert.deepEqual(JSON.parse(H.ns.files[SETTINGS_FILE]).values, {});
  H.ctl.stop();
  assert.equal(a.saveSetting("strategy.mid", 0.1).ok, false, "no ns calls after the script stops");
});

// ---------------- design rules ----------------
const SPACING = /^(margin|padding)(Top|Right|Bottom|Left)?$|^(gap|rowGap|columnGap)$/;
const nums = (v) => (typeof v === "number" ? [v] : String(v).match(/-?\d+(\.\d+)?(?=px)/g)?.map(Number) || []);
test("design tokens: spacing scale, radii <= 4, type scale, no shadows/animation, accent only on primary/selected/focus", () => {
  const H = harness();
  const radii = new Set(Object.values(RADIUS));
  let checked = 0;
  for (const s of SECTIONS) {
    for (const sel of [{}, { [s.id]: s.id === "ram" ? "ecorp" : s.id === "augs" ? 1 : s.id === "settings" ? "strategy.mid" : s.id === "overview" ? "destroy" : null }]) {
      const tree = H.view(s.id, { sel });
      for (const n of walk(tree)) {
        const st = n.props.style || {};
        for (const [k, v] of Object.entries(st)) {
          checked++;
          if (SPACING.test(k)) for (const x of nums(v)) assert.ok(SPACE_SCALE.includes(x), `${s.id}: ${k}=${v} not on the spacing scale`);
          if (k === "borderRadius") assert.ok(radii.has(v), `${s.id}: borderRadius ${v}`);
          if (k === "fontSize") assert.ok(TYPE_SIZES.includes(v), `${s.id}: fontSize ${v}`);
          assert.ok(!/shadow/i.test(k), `${s.id}: ${k} (no shadows)`);
          assert.ok(!/^animation/.test(k), `${s.id}: ${k} (no continuous animation)`);
          if (k === "transition") for (const ms of String(v).match(/\d+(?=ms)/g) || []) assert.ok(Number(ms) <= 200, `${s.id}: transition ${v}`);
          if (typeof v === "string" && ACCENT_VALUES.some((c) => v.includes(c)))
            assert.ok(["primary", "selected", "focus"].includes(n.props["data-accent"]), `${s.id}: accent on <${n.type}> ${k} without data-accent`);
        }
      }
    }
  }
  assert.ok(checked > 500, `checked ${checked} style values`);
});

// ---------------- missing files ----------------
test("missing files: every view renders an empty state instead of crashing", () => {
  const H = harness({ fileSet: {} });
  for (const s of SECTIONS) {
    const t = H.view(s.id);
    assert.equal(all(t, (n) => n.props["data-role"] === "sidebar").length, 1);
    if (["ram", "augs", "pred", "logs"].includes(s.id)) assert.ok(all(t, (n) => n.props["data-role"] === "empty").length >= 1, `${s.id} empty state`);
  }
  assert.match(text(H.view("ram")), /ram-status\.txt not found/);
  assert.match(text(H.view("augs")), /aug-plan\.txt not found/);
});

// ---------------- performance: reads and re-renders ----------------
test("controller: hot path reads only small files; never telemetry.txt; slow files on cadence and only when visible", () => {
  let now = NOW;
  const ns = fakeFsNs(files());
  const reads = {};
  const read0 = ns.read; ns.read = (f) => { const k = f.replace(/^\//, ""); reads[k] = (reads[k] || 0) + 1; return read0(f); };
  const store = createStore();
  const ctl = createController(ns, store, { now: () => now, clock: () => 0 });
  ctl.tick(); ctl.tick();
  assert.equal(reads["data/telemetry.txt"], undefined);
  assert.equal(reads["data/pred2.txt"], 1, "pred2 once per slow interval");
  assert.equal(reads["data/agent-log.txt"], undefined, "logs not read while Logs is closed");
  assert.equal(reads["data/telemetry-latest.txt"], 2);
  now += 30000; ctl.tick();
  assert.equal(reads["data/pred2.txt"], 2);
  store.ui({ view: "logs" }); ctl.actions.refresh(); ctl.tick();
  assert.equal(reads["data/agent-log.txt"], 1);
});
test("controller: an unchanged tick changes no data slice (React.memo panels skip rendering)", () => {
  const H = harness();
  H.ctl.tick();
  const notified = [];
  for (const k of ["kpis", "ring", "ramStatus", "augPlan", "autopilot", "settings", "pred"]) H.store.subscribe(k, () => notified.push(k));
  assert.deepEqual(H.ctl.tick(), []);
  assert.deepEqual(notified, []);
  H.ns.files["data/ram-status.txt"] = JSON.stringify({ ...ramStatus, usableGb: 1 });
  const ch = H.ctl.tick();
  assert.ok(ch.includes("ramStatus"));
  assert.ok(!ch.includes("ring") && !ch.includes("augPlan") && !ch.includes("settings"), ch.join());
});
test("controller.wait: never sleeps below 250 ms; wakes early on refresh", async () => {
  const H = harness();
  const slept = [];
  H.ns.files[SETTINGS_FILE] = JSON.stringify({ version: 1, rev: 1, values: { "ui.refreshMs": 1000 } });
  await H.ctl.wait(async (ms) => { slept.push(ms); });
  assert.equal(slept.length, 4);
  assert.ok(slept.every((ms) => ms >= 250));
  slept.length = 0;
  H.ctl.actions.refresh();
  await H.ctl.wait(async (ms) => { slept.push(ms); });
  assert.equal(slept.length, 0);
});
test("store: identical values do not notify; ui patches merge", () => {
  const s = createStore();
  let n = 0; s.subscribe("x", () => n++);
  s.set({ x: { a: 1 } }); s.set({ x: { a: 1 } }); s.set({ x: { a: 2 } });
  assert.equal(n, 2);
  s.ui({ view: "ram" });
  assert.equal(s.get("ui").view, "ram");
  assert.equal(s.get("ui").logTab, "agent");
});
test("tailSize: 80% of the game window, at least 900x600", () => {
  assert.deepEqual(tailSize([2000, 1000]), [1600, 800]);
  assert.deepEqual(tailSize([800, 500]), [900, 600]);
  assert.deepEqual(tailSize(undefined), [960, 640]);
});

// ---------------- static: the in-game import graph ----------------
function importGraph(entry) {
  const seen = new Map(), q = [path.join(GAME, entry)];
  while (q.length) {
    const f = q.shift();
    if (seen.has(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    seen.set(f, src);
    for (const m of src.matchAll(/\bfrom\s+"([^"]+)"/g)) q.push(m[1].startsWith(".") ? path.resolve(path.dirname(f), m[1]) : path.join(GAME, m[1]));
  }
  return seen;
}
const stripStrings = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, " ");
test("static: dashboard import graph has no DOM globals, no timers, only allowlisted RAM-costing identifiers", () => {
  const graph = importGraph("dashboard.js");
  const rel = (f) => path.relative(GAME, f);
  assert.ok([...graph.keys()].map(rel).includes("lib/ui/views.js"));
  const costly = new Set(JSON.parse(fs.readFileSync(new URL("./fixtures/ns-costly-names.json", import.meta.url), "utf8")));
  const ALLOWED = new Set(["ps", "getRunningScript"]); // 0.2 + 0.3 GB: single-instance check and tail-open check
  for (const [f, src] of graph) {
    const code = stripStrings(src);
    const ids = new Set(code.match(/[A-Za-z_$][\w$]*/g) || []);
    for (const bad of ["window", "document", "setInterval", "setTimeout", "requestAnimationFrame"]) assert.ok(!ids.has(bad), `${rel(f)} uses ${bad}`);
    const hits = [...ids].filter((id) => costly.has(id) && !ALLOWED.has(id));
    assert.deepEqual(hits, [], `${rel(f)} has RAM-costing identifiers (rename or use bracket access): ${hits.join(", ")}`);
  }
  const est = 1.6 + 0.2 + 0.3;
  assert.ok(est <= 3.0, `estimated dashboard RAM ${est} GB`);
});
test("static: every sleep in the dashboard loop is >= 250 ms (literal or clampMs)", () => {
  for (const f of ["dashboard.js", "lib/ui/controller.js"]) {
    const src = fs.readFileSync(path.join(GAME, f), "utf8");
    for (const m of src.matchAll(/sleep\(([^)]*)\)/g)) {
      const arg = m[1].trim();
      if (arg === "ms" || arg === "") continue; // the injected sleep passthrough (dashboard.js) and signatures
      assert.ok(/^clampMs\(/.test(arg) || Number(arg) >= 250, `${f}: sleep(${arg})`);
    }
  }
});

// ---------------- Augmentations → Order (docs/specs/aug-order.md) ----------------
const CATALOG = () => ({ t: NOW, ...buildCatalog(fresh()) });
const catFiles = (extra = {}) => files({ "data/aug-catalog.txt": JSON.stringify(CATALOG()), ...extra });
const logLines = (H) => (H.ns.files[SETTINGS_LOG] || "").split("\n").filter(Boolean);
const emptyDraft = () => MODEL.draftFromSettings({});
const orderView = (H) => { H.store.ui({ augsTab: "order" }); return H.view("augs", { augsTab: "order" }); };
test("augs: Path is the default tab; the tab switch is a store action and Order is a second tab", () => {
  const H = harness({ fileSet: catFiles() });
  const t = H.view("augs");
  assert.equal(H.store.get("ui").augsTab, "path");
  const tabs = all(t, (n) => n.props.role === "tab");
  assert.deepEqual(tabs.map((n) => text(n)), ["Path", "Order"]);
  assert.equal(tabs.filter((n) => n.props["aria-selected"]).map((n) => text(n)).join(), "Path");
  assert.match(text(t), /ordered purchase \/ install plan/);
  H.ctl.actions.setAugsTab("order");
  assert.equal(H.store.get("ui").augsTab, "order");
  H.ctl.actions.setAugsTab("bogus");
  assert.equal(H.store.get("ui").augsTab, "path");
});
test("augs Order tab: renders with no catalog (empty state, controls still there) and with a full catalog", () => {
  const none = harness();
  let t = orderView(none);
  assert.equal(all(t, (n) => n.type === "h1").length, 1);
  assert.match(text(t), /data\/aug-catalog\.txt not found/);
  assert.equal(all(t, (n) => n.props["data-kind"] === "primary").length, 1, "Apply order is the single primary, in the header");
  const full = harness({ fileSet: catFiles() });
  t = orderView(full);
  const rows = all(t, (n) => n.type === "tr" && n.props["data-row"]);
  assert.equal(rows.length, Object.keys(fresh().augs).filter((a) => !a.startsWith("NeuroFlux")).length);
  assert.match(text(t), /Apply order/); assert.match(text(t), /Discard/); assert.match(text(t), /Reset to default/); assert.match(text(t), /no changes/);
  assert.match(text(t), /NeuroFlux Governor is always bought last/);
  const header = all(t, (n) => n.type === "header")[0];
  assert.ok([...walk(header)].some((n) => n.props["data-kind"] === "primary"), "primary lives in the header");
  assert.ok(!rows.some((r) => r.props["data-row"].startsWith("NeuroFlux")), "NeuroFlux is not orderable, so not listed");
  for (const r of rows) assert.equal(r.props.tabIndex, 0, "rows are focusable for k/j/p/x");
});
test("augs Order tab: design rules hold (spacing scale, radii, type sizes, accent only on primary/selected/focus)", () => {
  const H = harness({ fileSet: catFiles() });
  for (const t of [orderView(H), orderView(harness())]) for (const n of walk(t)) for (const [k, v] of Object.entries(n.props.style || {})) {
    if (SPACING.test(k)) for (const x of nums(v)) assert.ok(SPACE_SCALE.includes(x), `${k}=${v} not on the spacing scale`);
    if (k === "borderRadius") assert.ok(Object.values(RADIUS).includes(v), `radius ${v}`);
    if (k === "fontSize") assert.ok(TYPE_SIZES.includes(v), `fontSize ${v}`);
    assert.ok(!/shadow|^animation/i.test(k), k);
    if (typeof v === "string" && ACCENT_VALUES.some((c) => v.includes(c))) assert.ok(["primary", "selected", "focus"].includes(n.props["data-accent"]), `accent on <${n.type}> ${k}`);
  }
});
test("augs Order tab: The Red Pill's Exclude button is disabled with a tooltip; others are enabled", () => {
  const H = harness({ fileSet: catFiles() });
  const t = orderView(H);
  const ex = all(t, (n) => n.type === "button" && text(n) === "Exclude");
  assert.ok(ex.length > 5);
  const dis = ex.filter((n) => n.props.disabled);
  assert.equal(dis.length, 1);
  assert.equal(dis[0].props.title, "The Red Pill cannot be excluded");
  const row = all(t, (n) => n.type === "tr" && n.props["data-row"] === "The Red Pill")[0];
  assert.ok([...walk(row)].includes(dis[0]), "it sits in The Red Pill's row");
});
test("augs Order tab: row keys call stopPropagation (game hotkeys stay out) but let Escape through", () => {
  const H = harness({ fileSet: catFiles() });
  const row = all(orderView(H), (n) => n.type === "tr" && n.props["data-row"] === "BitWire")[0];
  let stopped = 0;
  for (const key of ["j", "k", "p", "x", "q"]) row.props.onKeyDown({ key, stopPropagation: () => stopped++ });
  assert.equal(stopped, 5);
  row.props.onKeyDown({ key: "Escape", stopPropagation: () => stopped++ });
  assert.equal(stopped, 5);
});
test("augs Order tab: the catalog is read only while the Order tab is open (plus once on opening it)", () => {
  const H = harness({ fileSet: catFiles() });
  const n = () => H.reads["data/aug-catalog.txt"] || 0;
  H.view("overview"); H.view("augs"); H.view("settings"); H.view("raw");
  assert.equal(n(), 0, "not read while another view/tab is open");
  H.store.ui({ view: "augs" });
  H.ctl.actions.setAugsTab("order"); H.ctl.tick();
  assert.equal(n(), 1, "read immediately on opening the tab");
  assert.equal(H.store.get("augCatalog").augs.length, CATALOG().augs.length);
  H.ctl.tick(); H.ctl.tick();
  assert.equal(n(), 1, "ticks inside the slow interval do not re-read");
  H.ctl.actions.refresh(); H.ctl.tick();
  assert.equal(n(), 2, "slow path re-reads while the tab is open");
  H.store.ui({ augsTab: "path" }); H.ctl.actions.refresh(); H.ctl.tick();
  H.view("overview"); H.ctl.actions.refresh(); H.ctl.tick();
  assert.equal(n(), 2, "not read after leaving the tab or the view");
  H.ctl.actions.go("augs"); // augsTab was reset above, so still path
  H.store.ui({ augsTab: "order" }); H.ctl.actions.go("augs"); H.ctl.tick();
  assert.equal(n(), 3, "re-opening the view on the Order tab loads it at once");
  const same = H.store.get("augCatalog"); H.ctl.actions.refresh(); H.ctl.tick();
  assert.equal(H.store.get("augCatalog"), same, "memoized by content: same object when the file is unchanged");
});
test("augs Order tab: Apply makes ONE writeSettings call (one log line, actor ui); values equal to the default are unset", () => {
  const H = harness({ fileSet: catFiles() });
  const a = H.ctl.actions;
  assert.equal(a.saveSetting("augs.order.sort", "price").ok, true);
  assert.equal(logLines(H).length, 1);
  const draft = { ...emptyDraft(), sort: "rep", pinned: ["BitWire", "DataJack"], exclude: ["Neuralstimulator"], strict: true, strictMaxWaitMin: 120 };
  const r = a.applyAugOrder(draft);
  assert.equal(r.ok, true);
  assert.equal(logLines(H).length, 2, "exactly one new settings-log line");
  const j = JSON.parse(logLines(H)[1]); assert.equal(j.by, "ui");
  assert.deepEqual(j.changed.map((c) => c.key).sort(), ["augs.order.exclude", "augs.order.pinned", "augs.order.sort", "augs.order.strict"]);
  const values = JSON.parse(H.ns.files[SETTINGS_FILE]).values;
  assert.deepEqual(values, { "augs.order.pinned": ["BitWire", "DataJack"], "augs.order.exclude": ["Neuralstimulator"], "augs.order.strict": true }, "sort back to the default and the default wait cap are unset, not stored");
  assert.deepEqual(H.store.get("settings").values["augs.order.pinned"], ["BitWire", "DataJack"], "settings slice refreshed");
  // applying a draft equal to the current settings changes nothing
  const before = H.ns.files[SETTINGS_FILE];
  assert.equal(a.applyAugOrder(draft).ok, true);
  assert.equal(H.ns.files[SETTINGS_FILE], before); assert.equal(logLines(H).length, 2);
  // a default draft on a fresh file leaves "no overrides" literally empty
  const H2 = harness({ fileSet: catFiles() });
  assert.equal(H2.ctl.actions.applyAugOrder(emptyDraft()).ok, true);
  assert.equal(H2.ns.files[SETTINGS_FILE], undefined, "nothing written");
  assert.equal(logLines(H2).length, 0);
});
test("augs Order tab: a rejected draft (The Red Pill excluded) writes nothing and the error is shown inline", () => {
  const H = harness({ fileSet: catFiles() });
  const r = H.ctl.actions.applyAugOrder({ ...emptyDraft(), pinned: ["BitWire"], exclude: ["The Red Pill"] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /The Red Pill is not allowed/);
  assert.equal(H.ns.files[SETTINGS_FILE], undefined); assert.equal(logLines(H).length, 0, "atomic: the valid pinned part was not written either");
  const t = orderView(H);
  const err = all(t, (n) => n.props["data-error"] === "augs.order");
  assert.equal(err.length, 1); assert.match(text(err[0]), /The Red Pill/);
  assert.equal(H.ctl.actions.applyAugOrder({ ...emptyDraft(), pinned: ["BitWire"] }).ok, true);
  assert.equal(all(orderView(H), (n) => n.props["data-error"] === "augs.order").length, 0, "error cleared by a good apply");
  H.ctl.stop();
  assert.equal(H.ctl.actions.applyAugOrder(emptyDraft()).ok, false, "no ns calls after the script stops");
});
test("augs Order tab: Reset to default unsets exactly ORDER_KEYS in one call and leaves other settings alone", () => {
  const H = harness({ fileSet: catFiles() });
  const a = H.ctl.actions;
  a.saveSetting("strategy.mid", 0.3);
  assert.equal(a.applyAugOrder({ sort: "price", pinned: ["A"], last: ["B"], exclude: ["C"], strict: true, strictMaxWaitMin: 30, drivesWork: true }).ok, true);
  assert.deepEqual(Object.keys(JSON.parse(H.ns.files[SETTINGS_FILE]).values).sort(), [...ORDER_KEYS, "strategy.mid"].sort());
  const n = logLines(H).length;
  assert.equal(a.resetAugOrder().ok, true);
  assert.deepEqual(JSON.parse(H.ns.files[SETTINGS_FILE]).values, { "strategy.mid": 0.3 });
  assert.equal(logLines(H).length, n + 1);
  assert.deepEqual(JSON.parse(logLines(H).at(-1)).changed.map((c) => c.key).sort(), [...ORDER_KEYS].sort());
  assert.equal(ORDER_KEYS.length, 7);
});
test("settings view: augs.order.* stringList keys render as list controls (JSON mode), the others as toggle/select/number", () => {
  const H = harness();
  const t = H.view("settings");
  for (const k of ["augs.order.pinned", "augs.order.last", "augs.order.exclude"]) assert.equal(all(t, (n) => n.props["data-setting"] === k)[0].props["data-control-type"], "list", k);
  assert.equal(all(t, (n) => n.props["data-setting"] === "augs.order.sort")[0].props["data-control-type"], "select");
  assert.equal(all(t, (n) => n.props["data-setting"] === "augs.order.strict")[0].props["data-control-type"], "toggle");
  assert.equal(all(t, (n) => n.props["data-setting"] === "augs.order.strictMaxWaitMin")[0].props["data-control-type"], "number");
});
test("ListInput: json mode commits JSON (names with commas survive); default mode still commits a comma-joined string", () => {
  const H = harness();
  const K = H.V.kit, calls = [];
  const clickRemove = (props, label) => { const tree = render(K.h(K.ListInput, props)); all(tree, (n) => n.props["aria-label"] === label)[0].props.onClick(); };
  clickRemove({ value: ["A, one", "B"], mode: "json", onCommit: (v) => calls.push(v) }, "remove A, one");
  assert.deepEqual(calls, ['["B"]']);
  clickRemove({ value: ["A", "B", "C"], onCommit: (v) => calls.push(v) }, "remove B");
  assert.deepEqual(calls.at(-1), "A,C");
  assert.deepEqual(JSON.parse(calls[0]), ["B"]);
});
test("order model: transitions (pin, top, move, last, exclude precedence, Red Pill/NeuroFlux guards), changedKeys, toPatch", () => {
  const d0 = emptyDraft();
  let r = MODEL.pin(d0, "A"); r = MODEL.pin(r.draft, "B"); r = MODEL.toTop(r.draft, "C");
  assert.deepEqual(r.draft.pinned, ["C", "A", "B"]);
  r = MODEL.move(r.draft, "B", -1); assert.deepEqual(r.draft.pinned, ["C", "B", "A"]);
  assert.deepEqual(MODEL.move(r.draft, "C", -1).draft.pinned, ["C", "B", "A"], "no-op at the top");
  assert.deepEqual(MODEL.move(r.draft, "A", 1).draft.pinned, ["C", "B", "A"], "no-op at the bottom");
  assert.deepEqual(MODEL.move(r.draft, "Z", 1).draft, r.draft, "not in a list");
  r = MODEL.sendLast(r.draft, "B"); assert.deepEqual([r.draft.pinned, r.draft.last], [["C", "A"], ["B"]]);
  r = MODEL.exclude(r.draft, "C"); assert.deepEqual([r.draft.pinned, r.draft.exclude], [["A"], ["C"]], "exclude removes it from pinned/last (exclude > pinned)");
  r = MODEL.pin(r.draft, "C"); assert.deepEqual([r.draft.pinned, r.draft.exclude], [["A", "C"], []], "pinning an excluded aug includes it again");
  assert.match(MODEL.exclude(d0, "The Red Pill").error, /cannot be excluded/); assert.deepEqual(MODEL.exclude(d0, "The Red Pill").draft, d0);
  assert.match(MODEL.pin(d0, "NeuroFlux Governor").error, /always last/); assert.match(MODEL.sendLast(d0, "NeuroFlux Governor").error, /always last/); assert.match(MODEL.exclude(d0, "NeuroFlux Governor").error, /always last/);
  assert.equal(MODEL.canExclude("The Red Pill"), false); assert.equal(MODEL.canExclude("BitWire"), true);
  assert.deepEqual(MODEL.drop({ ...d0, pinned: ["A"], last: ["A"], exclude: ["A"] }, "A").draft, d0);
  assert.deepEqual(MODEL.changedKeys(d0, {}), []);
  assert.deepEqual(MODEL.changedKeys({ ...d0, pinned: ["A"], sort: "name" }, {}).sort(), ["augs.order.pinned", "augs.order.sort"]);
  assert.deepEqual(MODEL.changedKeys({ ...d0, pinned: ["A"] }, { "augs.order.pinned": ["A"] }), []);
  assert.deepEqual(MODEL.toPatch(d0).set, {}); assert.deepEqual(MODEL.toPatch(d0).unset.sort(), [...ORDER_KEYS].sort());
  assert.deepEqual(MODEL.toPatch({ ...d0, strictMaxWaitMin: 30 }).set, { "augs.order.strictMaxWaitMin": 30 });
});
test("order model: rows show rank/tag per aug; excluded, blocked, unknown and owned rows; warnings; costs; Daedalus warning", () => {
  const cat = CATALOG(), d0 = emptyDraft();
  const base = MODEL.orderRows(cat, d0);
  assert.equal(base.rows.length, base.order.length); assert.deepEqual(base.rows.map((x) => x.rank), base.order.map((_, i) => i + 1));
  assert.ok(base.rows.every((x) => ["auto", "prereq"].includes(x.tag)));
  const gen = "Cranial Signal Processors - Gen II", gen1 = "Cranial Signal Processors - Gen I";
  const d = { ...d0, pinned: ["BitWire", "Nope Aug"], last: ["DataJack"], exclude: [gen1] };
  const v = MODEL.orderRows(cat, d);
  const tag = (n) => v.rows.find((x) => x.name === n)?.tag;
  assert.equal(tag("BitWire"), "pinned"); assert.equal(v.rows[0].name, "BitWire"); assert.equal(tag("DataJack"), "last"); assert.equal(v.rows.filter((x) => x.rank).at(-1).name, "DataJack");
  assert.equal(tag(gen1), "excluded"); assert.equal(tag(gen), "blocked"); assert.equal(tag("Nope Aug"), "unknown");
  assert.match(v.rows.find((x) => x.name === gen).note, /Gen I excluded/);
  assert.ok(v.warnings.includes("unknown aug in pinned: Nope Aug"));
  assert.ok(!MODEL.orderRows(cat, d0, { showOwned: false }).rows.some((x) => x.tag === "owned"));
  const owned = { t: 1, augs: cat.augs.map((a, i) => (i < 3 ? { ...a, owned: true, installed: i === 0 } : a)) };
  assert.equal(MODEL.orderRows(owned, d0, { showOwned: true }).rows.filter((x) => x.tag === "owned").length, 3);
  assert.equal(MODEL.orderRows(owned, d0).rows.filter((x) => x.tag === "owned").length, 0);
  assert.equal(MODEL.orderRows(null, d0).rows.length, 0, "no catalog: no rows, no throw");
  const names = ["BitWire", "DataJack", "Neuralstimulator"];
  const c = MODEL.batchCosts(cat, names, { ...d0, sort: "price" }, d0);
  assert.ok(c.draft > 0 && c.draft <= c.current && c.current === c.default);
  const plan = { daedalus: { augsReq: 1000, augsInstalled: 0 }, steps: [{ aug: "The Red Pill", faction: "Daedalus" }], install: { queued: 0 } };
  assert.match(MODEL.daedalusWarning(cat, { ...d0, exclude: ["BitWire"] }, plan), /fewer obtainable augs .* than Daedalus requires/);
  assert.equal(MODEL.daedalusWarning(cat, { ...d0, exclude: ["BitWire"] }, { ...plan, steps: [{ aug: "The Red Pill", faction: "Slum Snakes" }] }), null, "gang-sourced Red Pill: no Daedalus count");
  assert.equal(MODEL.daedalusWarning(cat, d0, plan), null, "nothing excluded: no warning");
  assert.equal(MODEL.daedalusWarning(cat, { ...d0, exclude: ["BitWire"] }, { ...plan, daedalus: { augsReq: 3, augsInstalled: 0 } }), null, "enough left");
});
test("static: the Order tab's modules are inside the dashboard import graph and the RAM scan above covers them", () => {
  const rels = [...importGraph("dashboard.js").keys()].map((f) => path.relative(GAME, f));
  for (const f of ["lib/augorder.js", "lib/ui/augorder-model.js", "lib/ui/views.js", "lib/ui/controller.js"]) assert.ok(rels.includes(f), `${f} in the walked set`);
});

let failed = 0;
for (const [name, fn] of tests) { try { await fn(); console.log("ok  ", name); } catch (e) { failed++; console.error("FAIL", name, "\n", e); } }
if (failed) { console.error(`${failed} dashboard test(s) failed`); process.exit(1); }
console.log(`dashboard: ${tests.length} passed`);
