#!/usr/bin/env node
/*
 * Codemod: module.exports -> TS export, runtime-identical & require-compatible.
 *   module.exports = { a, b };   (pure shorthand) -> export { a, b };
 *   module.exports = <anything else>;            -> export = <anything else>;
 * `export { a, b }` emits exports.a/exports.b (require consumers keep working via
 * property access); `export =` emits module.exports = X (no __esModule, so
 * `require()` returns X directly). Objects with nested braces (inline method
 * literals) are left untouched (rare; handle by hand). See TS_MIGRATION_PLAN.md.
 *
 * Usage: node tools/module-exports-to-export.cjs <file.ts> [...]
 */
const fs = require('fs');

const files = process.argv.slice(2);
let named = 0;
let eq = 0;

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  let s = before;

  // module.exports = { ...no nested braces... };  (single or multi-line)
  s = s.replace(
    /^module\.exports = (\{[^{}]*\})\s*;?[ \t]*$/gm,
    (_m, obj) => {
      const inner = obj.slice(1, -1);
      const stripped = inner
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      if (stripped.trim() && /^[A-Za-z0-9_$\s,]+$/.test(stripped)) {
        named += 1;
        return `export {${inner}};`;
      }
      eq += 1;
      return `export = ${obj};`;
    }
  );

  // module.exports = <non-object expr>;
  s = s.replace(
    /^module\.exports = ([^;{][^;]*?)\s*;?[ \t]*$/gm,
    (_m, expr) => {
      eq += 1;
      return `export = ${expr};`;
    }
  );

  if (s !== before) fs.writeFileSync(file, s);
}

console.log(`module.exports->export: ${named} named, ${eq} export=`);
