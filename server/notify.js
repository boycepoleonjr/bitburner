// Outbound notifications: Discord webhook (reports + short text) and the Claude routine API trigger (escalation).
// Nothing here throws to callers; failures are logged with sanitized details only.

export const LIMITS = { title: 256, fieldName: 256, fieldValue: 1024, footer: 2048, description: 4096, fields: 25, total: 6000, content: 2000 };
export const COLORS = { down: 0x808080, attention: 0xed4245, warn: 0xfee75c, ok: 0x57f287 };
const FULL_WIDTH = new Set(["status", "activity", "next event"]);
export const ESCALATE_MAX_BYTES = 8 * 1024;
export const TRUNC_MARK = "\n[report truncated; retrieve full report from GET /api/report]";

// First line only; strips bearer tokens, URLs and token=... values.
export function sanitize(e, max = 200) {
  const s = String((e && e.message) || e || "").split("\n")[0]
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/(token|key|secret|password)=[^\s&]+/gi, "$1=[redacted]");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

const cut = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

export function buildReportEmbed(rec) {
  const color = !rec.ok ? COLORS.down : rec.attention?.length ? COLORS.attention : rec.warn?.length ? COLORS.warn : COLORS.ok;
  const notes = (rec.warn || []).join("\n") || "—";
  const footer = { text: cut(`Notes: ${notes}`, LIMITS.footer) };
  if (!rec.ok) return { title: "Bitburner check-in — DOWN", description: cut(rec.error || "check-in failed", LIMITS.description), color, footer };

  const lines = String(rec.report || "").split("\n");
  const first = lines.find((l) => l.trim()) || "";
  const title = cut(first.replace(/\*\*/g, "").trim() || "Bitburner check-in", LIMITS.title);
  const fields = [];
  for (const l of lines) {
    const m = /^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|$/.exec(l.trim());
    if (!m || /^-+$/.test(m[1]) || !m[1].trim()) continue;
    fields.push({ name: cut(m[1], LIMITS.fieldName), value: cut(m[2], LIMITS.fieldValue), inline: !FULL_WIDTH.has(m[1].toLowerCase()) });
  }
  if (!fields.length) return { title: "Bitburner check-in", description: cut(rec.report || "(empty report)", LIMITS.description), color, footer };

  // Enforce Discord's field-count and aggregate-size limits by dropping fields from the end.
  const size = (fs) => title.length + footer.text.length + fs.reduce((a, f) => a + f.name.length + f.value.length, 0);
  let kept = fields.slice(0, LIMITS.fields);
  const more = () => fields.length - kept.length;
  while (kept.length && size(kept) + 40 > LIMITS.total) kept = kept.slice(0, -1); // 40 = room for the "+N more" line
  const embed = { title, color, fields: kept, footer };
  if (more()) embed.description = `(+${more()} more rows in GET /api/report)`;
  return embed;
}

export function buildEscalationText(rec) {
  const head = `Bitburner escalation\n\nAttention:\n${(rec.attention || []).map((a) => `- ${a}`).join("\n")}\n\nLatest report:\n`;
  let text = head + (rec.report || "");
  if (Buffer.byteLength(text, "utf8") <= ESCALATE_MAX_BYTES) return text;
  const budget = ESCALATE_MAX_BYTES - Buffer.byteLength(TRUNC_MARK, "utf8");
  let buf = Buffer.from(text, "utf8").subarray(0, budget).toString("utf8");
  while (Buffer.byteLength(buf, "utf8") > budget || buf.endsWith("�")) buf = buf.slice(0, -1);
  return buf + TRUNC_MARK;
}

export function createNotifier({ webhookUrl = "", escalateUrl = "", escalateToken = "", log = () => {}, fetchImpl = globalThis.fetch }) {
  const post = async (what, body) => {
    if (!webhookUrl) return false;
    try {
      const r = await fetchImpl(webhookUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
      if (!r.ok) { let t = ""; try { t = await r.text(); } catch { } log(`discord ${what}: HTTP ${r.status} ${sanitize(t, 120)}`); return false; }
      return true;
    } catch (e) { log(`discord ${what}: ${sanitize(e)}`); return false; }
  };
  const discordText = async (text) => {
    if (typeof text !== "string" || !text.trim()) return false;
    return post("text", { username: "Bitburner", content: cut(text.trim(), LIMITS.content) });
  };
  return {
    discordReport: (rec) => post("report", { username: "Bitburner", embeds: [buildReportEmbed(rec)] }),
    discordText,
    escalationEnabled: Boolean(escalateUrl && escalateToken),
    // Fires the Claude routine once. Resolves to {ok, url?}; never throws, never retries.
    async fireRoutine(text) {
      if (!escalateUrl || !escalateToken) return { ok: false, skipped: true };
      let r;
      try {
        r = await fetchImpl(escalateUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${escalateToken}`, "anthropic-beta": "experimental-cc-routine-2026-04-01", "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ text }), signal: AbortSignal.timeout(30000),
        });
      } catch (e) { log(`escalation: ${sanitize(e)}`); return { ok: false }; }
      if (!r.ok) { let t = ""; try { t = await r.text(); } catch { } log(`escalation: HTTP ${r.status} ${sanitize(t, 120)}`); return { ok: false }; }
      let url = null;
      try { const j = await r.json(); if (typeof j?.claude_code_session_url === "string" && /^https:\/\/claude\.ai\//.test(j.claude_code_session_url)) url = j.claude_code_session_url; } catch { }
      log(`escalation fired${url ? ": " + url : ""}`);
      await discordText(url ? `escalated to Claude: ${url}` : "escalated to Claude");
      return { ok: true, url };
    },
  };
}
