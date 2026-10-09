/**
 * lib/ui/views.js — dashboard layout and the eight views. createViews(React, deps) so tests can render with a fake React.
 * Layout: persistent sidebar + main workspace. Each view: header (dominant h1 title + one primary action, metadata in label
 * style) then sections. Selecting a record opens its Detail alongside the list (Split).
 * Views subscribe only to the store slices they show and are React.memo'd, so an unchanged tick renders nothing.
 */
import { createKit } from "./kit.js";
import { SPACE, COLOR, TYPE, LAYOUT, TRANSITION, RADIUS, FONT, px } from "./tokens.js";
import { fmtMoney, fmtNum, fmtPct, fmtGb, fmtBytes, fmtDur, fmtAgo, fmtTime, fmtValue, DASH } from "./format.js";
import { controlsFromSchema, groupControls } from "./settings-model.js";
import { KPI_KEYS, KPI_LABELS } from "../kpi.js";
import { RAW_FILES } from "../data-sources.js";

export const SECTIONS = Object.freeze([
  { id: "overview", label: "Overview" }, { id: "ram", label: "RAM" }, { id: "augs", label: "Augmentations" }, { id: "node", label: "Node" },
  { id: "pred", label: "Predictions" }, { id: "logs", label: "Logs" }, { id: "raw", label: "Raw data" }, { id: "settings", label: "Settings" },
]);
export const LOG_TABS = Object.freeze([{ id: "agent", label: "Agent" }, { id: "events", label: "Events" }, { id: "audit", label: "Audit" }, { id: "install", label: "Installs" }]);
const BUCKET = ["money", "share", "xp"]; // read with bracket access: "share" is a Netscript function name (RAM analyzer)
const BUCKET_COLOR = { money: COLOR.good, "share": COLOR.muted, xp: COLOR.warn };

/**
 * @param {*} React
 * @param {{schema: Array, groups: Array}} deps  settings schema (lib/settings-schema.js)
 */
