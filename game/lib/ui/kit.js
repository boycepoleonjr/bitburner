/**
 * lib/ui/kit.js — dashboard primitives. createKit(React) so tests can pass a fake React (no JSX, no DOM globals).
 * All styling comes from ./tokens.js; controls share CONTROL styles so every button and input looks the same.
 * Accent rule: only Button(primary), selected items and focus rings use COLOR.accent*, and those elements carry
 * data-accent="primary" | "selected" | "focus" (checked by test/dashboard.js).
 */
import { SPACE, RADIUS, COLOR, TYPE, CONTROL, PANEL, LAYOUT, STATUS_COLOR, TRANSITION, FONT, px } from "./tokens.js";
import { fmtValue, DASH } from "./format.js";

export function createKit(React) {
  const h = React.createElement;
  const memo = React.memo || ((f) => f);

  /** Subscribe a component to one store slice (React 17: useState + useEffect). */
  function useSlice(store, key) {
    const [v, setV] = React.useState(() => store.get(key));
    React.useEffect(() => {
      const off = store.subscribe(key, setV);
      if (store.get(key) !== v) setV(store.get(key)); // value changed between render and subscribe (remount)
      return off;
    }, [store, key]);
    return v;
  }

  const stop = (e) => { if (e && e.stopPropagation) e.stopPropagation(); }; // keep game hotkeys out of inputs

  // ── text ────────────────────────────────────────────────────────────────
  const Heading = ({ level = 2, children, style }) => h(level === 1 ? "h1" : level === 2 ? "h2" : "h3",
    { style: { margin: 0, ...TYPE[`h${level}`], ...style } }, children);
  const Label = ({ children, style }) => h("span", { style: { ...TYPE.meta, ...style } }, children);
  const Body = ({ children, style }) => h("div", { style: { ...TYPE.body, ...style } }, children);
  const Mono = ({ children, style }) => h("span", { style: { ...TYPE.mono, ...style } }, children);
  const StatusMark = ({ status = "none" }) => h("span", {
    "aria-label": status,
    style: { display: "inline-block", width: 8, height: 8, borderRadius: RADIUS.sm, background: STATUS_COLOR[status] || COLOR.label, flex: "none" },
  });

  // ── containers ──────────────────────────────────────────────────────────
  /** A page section: generous space between sections, compact inside. */
  const Section = ({ title, meta, children, actions }) => h("section", { style: { display: "flex", flexDirection: "column", gap: SPACE.sm, marginBottom: SPACE.xl } },
    title ? h("div", { style: { display: "flex", alignItems: "baseline", gap: SPACE.sm } },
      h(Heading, { level: 2 }, title), meta ? h(Label, null, meta) : null, h("div", { style: { flex: 1 } }), actions || null) : null,
    children);
  const Panel = ({ children, tone = 1, style }) => h("div", { style: { ...PANEL, background: tone === 2 ? COLOR.surface2 : COLOR.surface1, ...style } }, children);
  const Row = ({ children, gap = SPACE.sm, style }) => h("div", { style: { display: "flex", alignItems: "center", gap, ...style } }, children);
  const Grid = ({ children, min = 160, gap = SPACE.sm }) => h("div", { style: { display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap } }, children);

  const EmptyState = ({ title, detail }) => h("div", {
    "data-role": "empty",
    style: { padding: px(SPACE.lg), border: `1px dashed ${COLOR.border}`, borderRadius: RADIUS.md, background: COLOR.surface1, display: "flex", flexDirection: "column", gap: SPACE.xs },
  }, h(Body, { style: { color: COLOR.muted } }, title), detail ? h(Label, null, detail) : null);

  // ── controls ────────────────────────────────────────────────────────────
  function Button({ kind = "secondary", onClick, children, title, disabled }) {
    const st = { ...CONTROL.base, ...(CONTROL[kind] || CONTROL.secondary), cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 };
    return h("button", { type: "button", title, disabled, onClick, "data-accent": kind === "primary" ? "primary" : undefined, "data-kind": kind, style: st }, children);
  }
  function useFocus() {
    const [f, setF] = React.useState(false);
    return [f, { onFocus: () => setF(true), onBlur: () => setF(false) }];
  }
  const inputStyle = (focused, invalid, extra) => ({ ...CONTROL.base, ...(invalid ? CONTROL.invalid : focused ? CONTROL.focus : null), ...extra });

  function Toggle({ value, onChange, label }) {
    const on = !!value;
    return h("button", {
      type: "button", role: "switch", "aria-checked": on, "aria-label": label, onClick: () => onChange(!on), "data-control": "toggle",
      "data-accent": on ? "selected" : undefined,
      style: { width: 32, height: 16, padding: 0, border: `1px solid ${on ? COLOR.accent : COLOR.borderStrong}`, borderRadius: RADIUS.sm,
        background: on ? COLOR.accentDim : COLOR.surface2, position: "relative", cursor: "pointer", transition: TRANSITION },
    }, h("span", { style: { position: "absolute", top: 2, left: on ? 18 : 2, width: 10, height: 10, borderRadius: RADIUS.sm,
      background: on ? COLOR.text : COLOR.label, transition: `left 120ms ease-out` } }));
  }
  function Slider({ value, min = 0, max = 1, step = 0.01, ends, onDraft, onCommit }) {
    const commit = (e) => onCommit(Number(e.target.value));
    return h("div", { "data-control": "slider", style: { display: "flex", alignItems: "center", gap: SPACE.sm, minWidth: 220 } },
      ends ? h(Label, null, ends[0]) : null,
      h("input", { type: "range", min, max, step, value, onKeyDown: stop, onChange: (e) => onDraft(Number(e.target.value)),
        onMouseUp: commit, onTouchEnd: commit, onKeyUp: commit, style: { flex: 1, accentColor: COLOR.accent }, "data-accent": "selected" }),
      ends ? h(Label, null, ends[1]) : null,
      h(Mono, { style: { width: 36, textAlign: "right" } }, typeof value === "number" ? value.toFixed(2) : DASH));
  }
  function TextField({ value, onDraft, onCommit, invalid, kind = "text", width = 160, control = "text" }) {
    const [focused, fp] = useFocus();
    return h("input", {
      type: kind, value: value == null ? "" : String(value), "data-control": control, "data-accent": focused && !invalid ? "focus" : undefined,
      onChange: (e) => onDraft(e.target.value), onFocus: fp.onFocus,
      onBlur: (e) => { fp.onBlur(); onCommit(e.target.value); },
      onKeyDown: (e) => { stop(e); if (e.key === "Enter") onCommit(e.target.value); },
      style: inputStyle(focused, invalid, { width, fontFamily: kind === "number" ? FONT.mono : FONT.sans }),
    });
  }
  const NumberInput = (p) => h(TextField, { ...p, kind: "number", width: 120, control: "number" });
  function Select({ value, options = [], onChange }) {
    const [focused, fp] = useFocus();
    return h("select", { value, onChange: (e) => onChange(e.target.value), onKeyDown: stop, ...fp, "data-control": "select",
      "data-accent": focused ? "focus" : undefined, style: inputStyle(focused, false, { width: 140 }) },
      options.map((o) => h("option", { key: o, value: o }, o)));
  }
  function ListInput({ value = [], onCommit, invalid }) {
    const [draft, setDraft] = React.useState("");
    const list = Array.isArray(value) ? value : [];
    const add = () => { const t = draft.trim(); if (!t) return; onCommit([...list, ...t.split(",").map((x) => x.trim()).filter(Boolean)].join(",")); setDraft(""); };
    return h("div", { "data-control": "list", style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: SPACE.xs } },
      list.length ? list.map((v, i) => h("span", { key: `${v}-${i}`, style: { display: "inline-flex", alignItems: "center", gap: SPACE.xs, padding: px(0, SPACE.xs),
        border: `1px solid ${COLOR.border}`, borderRadius: RADIUS.sm, background: COLOR.surface2, ...TYPE.mono } },
        String(v), h("button", { type: "button", "aria-label": `remove ${v}`, onClick: () => onCommit(list.filter((_, j) => j !== i).join(",")),
          style: { ...CONTROL.base, ...CONTROL.ghost, height: 16, padding: px(0, SPACE.xs), cursor: "pointer" } }, "×")))
        : h(Label, null, "empty"),
      h("input", { value: draft, placeholder: "add…", onChange: (e) => setDraft(e.target.value), onKeyDown: (e) => { stop(e); if (e.key === "Enter") add(); },
        style: inputStyle(false, invalid, { width: 80 }) }),
      h(Button, { onClick: add }, "Add"));
  }
  /** Geometric segmented tabs (no pills). */
  function Tabs({ tabs, value, onChange }) {
    return h("div", { role: "tablist", style: { display: "inline-flex", border: `1px solid ${COLOR.border}`, borderRadius: RADIUS.sm } },
      tabs.map((t) => {
        const sel = t.id === value;
        return h("button", { key: t.id, type: "button", role: "tab", "aria-selected": sel, onClick: () => onChange(t.id), "data-accent": sel ? "selected" : undefined,
          style: { ...CONTROL.base, border: "none", borderRadius: 0, background: sel ? COLOR.accentDim : COLOR.surface1, color: sel ? COLOR.text : COLOR.muted, cursor: "pointer" } }, t.label);
      }));
  }

  // ── data display ────────────────────────────────────────────────────────
  const KeyValue = ({ rows }) => h("div", { style: { display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: SPACE.md, rowGap: SPACE.xs } },
    (rows || []).flatMap(([k, v], i) => [
      h(Label, { key: `k${i}` }, k),
      h("div", { key: `v${i}`, style: { ...TYPE.body, fontFamily: FONT.mono, wordBreak: "break-word" } }, v == null ? DASH : typeof v === "object" && !v.$$typeof && !v.type ? fmtValue(v) : v),
    ]));

  /** Selectable table. Renders at most LAYOUT.maxRows rows (newest last is the caller's choice). */
  const DataTable = memo(function DataTable({ columns, rows, rowKey = (r, i) => i, selectedId, onSelect, empty = "No rows", maxRows = LAYOUT.maxRows }) {
    const all = rows || [];
    if (!all.length) return h(EmptyState, { title: empty });
    const shown = all.length > maxRows ? all.slice(all.length - maxRows) : all;
    const cell = (c, extra) => ({ padding: px(SPACE.xs, SPACE.sm), textAlign: c.align || "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: c.maxWidth || 360, ...extra });
    return h("div", { style: { border: `1px solid ${COLOR.border}`, borderRadius: RADIUS.md, overflow: "auto", background: COLOR.surface1 } },
      h("table", { style: { width: "100%", borderCollapse: "collapse", ...TYPE.body } },
        h("thead", null, h("tr", null, columns.map((c) => h("th", { key: c.key, style: cell(c, { ...TYPE.h3, borderBottom: `1px solid ${COLOR.border}`, background: COLOR.surface2, position: "sticky", top: 0 }) }, c.label)))),
        h("tbody", null, shown.map((r, i) => {
          const id = rowKey(r, i), sel = selectedId != null && id === selectedId;
          return h("tr", { key: id, "data-row": id, "data-accent": sel ? "selected" : undefined, onClick: onSelect ? () => onSelect(sel ? null : id) : undefined,
            style: { cursor: onSelect ? "pointer" : "default", background: sel ? COLOR.accentDim : "transparent", borderBottom: `1px solid ${COLOR.surface2}`, transition: TRANSITION } },
            columns.map((c) => h("td", { key: c.key, style: cell(c, c.mono ? { fontFamily: FONT.mono } : null) }, c.render ? c.render(r) : fmtValue(r[c.key]))));
        }))),
      all.length > maxRows ? h("div", { style: { padding: px(SPACE.xs, SPACE.sm) } }, h(Label, null, `showing last ${maxRows} of ${all.length}`)) : null);
  });

  /** List + detail side by side; detail only when a record is selected. */
  const Split = ({ list, detail }) => h("div", { style: { display: "flex", gap: SPACE.lg, alignItems: "flex-start", minHeight: 0 } },
    h("div", { style: { flex: detail ? "1 1 55%" : "1 1 100%", minWidth: 0 } }, list),
    detail ? h("div", { style: { flex: "1 1 45%", minWidth: LAYOUT.detailMinWidth, position: "sticky", top: 0 } }, detail) : null);
  const Detail = ({ title, meta, onClose, children, actions }) => h("aside", { "data-role": "detail", style: { ...PANEL, background: COLOR.surface2, display: "flex", flexDirection: "column", gap: SPACE.md } },
    h("div", { style: { display: "flex", alignItems: "flex-start", gap: SPACE.sm } },
      h("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: SPACE.xs } }, h(Heading, { level: 2, style: { wordBreak: "break-word" } }, title), meta ? h(Label, null, meta) : null),
      actions || null,
      onClose ? h(Button, { kind: "ghost", onClick: onClose, title: "Close (Esc)" }, "✕") : null),
    children);

  /** Metric tile. The run's headline KPI uses size="lg" (dominant). */
  function KpiTile({ label, k, onClick, selected, size = "md" }) {
    const st = k?.status || "none";
    return h("button", { type: "button", onClick, "data-kpi": label, "data-accent": selected ? "selected" : undefined,
      style: { textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: SPACE.xs, padding: px(SPACE.md), borderRadius: RADIUS.md,
        border: `1px solid ${selected ? COLOR.accent : COLOR.border}`, background: selected ? COLOR.accentDim : COLOR.surface1, transition: TRANSITION,
        gridColumn: size === "lg" ? "span 2" : undefined, color: COLOR.text, fontFamily: FONT.sans } },
      h(Row, { gap: SPACE.xs }, h(StatusMark, { status: st }), h("span", { style: TYPE.h3 }, label)),
      h("span", { style: { ...TYPE.kpi, fontSize: size === "lg" ? 18 : 14 } }, k?.display ?? DASH));
  }

  /** Inline SVG sparkline: one polyline, downsampled to <= 120 points. No libs, no animation. */
  const Sparkline = memo(function Sparkline({ values, width = 240, height = 40, color = COLOR.muted }) {
    const v = (values || []).filter((x) => typeof x === "number" && Number.isFinite(x));
    if (v.length < 2) return h(Label, null, "not enough data");
    const step = Math.max(1, Math.ceil(v.length / 120));
    const pts = v.filter((_, i) => i % step === 0 || i === v.length - 1);
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    const d = pts.map((y, i) => `${((i / (pts.length - 1)) * width).toFixed(1)},${(height - 2 - ((y - lo) / span) * (height - 4)).toFixed(1)}`).join(" ");
    return h("svg", { width, height, viewBox: `0 0 ${width} ${height}`, style: { display: "block" } },
      h("rect", { x: 0, y: 0, width, height, fill: COLOR.surface1 }),
      h("polyline", { points: d, fill: "none", stroke: color, strokeWidth: 1.5 }));
  });
  /** Horizontal stacked bar (allocation). Geometric, modest radius. */
  const StackBar = ({ parts, total }) => {
    const sum = total || parts.reduce((a, p) => a + (p.value > 0 ? p.value : 0), 0) || 1;
    return h("div", { style: { display: "flex", height: 12, borderRadius: RADIUS.sm, overflow: "hidden", border: `1px solid ${COLOR.border}`, background: COLOR.surface2 } },
      parts.map((p) => h("div", { key: p.label, title: `${p.label}: ${p.text ?? p.value}`, style: { width: `${(Math.max(0, p.value) / sum) * 100}%`, background: p.color, transition: "width 120ms ease-out" } })));
  };

  /** Collapsible JSON tree; strings truncated at 2 KB; children capped at 200. */
  function JsonTree({ value, name = "root", path = "$", expanded, onToggle, depth = 0, highlight }) {
    const isObj = value && typeof value === "object";
    const open = depth === 0 || !!(expanded && expanded[path]);
    const hl = highlight && (path === highlight || path.endsWith("." + highlight));
    const keyStyle = { ...TYPE.mono, color: hl ? COLOR.text : COLOR.label, fontWeight: hl ? 600 : 400 };
    if (!isObj) {
      let s = typeof value === "string" ? JSON.stringify(value.length > 2048 ? value.slice(0, 2048) + "…" : value) : String(value);
      return h("div", { style: { paddingLeft: depth ? SPACE.md : 0 } }, h("span", { style: keyStyle }, `${name}: `), h(Mono, { style: { color: COLOR.text } }, s));
    }
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);
    return h("div", { style: { paddingLeft: depth ? SPACE.md : 0 } },
      h("button", { type: "button", onClick: () => onToggle && onToggle(path), style: { background: "transparent", border: "none", padding: 0, cursor: "pointer", ...keyStyle } },
        `${open ? "▾" : "▸"} ${name} ${Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`}`),
      open ? entries.slice(0, 200).map(([k, v]) => h(JsonTree, { key: k, value: v, name: k, path: `${path}.${k}`, expanded, onToggle, depth: depth + 1, highlight })) : null,
      open && entries.length > 200 ? h(Label, null, `… ${entries.length - 200} more`) : null);
  }

  /** Isolates a view: one bad file cannot take down the shell. */
  class ErrorBoundary extends (React.Component || class {}) {
    constructor(p) { super(p); this.state = { err: null }; }
    static getDerivedStateFromError(err) { return { err }; }
    render() {
      if (this.state && this.state.err) return h(EmptyState, { title: "This view failed to render", detail: String(this.state.err && this.state.err.message || this.state.err) });
      return this.props.children;
    }
  }

  return { h, memo, useSlice, Heading, Label, Body, Mono, StatusMark, Section, Panel, Row, Grid, EmptyState, Button, Toggle, Slider, TextField, NumberInput, Select, ListInput, Tabs,
    KeyValue, DataTable, Split, Detail, KpiTile, Sparkline, StackBar, JsonTree, ErrorBoundary };
}
