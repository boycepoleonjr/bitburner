/**
 * lib/ui/settings-model.js — turns lib/settings-schema.js metadata into control view models. PURE.
 * One control per schema key; the control type comes from the field's `ui` hint.
 */
export const CONTROL_FOR_UI = Object.freeze({ toggle: "toggle", slider: "slider", number: "number", select: "select", text: "text", list: "list" });

/**
 * @param {Array} schema   SCHEMA
 * @param {Object} values  effective values (flat keys)
 * @param {Object} overrides explicit overrides stored in data/settings.txt
 * @param {Object} drafts  in-progress edits (not yet committed)
 * @param {Object} errors  last validation error per key
 */
export function controlsFromSchema(schema, values = {}, overrides = {}, drafts = {}, errors = {}) {
  return (schema || []).map((f) => {
    const value = values[f.key] !== undefined ? values[f.key] : f.default;
    const hasDraft = Object.prototype.hasOwnProperty.call(drafts, f.key);
    return {
      key: f.key, group: f.group, label: f.label, help: f.help, owner: f.owner, type: f.type,
      control: CONTROL_FOR_UI[f.ui] || "text",
      value, shown: hasDraft ? drafts[f.key] : value, dirty: hasDraft,
      defaultValue: f.default,
      overridden: Object.prototype.hasOwnProperty.call(overrides || {}, f.key),
      differsFromDefault: JSON.stringify(value) !== JSON.stringify(f.default),
      error: errors[f.key] || null,
      min: f.min, max: f.max, step: f.step, options: f.options, ends: f.ends,
    };
  });
}

/** Group control models in GROUPS order. */
export function groupControls(groups, controls) {
  return (groups || []).map((g) => ({ ...g, controls: controls.filter((c) => c.group === g.id) })).filter((g) => g.controls.length);
}
