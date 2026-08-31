/* Static audit of the whole codebase, in one command.

   The other five audits open a browser and look at what renders. This one
   never runs the app: it reads the source and asks the questions a person
   cannot hold in their head across 5,000 lines — is anything exported that
   nothing imports, is anything imported that nothing exports, does the bundler
   know about every export it has to carry, is anything declared and never used.

   oxlint (a dev dependency, and the only one besides Playwright) does the
   last of those. The rest are specific to how this repo is put together, so
   they are here.
     node tools/audit-code.mjs                                                */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = f => fs.readFileSync(f, 'utf8');
const SRC = ['app.js', 'data.js', 'nl.js', 'mcp.js', 'trade.js', 'wallet.js', 'config.js'];
let bad = 0;
const fail = m => { bad++; console.log('  BROKEN: ' + m); };

/* The bundler's own reader, so a mismatch between what it finds and what the
   modules export is a finding rather than a runtime "X is not defined". */
const EXPORTS = /^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
const exportsOf = src => [...src.matchAll(EXPORTS)].map(m => m[1]);
const importsOf = src => [...src.matchAll(/^import\s*\{([^}]+)\}\s*from\s*'([^']+)'/gm)]
  .map(m => [m[1].split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(Boolean), m[2]]);

console.log('# every import resolves to an export');
const has = new Map(SRC.map(f => [f, new Set(exportsOf(read(f)))]));
for (const f of SRC) {
  for (const [names, from] of importsOf(read(f))) {
    const target = from.replace(/^\.\//, '');
    if (!has.has(target)) continue;                 // vendored or built-in
    for (const n of names)
      if (!has.get(target).has(n)) fail(`${f} imports ${n} from ${target}, which does not export it`);
  }
}
console.log(`  ${SRC.length} modules, ${[...has.values()].reduce((a, s) => a + s.size, 0)} exports`);

console.log('\n# the bundler carries every export the app uses');
const bundle = read('build.mjs');
if (!EXPORTS.source.includes('async')) fail('build.mjs export reader would miss `export async function`');
for (const f of ['config.js', 'nl.js', 'mcp.js'])
  if (!bundle.includes(f)) fail(`${f} is dynamically imported but not inlined by build.mjs`);
// what app.js loads lazily must be either a file next to it or inlined
for (const m of [...read('app.js').matchAll(/loadModule\('([^']+)',\s*'\.\/([^']+)'\)/g)])
  if (!bundle.includes(m[2])) fail(`app.js lazily imports ${m[2]}, which build.mjs does not inline`);
console.log('  bundle covers: ' + [...bundle.matchAll(/inline\('([^']+)'/g)].map(m => m[1]).join(', '));

console.log('\n# nothing is exported into the void');
/* An export nothing imports is either dead weight or — the case that actually
   bites — something written, wired into a comment, and never called. */
const corpus = [...SRC, 'build.mjs',
  ...fs.readdirSync('test').filter(f => f.endsWith('.mjs')).map(f => 'test/' + f),
  ...fs.readdirSync('tools').filter(f => f.endsWith('.mjs')).map(f => 'tools/' + f),
].map(read).join('\n');
for (const f of SRC) {
  for (const n of exportsOf(read(f))) {
    const hits = (corpus.match(new RegExp(`\\b${n}\\b`, 'g')) || []).length;
    if (hits <= 1) fail(`${f} exports ${n}, and nothing anywhere uses it`);
  }
}

console.log('\n# the linter');
try {
  const out = execFileSync('./node_modules/.bin/oxlint', [...SRC, 'build.mjs'], { encoding: 'utf8' });
  const warns = (out.match(/warning/g) || []).length;
  console.log(`  ${warns} warning(s)`);
  for (const line of out.split('\n').filter(l => /no-unused-vars|no-undef/.test(l)))
    console.log('  ' + line.trim());
} catch (e) {
  console.log('  oxlint not installed — npm install first');
}

console.log(`\n${bad} structural problem(s)`);
process.exit(bad ? 1 : 0);