export function createViews(React, { schema = [], groups = [] } = {}) {
  const K = createKit(React);
  const { h, memo, useSlice } = K;
  const SCHEMA_BY_KEY = Object.fromEntries(schema.map((f) => [f.key, f]));

  // ── shell ────────────────────────────────────────────────────────────────
  const Sidebar = memo(function Sidebar({ view, actions, attentionCount }) {
    return h("nav", { "data-role": "sidebar", style: { width: LAYOUT.sidebarWidth, flex: "none", display: "flex", flexDirection: "column", gap: SPACE.xs,
      padding: px(SPACE.md, SPACE.sm), background: COLOR.surface1, borderRight: `1px solid ${COLOR.border}` } },
      h("div", { style: { ...TYPE.h3, padding: px(0, SPACE.sm), marginBottom: SPACE.sm } }, "Bitburner"),
      SECTIONS.map((s) => {
        const sel = s.id === view;
        return h("button", { key: s.id, type: "button", "data-nav": s.id, "data-accent": sel ? "selected" : undefined, onClick: () => actions.go(s.id),
          style: { textAlign: "left", cursor: "pointer", padding: px(SPACE.xs, SPACE.sm), border: "none", borderLeft: `2px solid ${sel ? COLOR.accent : "transparent"}`,
            borderRadius: RADIUS.sm, background: sel ? COLOR.surface3 : "transparent", color: sel ? COLOR.text : COLOR.muted, transition: TRANSITION, ...TYPE.body,
            fontWeight: sel ? 600 : 400, fontFamily: FONT.sans } },
          s.label, s.id === "overview" && attentionCount ? h("span", { style: { ...TYPE.meta, color: COLOR.warn, marginLeft: SPACE.xs } }, `(${attentionCount})`) : null);
      }));
  });

  /** Page header: dominant title + the view's single primary action; metadata subdued. */
  const Header = ({ title, meta, primary, secondary }) => h("header", { style: { display: "flex", alignItems: "center", gap: SPACE.md, marginBottom: SPACE.xl } },
    h("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: SPACE.xs } }, h(K.Heading, { level: 1 }, title), meta ? h(K.Label, null, meta) : null),
    secondary || null,
    primary ? h(K.Button, { kind: "primary", onClick: primary.onClick, title: primary.title }, primary.label) : null);

  const metaLine = (store, extra) => {
    const m = store.get("meta") || {};
    return [extra, m.tickMs != null ? `tick ${m.tickMs.toFixed(1)} ms` : null, m.lastTick ? `updated ${fmtAgo(m.lastTick, Date.now())}` : null].filter(Boolean).join(" · ");
  };

  // ── Overview ─────────────────────────────────────────────────────────────
  const Overview = memo(function Overview({ store, actions, ui }) {
    const data = useSlice(store, "kpis") || { kpis: {}, attention: [], files: {} };
    const ring = useSlice(store, "ring") || [];
    const sel = ui.sel.overview || null;
    const k = data.kpis || {};
    const latest = ring.length ? ring[ring.length - 1] : null;
    const fac = latest?.work?.type === "FACTION" ? latest.work.name : null;
    const sel_k = sel && k[sel];
    const detail = sel_k ? h(K.Detail, { title: KPI_LABELS[sel] || sel, meta: sel_k.formula, onClose: () => actions.select("overview", null) },
      h(K.KeyValue, { rows: [["value", fmtValue(sel_k.value)], ["display", sel_k.display], ["status", sel_k.status]] }),
      h(K.Heading, { level: 3 }, "Sources (raw data)"),
      h(K.DataTable, { columns: [{ key: "file", label: "File", mono: true }, { key: "field", label: "Field", mono: true }, { key: "value", label: "Raw value", render: (r) => r.missing ? "missing" : fmtValue(r.value), maxWidth: 200 }],
        rows: sel_k.sources, rowKey: (r, i) => `${r.file}:${r.field}:${i}`, onSelect: (id) => { const s = sel_k.sources.find((r, i) => `${r.file}:${r.field}:${i}` === id); if (s) actions.openRaw(s.file, s.field); } }),
      h(K.Label, null, "Select a source to open it in Raw data.")) : null;
    const tiles = h(K.Grid, { min: 150 }, KPI_KEYS.map((key, i) => h(K.KpiTile, { key, label: KPI_LABELS[key], k: k[key], size: i === 0 ? "lg" : "md", selected: sel === key,
      onClick: () => actions.select("overview", sel === key ? null : key) })));
    return h("div", null,
      h(Header, { title: "Overview", meta: metaLine(store, data.bn ? `BN${data.bn}` : null), primary: { label: "Refresh now", onClick: actions.refresh } }),
      h(K.Split, { list: h("div", null,
        h(K.Section, { title: "Key metrics", meta: "select a metric for its formula and raw sources" }, tiles),
        h(K.Section, { title: "Attention", meta: `${(data.attention || []).length} items` },
          (data.attention || []).length ? h(K.DataTable, { columns: [{ key: "level", label: "", render: (r) => h(K.StatusMark, { status: r.level === "info" ? "none" : r.level }) }, { key: "text", label: "Item", maxWidth: 520 }],
            rows: data.attention, rowKey: (r, i) => `a${i}`, onSelect: (id) => { const a = data.attention[Number(String(id).slice(1))]; if (a) a.file ? actions.openRaw(a.file) : actions.go(a.view || "overview"); } })
            : h(K.EmptyState, { title: "Nothing needs attention" })),
        h(K.Section, { title: "Trends", meta: `${ring.length} samples (telemetry-ring)` },
          h(K.Grid, { min: 250 },
            h(K.Panel, null, h(K.Label, null, "Money"), h(K.Sparkline, { values: ring.map((r) => r.money) })),
            h(K.Panel, null, h(K.Label, null, `Rep${fac ? ` · ${fac}` : ""}`), h(K.Sparkline, { values: fac ? ring.map((r) => r.rep?.[fac]) : [] })),
            h(K.Panel, null, h(K.Label, null, "Network RAM used"), h(K.Sparkline, { values: ring.map((r) => r.net?.used) })),
            h(K.Panel, null, h(K.Label, null, "Hacking level"), h(K.Sparkline, { values: ring.map((r) => r.lvl?.hacking) })))),
        h(K.Section, { title: "Data freshness" },
          h(K.DataTable, { columns: [{ key: "file", label: "File", mono: true }, { key: "age", label: "Age", align: "right", render: (r) => r.missing ? "missing" : fmtDur(r.ageMs) },
            { key: "st", label: "", render: (r) => h(K.StatusMark, { status: r.missing ? "bad" : r.stale ? "warn" : "good" }) }],
            rows: Object.entries(data.files || {}).map(([file, f]) => ({ file, ...f })), rowKey: (r) => r.file, onSelect: (id) => id && actions.openRaw(id) }))),
        detail }));
  });

  // ── RAM ──────────────────────────────────────────────────────────────────
  const Ram = memo(function Ram({ store, actions, ui }) {
    const rs = useSlice(store, "ramStatus");
    const sel = ui.sel.ram || null;
    const header = h(Header, { title: "RAM", meta: metaLine(store, rs ? `phase ${rs.phase ?? DASH} · weight ${rs.weight ?? DASH}` : "no RAM manager status"),
      primary: { label: "RAM settings", onClick: () => actions.openSetting("ram.manager.enabled") } });
    if (!rs) {
      const ring = store.get("ring") || [];
      const net = ring.length ? ring[ring.length - 1].net : null;
      return h("div", null, header, h(K.Section, { title: "Status" },
        h(K.EmptyState, { title: "data/ram-status.txt not found", detail: "It is written by the RAM manager (daemon.js, RAM manager PR). Telemetry fallback shown below." }),
        net ? h(K.KeyValue, { rows: [["network used", fmtGb(net.used)], ["network max", fmtGb(net.max)], ["utilization", fmtPct(net.max ? net.used / net.max : null)]] }) : null));
    }
    const targets = Array.isArray(rs.activeTargets) ? rs.activeTargets : [];
    const t = sel != null ? targets.find((x) => x.host === sel) : null;
    const allocParts = BUCKET.map((b) => ({ label: b, value: Number(rs.alloc?.[b]) || 0, color: BUCKET_COLOR[b], text: fmtGb(rs.alloc?.[b]) }));
    const runParts = BUCKET.map((b) => ({ label: b, value: Number(rs.running?.[b]) || 0, color: BUCKET_COLOR[b], text: fmtGb(rs.running?.[b]) }));
    return h("div", null, header,
      h(K.Split, { list: h("div", null,
        h(K.Section, { title: "Utilization", meta: fmtAgo(rs.t, Date.now()) },
          h(K.Grid, { min: 140 },
            ...[["Usable", fmtGb(rs.usableGb)], ["Util (now)", fmtPct(rs.util?.instant)], ["Util (5 min)", fmtPct(rs.util?.ema5)], ["Rep active", fmtValue(rs.repActive)],
              ["Hack-bound", fmtValue(rs.hackNeed)], ["Share power", rs.sharePower == null ? DASH : Number(rs.sharePower).toFixed(3)]]
              .map(([l, v]) => h(K.Panel, { key: l }, h(K.Label, null, l), h("div", { style: TYPE.kpi }, v))))),
        h(K.Section, { title: "Allocation", meta: "money · share · xp (allocated vs running)" },
          h(K.Label, null, "Allocated"), h(K.StackBar, { parts: allocParts, total: rs.usableGb }),
          h(K.Label, null, "Running"), h(K.StackBar, { parts: runParts, total: rs.usableGb }),
          h(K.KeyValue, { rows: BUCKET.map((b) => [b, `${fmtGb(rs.alloc?.[b])} allocated · ${fmtGb(rs.running?.[b])} running`]) })),
        h(K.Section, { title: "Hack targets", meta: `${targets.length} active` },
          h(K.DataTable, { columns: [{ key: "host", label: "Target", mono: true }, { key: "kind", label: "Wave" }, { key: "batches", label: "Batches", align: "right" },
            { key: "ramGb", label: "RAM", align: "right", render: (r) => fmtGb(r.ramGb) }], rows: targets, rowKey: (r) => r.host, selectedId: sel,
            onSelect: (id) => actions.select("ram", id), empty: "No active targets" })),
        h(K.Section, { title: "Cloud servers" }, h(K.KeyValue, { rows: [["owned", `${rs.cloud?.count ?? DASH} / ${rs.cloud?.limit ?? DASH}`], ["smallest", fmtGb(rs.cloud?.minGb)],
          ["largest", fmtGb(rs.cloud?.maxGb)], ["spent this loop", fmtMoney(rs.cloud?.spentThisLoop)]] })),
        h(K.Section, { title: "Reasons" }, (rs.reasons || []).length ? h(K.DataTable, { columns: [{ key: "r", label: "Decision", maxWidth: 640 }], rows: rs.reasons.map((r) => ({ r })) }) : h(K.EmptyState, { title: "No reasons logged" }))),
      detail: t ? h(K.Detail, { title: t.host, meta: "active hack target", onClose: () => actions.select("ram", null) }, h(K.JsonTree, { value: t, name: t.host, expanded: ui.expanded, onToggle: actions.toggle })) : null }));
  });

  // ── Augmentations ────────────────────────────────────────────────────────
  const Augs = memo(function Augs({ store, actions, ui }) {
    const ap = useSlice(store, "augPlan");
    const pilot = useSlice(store, "autopilot");
    const sel = ui.sel.augs ?? null;
    const header = h(Header, { title: "Augmentations", meta: metaLine(store, ap ? `goal ${ap.goal ?? DASH} · ${ap.steps?.length ?? 0} steps` : "no aug plan"),
      primary: { label: "Augmentation settings", onClick: () => actions.openSetting("augs.autoInstall") } });
    if (!ap) return h("div", null, header, h(K.Section, { title: "Plan" },
      h(K.EmptyState, { title: "data/aug-plan.txt not found", detail: "It is written by the aug planner (autopilot.js, aug planner PR). Autopilot summary shown below." }),
      pilot?.augs ? h(K.KeyValue, { rows: [["buyable", pilot.augs.buyable], ["Red Pill", fmtValue(pilot.augs.redPill)], ["top", fmtValue(pilot.augs.top)]] }) : null));
    const steps = Array.isArray(ap.steps) ? ap.steps : [];
    const s = sel != null ? steps.find((x) => x.order === sel) : null;
    return h("div", null, header, h(K.Split, { list: h("div", null,
      h(K.Section, { title: "Progress" }, h(K.KeyValue, { rows: [
        ["phase", `${ap.phase ?? DASH} (${fmtPct(ap.progress, 0)})`],
        ["Daedalus", ap.daedalus ? `${ap.daedalus.augsInstalled ?? DASH}/${ap.daedalus.augsReq ?? DASH} augs · ${fmtMoney(ap.daedalus.moneyReq)} · hack ${ap.daedalus.hackReq ?? DASH}${ap.daedalus.met ? " · met" : ""}` : DASH],
        ["The Red Pill", ap.redPill ? (ap.redPill.owned ? "owned" : `${fmtNum(ap.redPill.rep)} / ${fmtNum(ap.redPill.repReq)} rep`) : DASH],
        ["w0r1d_d43m0n", ap.worldDaemon ? `${ap.worldDaemon["hack"] ?? DASH} / ${ap.worldDaemon.req ?? DASH} hack${ap.worldDaemon.ready ? " · READY" : ""}` : DASH],
        ["install", ap.install ? `${ap.install.policy ?? DASH} · ${ap.install.queued ?? 0} queued · next ${ap.install.next ? `${fmtDur((ap.install.next.etaMin ?? NaN) * 60000)} ${ap.install.next.reason ?? ""}` : DASH}` : DASH],
      ] })),
      h(K.Section, { title: "Path", meta: "ordered purchase / install plan" }, h(K.DataTable, {
        columns: [{ key: "order", label: "#", align: "right" }, { key: "aug", label: "Augmentation", maxWidth: 260 }, { key: "faction", label: "Faction" },
          { key: "repReq", label: "Rep", align: "right", render: (r) => fmtNum(r.repReq) }, { key: "price", label: "Price", align: "right", render: (r) => fmtMoney(r.price) },
          { key: "status", label: "Status" }, { key: "etaMin", label: "ETA", align: "right", render: (r) => fmtDur((r.etaMin ?? NaN) * 60000) }],
        rows: steps, rowKey: (r) => r.order, selectedId: sel, onSelect: (id) => actions.select("augs", id), empty: "No remaining steps" }))),
    detail: s ? h(K.Detail, { title: s.aug, meta: `${s.faction ?? DASH} · step ${s.order}`, onClose: () => actions.select("augs", null) },
      h(K.KeyValue, { rows: [["status", s.status], ["rep required", fmtNum(s.repReq)], ["price", fmtMoney(s.price)], ["prerequisites", (s.prereqs || []).join(", ") || "none"], ["ETA", fmtDur((s.etaMin ?? NaN) * 60000)]] }),
      h(K.Heading, { level: 3 }, "Why"), h(K.Body, null, s.why || DASH)) : null }));
  });

  // ── settings controls (shared by Settings and Node) ───────────────────────
  const SettingControl = memo(function SettingControl({ c, actions }) {
    const draft = (v) => actions.draft(c.key, v);
    const commit = (v) => actions.saveSetting(c.key, v);
    let ctl;
    switch (c.control) {
      case "toggle": ctl = h(K.Toggle, { value: c.shown, label: c.label, onChange: commit }); break;
      case "slider": ctl = h(K.Slider, { value: Number(c.shown), min: c.min, max: c.max, step: c.step, ends: c.ends, onDraft: draft, onCommit: commit }); break;
      case "number": ctl = h(K.NumberInput, { value: c.shown, invalid: !!c.error, onDraft: draft, onCommit: commit }); break;
      case "select": ctl = h(K.Select, { value: c.shown, options: c.options || [], onChange: commit }); break;
      case "list": ctl = h(K.ListInput, { value: c.shown, invalid: !!c.error, onCommit: commit }); break;
      default: ctl = h(K.TextField, { value: c.shown, invalid: !!c.error, onDraft: draft, onCommit: commit });
    }
    return h("div", { "data-setting": c.key, "data-control-type": c.control, style: { display: "flex", flexDirection: "column", gap: SPACE.xs } },
      h(K.Row, null, ctl, c.overridden ? h(K.Button, { kind: "ghost", onClick: () => actions.resetSetting(c.key), title: `back to default (${fmtValue(c.defaultValue)})` }, "Reset") : null),
      c.error ? h("span", { role: "alert", "data-error": c.key, style: { ...TYPE.meta, color: COLOR.bad } }, c.error) : null);
  });
  const SettingRow = ({ c, actions, selected, onSelect }) => h("div", {
    "data-accent": selected ? "selected" : undefined,
    style: { display: "grid", gridTemplateColumns: "minmax(160px, 1fr) minmax(220px, 1.4fr)", gap: SPACE.md, alignItems: "start", padding: px(SPACE.sm),
      borderBottom: `1px solid ${COLOR.surface2}`, background: selected ? COLOR.accentDim : "transparent", transition: TRANSITION } },
    h("button", { type: "button", onClick: onSelect, style: { textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: "pointer", display: "flex", flexDirection: "column", gap: SPACE.xs } },
      h("span", { style: { ...TYPE.body, fontWeight: 600 } }, c.label, c.overridden ? h("span", { style: { ...TYPE.meta, marginLeft: SPACE.xs } }, "· overridden") : null),
      h("span", { style: TYPE.mono }, c.key)),
    h(SettingControl, { c, actions }));

  function settingDetail(c, log, actions) {
    const f = SCHEMA_BY_KEY[c.key] || {};
    const hist = (log || []).filter((l) => (l.changed || []).some((x) => x.key === c.key)).slice(-10).reverse();
    return h(K.Detail, { title: c.label, meta: c.key, onClose: () => actions.select("settings", null) },
      h(K.Body, null, c.help),
      h(K.KeyValue, { rows: [["current", fmtValue(c.value)], ["default", fmtValue(c.defaultValue)], ["overridden", c.overridden ? "yes" : "no"], ["type", f.type],
        ["range", f.min != null ? `${f.min} … ${f.max}${f.step ? ` step ${f.step}` : ""}` : f.options ? f.options.join(" | ") : DASH], ["read by", f.owner]] }),
      h(K.Heading, { level: 3 }, "Recent changes"),
      hist.length ? h(K.DataTable, { columns: [{ key: "t", label: "When", render: (r) => fmtTime(r.t) }, { key: "by", label: "By" },
        { key: "c", label: "Change", render: (r) => { const x = r.changed.find((y) => y.key === c.key); return `${fmtValue(x.from)} → ${fmtValue(x.to)}`; } }], rows: hist, rowKey: (r) => r.rev })
        : h(K.Label, null, "No changes logged"));
  }

  // ── Node ─────────────────────────────────────────────────────────────────
  const NodeView = memo(function NodeView({ store, actions, ui }) {
    const ap = useSlice(store, "augPlan");
    const st = useSlice(store, "settings") || { values: {}, overrides: {} };
    const data = useSlice(store, "kpis") || { kpis: {} };
    const node = ap?.node || null;
    const d = data.kpis?.destroy;
    const controls = controlsFromSchema(schema.filter((f) => f.group === "node"), st.values, st.overrides, ui.drafts, ui.errors);
    return h("div", null,
      h(Header, { title: "BitNode", meta: metaLine(store, data.bn ? `BN${data.bn}` : null), primary: { label: "Node settings", onClick: () => actions.openSetting("node.autoDestroy") } }),
      h(K.Section, { title: "Destroy milestone" },
        h(K.Grid, { min: 200 }, h(K.KpiTile, { label: "w0r1d_d43m0n", k: d, size: "lg", onClick: () => actions.go("overview") })),
        h(K.KeyValue, { rows: [["ready", fmtValue(node ? node.ready : d?.value === 0)], ["requirement", ap?.worldDaemon ? `hack ${ap.worldDaemon["hack"] ?? DASH} / ${ap.worldDaemon.req ?? DASH}` : DASH],
          ["recommended next", node?.recommended ? `BN${node.recommended.bn} · ${node.recommended.why ?? ""}` : DASH],
          ["pending action", node?.pending ? `${node.pending.id ?? ""} ${node.pending.stage ?? ""} ${node.pending.detail ?? ""}`.trim() : "none"]] }),
        !ap ? h(K.EmptyState, { title: "data/aug-plan.txt not found", detail: "Readiness falls back to the autopilot's w0r1d_d43m0n READY flag." }) : null),
      h(K.Section, { title: "Node controls", meta: "saved to data/settings.txt immediately" },
        h(K.Panel, { style: { padding: 0 } }, controls.map((c) => h(SettingRow, { key: c.key, c, actions, selected: false, onSelect: () => actions.openSetting(c.key) })))));
  });

  // ── Predictions ──────────────────────────────────────────────────────────
  const Predictions = memo(function Predictions({ store, actions, ui }) {
    const pred = useSlice(store, "pred") || [];
    const sel = ui.sel.pred ?? null;
    const p = sel != null ? pred.find((r) => r.id === sel) : null;
    return h("div", null,
      h(Header, { title: "Predictions", meta: metaLine(store, `${pred.length} recent (data/pred2.txt tail)`), primary: { label: "Refresh now", onClick: actions.refresh } }),
      h(K.Split, { list: h(K.Section, { title: "Recent" }, h(K.DataTable, {
        columns: [{ key: "made", label: "Made", render: (r) => fmtTime(r.made) }, { key: "kind", label: "Target", render: (r) => r.spec ? `${r.spec.kind} ${fmtNum(r.spec.target)}` : r.type },
          { key: "model", label: "Model" }, { key: "eta", label: "ETA", align: "right", render: (r) => fmtTime(r.eta) },
          { key: "band", label: "80% band", align: "right", render: (r) => (r.lo && r.hi ? fmtDur(r.hi - r.lo) : DASH) }],
        rows: pred, rowKey: (r, i) => r.id ?? i, selectedId: sel, onSelect: (id) => actions.select("pred", id), empty: "No predictions loaded yet" })),
      detail: p ? h(K.Detail, { title: p.spec ? `${p.spec.kind} → ${fmtNum(p.spec.target)}` : String(p.id), meta: `made ${fmtTime(p.made)}`, onClose: () => actions.select("pred", null) },
        h(K.JsonTree, { value: p, name: "prediction", expanded: ui.expanded, onToggle: actions.toggle })) : null }));
  });

  // ── Logs ─────────────────────────────────────────────────────────────────
  const Logs = memo(function Logs({ store, actions, ui }) {
    const logs = useSlice(store, "logs") || {};
    const tab = ui.logTab || "agent";
    const rows = logs[tab] || [];
    const sel = ui.sel.logs ?? null;
    const r = sel != null ? rows.find((x) => x.id === sel) : null;
    return h("div", null,
      h(Header, { title: "Logs", meta: metaLine(store, `${rows.length} lines`), primary: { label: "Refresh now", onClick: actions.refresh },
        secondary: h(K.Tabs, { tabs: LOG_TABS, value: tab, onChange: (id) => actions.setUi({ logTab: id, sel: { ...ui.sel, logs: null } }) }) }),
      h(K.Split, { list: h(K.DataTable, { columns: [{ key: "t", label: "When", render: (x) => fmtTime(x.t) }, { key: "text", label: "Entry", maxWidth: 560 }],
        rows, rowKey: (x) => x.id, selectedId: sel, onSelect: (id) => actions.select("logs", id), empty: "No log lines loaded yet" }),
      detail: r ? h(K.Detail, { title: `${LOG_TABS.find((t) => t.id === tab)?.label} entry`, meta: fmtTime(r.t), onClose: () => actions.select("logs", null) },
        typeof r.raw === "object" ? h(K.JsonTree, { value: r.raw, name: "entry", expanded: ui.expanded, onToggle: actions.toggle })
          : h("pre", { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", ...TYPE.mono, color: COLOR.text } }, r.text)) : null }));
  });

  // ── Raw data ─────────────────────────────────────────────────────────────
  const Raw = memo(function Raw({ store, actions, ui }) {
    const raw = useSlice(store, "raw") || null;
    const file = ui.rawFile;
    const sizes = (raw && raw.sizes) || {};
    return h("div", null,
      h(Header, { title: "Raw data", meta: metaLine(store, "every file the KPIs are built from"), primary: { label: "Refresh now", onClick: actions.refresh } }),
      h(K.Split, { list: h(K.DataTable, { columns: [{ key: "f", label: "File", mono: true }, { key: "b", label: "Size", align: "right", render: (x) => (sizes[x.f] == null ? DASH : fmtBytes(sizes[x.f])) }],
        rows: RAW_FILES.map((f) => ({ f })), rowKey: (x) => x.f, selectedId: file, onSelect: (id) => actions.openRaw(id) }),
      detail: file ? h(K.Detail, { title: file, meta: raw && raw.file === file ? `${raw.truncated ? `last ${raw.lines} lines · ` : ""}${raw.bad ? `${raw.bad} unparsable lines · ` : ""}read ${fmtAgo(raw.t, Date.now())}` : "loading…",
        onClose: () => actions.setUi({ rawFile: null }) },
        !raw || raw.file !== file ? h(K.Label, null, "loading…")
          : raw.missing ? h(K.EmptyState, { title: "File not found", detail: "Another component writes it; it may not exist yet in this run." })
            : raw.value !== undefined ? h(K.JsonTree, { value: raw.value, name: file.replace(/^data\//, ""), expanded: ui.expanded, onToggle: actions.toggle, highlight: ui.rawField })
              : h("pre", { style: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", ...TYPE.mono, color: COLOR.text } }, raw.text)) : null }));
  });

  // ── Settings ─────────────────────────────────────────────────────────────
  const Settings = memo(function Settings({ store, actions, ui }) {
    const st = useSlice(store, "settings") || { values: {}, overrides: {}, rev: 0, warnings: [] };
    const log = useSlice(store, "settingsLog") || [];
    const controls = controlsFromSchema(schema, st.values, st.overrides, ui.drafts, ui.errors);
    const sel = ui.sel.settings ?? null;
    const c = sel ? controls.find((x) => x.key === sel) : null;
    const nOver = controls.filter((x) => x.overridden).length;
    return h("div", null,
      h(Header, { title: "Settings", meta: metaLine(store, `rev ${st.rev}${st.updatedBy ? ` · last change by ${st.updatedBy}` : ""} · ${nOver} overridden`),
        primary: nOver ? { label: ui.confirmReset ? `Confirm reset of ${nOver}` : "Reset all overridden", onClick: actions.resetAll } : null,
        secondary: ui.confirmReset ? h(K.Button, { onClick: () => actions.setUi({ confirmReset: false }) }, "Cancel") : null }),
      (st.warnings || []).length ? h(K.Section, { title: "Warnings" }, st.warnings.map((w, i) => h("div", { key: i, style: { ...TYPE.meta, color: COLOR.warn } }, w))) : null,
      h(K.Split, { list: h("div", null, groupControls(groups, controls).map((g) => h(K.Section, { key: g.id, title: g.label, meta: `${g.controls.length} settings` },
        h(K.Panel, { style: { padding: 0 } }, g.controls.map((x) => h(SettingRow, { key: x.key, c: x, actions, selected: x.key === sel, onSelect: () => actions.select("settings", x.key === sel ? null : x.key) })))))),
      detail: c ? settingDetail(c, log, actions) : null }));
  });

  const VIEWS = { overview: Overview, ram: Ram, augs: Augs, node: NodeView, pred: Predictions, logs: Logs, raw: Raw, settings: Settings };

  /** Stateless shell for a given ui state (tests render this directly). */
  function Shell({ store, actions, ui }) {
    const View = VIEWS[ui.view] || Overview;
    const att = (store.get("kpis")?.attention || []).filter((a) => a.level !== "info").length;
    return h("div", { "data-role": "app", tabIndex: -1, onKeyDown: (e) => { if (e.key === "Escape") actions.clearSelection(); },
      style: { display: "flex", height: "100%", minHeight: 480, background: COLOR.bg, color: COLOR.text, ...TYPE.body, fontFamily: FONT.sans, outline: "none" } },
      h(Sidebar, { view: ui.view, actions, attentionCount: att }),
      h("main", { "data-role": "workspace", style: { flex: 1, minWidth: 0, overflow: "auto", padding: px(SPACE.xl) } },
        h(K.ErrorBoundary, { key: ui.view }, h(View, { store, actions, ui }))));
  }
  /** Root component: subscribes to the ui slice only. */
  function App({ store, actions }) {
    const ui = useSlice(store, "ui");
    return h(Shell, { store, actions, ui });
  }
  return { App, Shell, Sidebar, VIEWS, kit: K };
}
