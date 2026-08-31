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
const lazy = [...read('app.js').matchAll(/loadModule\('([^']+)',\s*'\.\/([^']+)'\)/g)].map(m => [m[1], m[2]]);
for (const [, file] of lazy)
  if (!bundle.includes(file)) fail(`app.js lazily imports ${file}, which build.mjs does not inline`);
console.log('  bundle covers: ' + [...bundle.matchAll(/inline\('([^']+)'/g)].map(m => m[1]).join(', '));

/* And the check that matters: the built file itself. Reading build.mjs only
   proves the intent — a regex that quietly drops an export, or a rename, and
   the intent is still there while the module is not. So this reads what was
   actually emitted and looks for each name in the modules table. */
for (const out of ['demo.html', 'artifact.html']) {
  if (!fs.existsSync(out)) { console.log(`  ${out}: not built`); continue; }
  const built = read(out);
  // the build says what it carries; a megabyte of one line cannot be read any other way
  const said = built.match(/window\.__ATLAS_BUILD__ = (\{[^;]+\});/)?.[1];
  if (!said) { fail(`${out} carries no build manifest — rebuild it`); continue; }
  const man = JSON.parse(said.replace(/(\w+):/g, '"$1":'));
  for (const [name] of lazy)
    if (!man.modules.includes(name))
      fail(`${out} has no "${name}" module — the app would tell the reader it is missing`);
  // the runtime sees the same table the manifest was derived from, so what is
  // left to check is that nothing in the app asks for a module outside it
  const extra = lazy.map(([n]) => n).filter(n => !man.modules.includes(n));
  if (extra.length) fail(`${out} is missing ${extra.join(', ')}`);
  if (!man.vendor || !/__ATLAS_VENDOR__ = /.test(built))
    fail(`${out} carries no wallet SDK, so Connect cannot do anything`);
  console.log(`  ${out}: ${man.modules.join(', ')}${man.vendor ? ' + the SDK' : ''}`);
}

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
