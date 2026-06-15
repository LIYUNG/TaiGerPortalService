#!/usr/bin/env node
/*
 * Convert top-level require() -> ES import in the given .ts files. Handles
 * single/multi-line destructures (incl. `{ a: b }` -> `{ a as b }`), default,
 * and side-effect requires. Skips comments, member-access/call requires
 * (`require('x').y`, `require('x')(...)`), and indented (lazy/conditional)
 * requires. `jest.mock(...)` is untouched (ts-jest hoists it above imports).
 */
const fs = require('fs');

const files = process.argv.slice(2);
let changed = 0;

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  let s = before;

  // const { a, b } = require('Y');   (single OR multi-line)
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

  // fix renamed destructures inside the generated imports: { a: b } -> { a as b }
  s = s.replace(
    /import\s*\{([^}]*)\}\s*from\s*('[^']+'|"[^"]+")/g,
    (_m, inner, mod) =>
      `import {${inner.replace(/([A-Za-z0-9_$]+)\s*:\s*([A-Za-z0-9_$]+)/g, '$1 as $2')}} from ${mod}`
  );

  if (s !== before) {
    fs.writeFileSync(file, s);
    changed += 1;
  }
}

console.log(`require-to-import: updated ${changed}/${files.length} file(s)`);
