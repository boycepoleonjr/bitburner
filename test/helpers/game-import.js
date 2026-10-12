// Lets Node import in-game modules. Bitburner resolves imports like "lib/config.js" from the home root; Node would
// treat that as a package name. This maps any bare specifier that exists under game/ to that file.
//   import { importGame } from "./helpers/game-import.js";
//   const { readSettings } = await importGame("lib/settings.js");
import fs from "node:fs";
import path from "node:path";
import module from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../game");
const toGame = (spec) => {
  if (/^(node:|\.|\/|[a-z]+:)/.test(spec)) return null;
  const p = path.join(GAME, spec.replace(/^\//, ""));
  return fs.existsSync(p) ? pathToFileURL(p).href : null;
};

if (typeof module.registerHooks === "function") {
  module.registerHooks({ resolve(spec, ctx, next) { const u = toGame(spec); return u ? { url: u, shortCircuit: true } : next(spec, ctx); } });
} else {
  const src = `import fs from "node:fs";import path from "node:path";import {pathToFileURL} from "node:url";const G=${JSON.stringify(GAME)};
export async function resolve(s,c,n){if(!/^(node:|\\.|\\/|[a-z]+:)/.test(s)){const p=path.join(G,s.replace(/^\\//,""));if(fs.existsSync(p))return{url:pathToFileURL(p).href,shortCircuit:true};}return n(s,c);}`;
  module.register("data:text/javascript," + encodeURIComponent(src));
}

export const importGame = (rel) => import(pathToFileURL(path.join(GAME, rel)).href);

/** Minimal in-memory ns for file-level tests: read/write/getScriptName. Extend per test. */
export function fakeFsNs(files = {}) {
  return {
    files,
    read: (f) => files[f.replace(/^\//, "")] ?? "",
    write: (f, data, mode = "a") => { const k = f.replace(/^\//, ""); files[k] = mode === "w" ? String(data) : (files[k] ?? "") + String(data); },
    fileExists: (f) => f.replace(/^\//, "") in files,
    getScriptName: () => "test.js",
  };
}
