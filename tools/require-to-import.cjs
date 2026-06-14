#!/usr/bin/env node
/*
 * Codemod: top-level require() -> ES import in the given .ts files.
 * Import-only (keeps module.exports — see TS_MIGRATION_PLAN.md). Handles
 * single- and multi-line destructures; skips comments, member-access/call
 * requires (`require('x').y`, `require('x')(...)`), and lazy/conditional
 * requires inside functions (those aren't at column 0). Preserves trailing
 * line comments.
 *
 * Usage: node tools/require-to-import.cjs <file.ts> [file.ts ...]
 */
const fs = require('fs');

const files = process.argv.slice(2);
let changed = 0;

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  let s = before;

  // const { a, b } = require('Y');   ([^}] spans newlines -> multi-line too)
  s = s.replace(
    /^const\s*(\{[^}]*\})\s*=\s*require\((['"][^'"]+['"])\)\s*;?([ \t]*\/\/.*)?$/gm,
    (_m, names, mod, cmt) => `import ${names} from ${mod};${cmt || ''}`
  );

  // const X = require('Y');
  s = s.replace(
    /^const\s+([A-Za-z0-9_$]+)\s*=\s*require\((['"][^'"]+['"])\)\s*;?([ \t]*\/\/.*)?$/gm,
    (_m, name, mod, cmt) => `import ${name} from ${mod};${cmt || ''}`
  );

  // require('Y');   (side-effect)
  s = s.replace(
    /^require\((['"][^'"]+['"])\)\s*;?([ \t]*\/\/.*)?$/gm,
    (_m, mod, cmt) => `import ${mod};${cmt || ''}`
  );

  if (s !== before) {
    fs.writeFileSync(file, s);
    changed += 1;
  }
}

console.log(`require-to-import: updated ${changed}/${files.length} file(s)`);
