/**
 * lib/ui/tokens.js — the ONLY source of style values for the dashboard. PURE.
 * Rules (enforced by test/dashboard.js):
 *  - every margin / padding / gap is a SPACE value; every borderRadius is a RADIUS value (max 4, no pills)
 *  - every fontSize is a TYPE size; no boxShadow; no animation, only TRANSITION on state changes
 *  - COLOR.accent / COLOR.accentDim appear only on elements tagged data-accent="primary" | "selected" | "focus"
 * Never reference window/document in the dashboard import graph (Bitburner charges 25 GB for each).
 */

/** Spacing scale (px). Compact inside a data group (xs/sm), generous between sections (xl). */
export const SPACE = Object.freeze({ none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 });
export const SPACE_SCALE = Object.freeze([0, 4, 8, 12, 16, 24, 32]);

/** Modest, geometric corners only. */
export const RADIUS = Object.freeze({ none: 0, sm: 2, md: 4 });

/** Tonal surfaces (bg < surface1 < surface2 < surface3), subtle borders, one accent. */
export const COLOR = Object.freeze({
  bg: "#0b0f14",
  surface1: "#10161d",
  surface2: "#161e27",
  surface3: "#1d2732",
  border: "#253140",
  borderStrong: "#33414f",
  text: "#d8e0e8",
  muted: "#a3afbb",
  label: "#6e7c8a",
  accent: "#2fd08a",
  accentDim: "#123d2b",
  accentText: "#06140d",
  good: "#58b96f",
  warn: "#d6a542",
  bad: "#e0645c",
});
export const ACCENT_VALUES = Object.freeze([COLOR.accent, COLOR.accentDim]);

export const FONT = Object.freeze({
  sans: "inherit",
  mono: "\"Lucida Console\", \"Courier New\", monospace",
});

/** Distinct heading levels, readable body, subdued labels. */
export const TYPE = Object.freeze({
  h1: { fontSize: 18, fontWeight: 600, lineHeight: 1.25, color: COLOR.text },
  h2: { fontSize: 14, fontWeight: 600, lineHeight: 1.3, color: COLOR.text },
  h3: { fontSize: 11, fontWeight: 600, lineHeight: 1.3, color: COLOR.label, textTransform: "uppercase", letterSpacing: 0.6 },
  body: { fontSize: 12, fontWeight: 400, lineHeight: 1.45, color: COLOR.text },
  meta: { fontSize: 11, fontWeight: 400, lineHeight: 1.4, color: COLOR.label },
  mono: { fontSize: 11, fontFamily: FONT.mono, color: COLOR.muted },
  kpi: { fontSize: 18, fontWeight: 600, lineHeight: 1.2, color: COLOR.text, fontFamily: FONT.mono },
});
export const TYPE_SIZES = Object.freeze([11, 12, 14, 18]);

/** Short transitions on state changes only. */
export const MOTION = Object.freeze({ fast: "120ms ease-out" });
export const TRANSITION = `background-color ${MOTION.fast}, border-color ${MOTION.fast}, color ${MOTION.fast}`;

export const LAYOUT = Object.freeze({ sidebarWidth: 148, detailMinWidth: 280, controlHeight: 24, rowHeight: 22, maxRows: 200 });

export const STATUS_COLOR = Object.freeze({ good: COLOR.good, warn: COLOR.warn, bad: COLOR.bad, none: COLOR.label });

const px = (...n) => n.map((v) => `${v}px`).join(" ");

/** Shared control styles: every button/input uses these, so controls look the same everywhere. */
export const CONTROL = Object.freeze({
  base: {
    height: LAYOUT.controlHeight, padding: px(0, SPACE.sm), fontSize: 12, color: COLOR.text, background: COLOR.surface2,
    border: `1px solid ${COLOR.border}`, borderRadius: RADIUS.sm, outline: "none", transition: TRANSITION, boxSizing: "border-box",
    fontFamily: FONT.sans,
  },
  primary: { background: COLOR.accent, color: COLOR.accentText, border: `1px solid ${COLOR.accent}`, fontWeight: 600 },
  secondary: { background: COLOR.surface2, color: COLOR.text },
  ghost: { background: "transparent", border: `1px solid ${COLOR.border}`, color: COLOR.muted },
  focus: { border: `1px solid ${COLOR.accent}` },
  invalid: { border: `1px solid ${COLOR.bad}` },
});

export const PANEL = Object.freeze({
  background: COLOR.surface1, border: `1px solid ${COLOR.border}`, borderRadius: RADIUS.md, padding: px(SPACE.md),
});

export { px };
