// Bundles the site into one self-contained demo.html — no server, no install.
// Each module is wrapped in an IIFE so minified internals (Fuse declares `$`,
// so does app.js) cannot collide at shared scope.
//   node build.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(f, 'utf8');

/* One reader for every module's exports. It used to be two, and the one used
   for data.js did not know about `export async function` — so an async export
   was simply absent from the bundle and the single-file build died at runtime
   with "X is not defined". A regex that silently omits things is worse than no
   regex, so there is now exactly one. */
const exportsOf = src => [...src.matchAll(
  /^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);

const fuse = read('vendor/fuse.mjs').replace(/export\s*\{\s*re as default\s*\}\s*;?\s*$/, 'return re;');
if (!fuse.includes('return re;')) throw new Error('fuse export shape changed — bundler needs updating');

const dataSrc = read('data.js');
// derived, not hand-listed: a hand-kept list silently drops a newly added export
// and the bundle dies at runtime with "X is not defined"
const NAMES = exportsOf(dataSrc);
if (!NAMES.length) throw new Error('no exports found in data.js');
const data = dataSrc.replace(/^export\s+/gm, '');

const app = read('app.js').replace(/^import[^;]+;$/gm, '');

/* A dynamic import in a single-file build has nothing to fetch: there is no
   ./config.js sitting next to demo.html. Two of those modules have no reason to
   be separate — config is a literal, and the query reader only needs the chain
   table — so they are inlined and handed to the app the same way the bundle
   hands it Fuse. Anything genuinely unbundlable (the wallet, and the 900KB SDK
   behind it) stays absent, and the app says so rather than reporting a module
   error as a network failure. */

const inline = (f, pre = '') => {
  const src = read(f);
  const names = exportsOf(src);
  if (!names.length) throw new Error(`no exports found in ${f} — bundler needs updating`);
  /* Imports are dropped because what they name is already in scope in the
     bundle — except where one inlined module imports another, which no longer
     is: config lives inside its own closure. `pre` hands those bindings in. */
  const body = src.replace(/^import[^;]+;$/gm, '').replace(/^export\s+/gm, '');
  return `(() => {\n${pre}${body}\nreturn { ${names.join(', ')} };\n})()`;
};
/* The wallet used to be the one thing left out — 900KB of vendored SDK, and a
   single-file build was told it simply had no wallet. That made the published
   build a search engine that could only ever hand you off somewhere else,
   which is precisely what the wallet exists to stop. It costs a megabyte; the
   alternative costs the feature. */
const privySrc = read('vendor/privy.mjs');
/* The SDK's export line is one enormous `export{a as B,c as D,…}`. Only two of
   those names are ever used, so the wrapper hands back exactly those two —
   found by name rather than by their minified aliases, which change on every
   rebuild of the vendor file. */
const privyExports = privySrc.match(/export\s*\{([^}]*)\}\s*;?\s*$/m);
if (!privyExports) throw new Error('privy export shape changed — bundler needs updating');
const alias = want => {
  const hit = privyExports[1].split(',')
    .map(x => x.trim().split(/\s+as\s+/).map(y => y.trim()))
    .find(([, as]) => as === want);
  if (!hit) throw new Error(`privy no longer exports ${want} — bundler needs updating`);
  return hit[0];
};
const privy = `(() => {\n${privySrc.replace(/export\s*\{[^}]*\}\s*;?\s*$/m,
  `return { default: ${alias('default')}, LocalStorage: ${alias('LocalStorage')} };`)}\n})()`;

/* trade.js imports from wallet.js, so wallet has to be inlined first and its
   exports handed in — the same dependency the config closure has, one level
   deeper. */
const walletPre = 'const { config } = __cfg;\n';
const tradePre = 'const { config } = __cfg;\nconst { '
  + exportsOf(read('wallet.js')).join(', ') + ' } = __wallet;\n';

const modules = `const __cfg = ${inline('config.js')};\n`
  + `window.__ATLAS_VENDOR__ = ${privy};\n`
  + `const __wallet = ${inline('wallet.js', walletPre)};\n`
  + `window.__ATLAS_MODULES__ = { config: __cfg, nl: ${inline('nl.js')}, `
  + `mcp: ${inline('mcp.js', 'const { config } = __cfg;\n')}, `
  + `wallet: __wallet, trade: ${inline('trade.js', tradePre)} };`;

// --artifact: bundle the sample dataset and emit body-level content only, since
// the Artifact host supplies its own <!doctype>/<html>/<head>/<body> wrapper.
const ARTIFACT = process.argv.includes('--artifact');
const sample = ARTIFACT ? read('sample.js') : '';

const js = `
${sample ? '(() => {\n' + sample + '\n})();\n' : ''}
const Fuse = (() => {\n${fuse}\n})();
const { ${NAMES.join(', ')} } = (() => {\n${data}\nreturn { ${NAMES.join(', ')} };\n})();
${modules}
${app}`;

// NB: every replacement is a function. A string replacement would expand the
// $-patterns ($&, $', $1...) inside the code being inlined — app.js contains
// "'$' + n" and that silently corrupts the bundle.
const html = read('index.html')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${read('styles.css')}\n</style>`)
  .replace('<script type="module" src="app.js"></script>', () => `<script type="module">\n${js}\n</script>`)
  .replace('<title>', () => '<!-- Single-file build. Source: https://github.com/44vrfmhbf5-beep/WORLD-WIDE-WEB-3 -->\n<title>');

// Parse what is actually emitted, not the string that went in: an earlier build
// shipped corrupt because a string replacement expanded $-patterns in the
// inlined code, so the damage happened during the splice, not before it.
const emitted = html.match(/<script type="module">\n([\s\S]*?)\n<\/script>/)?.[1];
if (!emitted) throw new Error('bundle: could not find the emitted script block');
try { new vm.Script(emitted); }
catch (e) { throw new Error(`bundle is not valid JavaScript: ${e.message}`); }

const out = ARTIFACT ? artifactPage(html) : html;
const name = ARTIFACT ? 'artifact.html' : 'demo.html';
fs.writeFileSync(name, out);
console.log(`${name}  ${(Buffer.byteLength(out) / 1024).toFixed(0)}KB`);

function artifactPage(doc) {
  const head = doc.match(/<head>([\s\S]*?)<\/head>/)[1];
  const body = doc.match(/<body>([\s\S]*?)<\/body>/)[1];
  const style = head.match(/<style>[\s\S]*?<\/style>/)[0];
  const title = head.match(/<title>[\s\S]*?<\/title>/)[0];
  const meta = head.match(/<meta name="description"[^>]*>/)[0];
  const fonts = head.match(/<link rel="preconnect"[\s\S]*?onload="this\.media='all';this\.onload=null">/)[0];

  // The host supplies its own <head>, so this page cannot declare a charset.
  // Fuse ships a Unicode diacritics table; decoded as anything but UTF-8 those
  // bytes become mojibake and the script dies with a syntax error. Emit pure
  // ASCII instead: \uXXXX in the script, numeric references in the markup.
  const esc7 = s => s.replace(/[^\x00-\x7F]/g,
    c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const ent = s => s.replace(/[^\x00-\x7F]/g, c => '&#' + c.charCodeAt(0) + ';');

  const page = [title, meta, fonts, style, body].join('\n');
  const out = page.replace(/(<script type="module">)([\s\S]*?)(<\/script>)/,
    (_, a, code, z) => a + esc7(code) + z);
  const [before, script] = [out.slice(0, out.indexOf('<script type="module">')), out.slice(out.indexOf('<script type="module">'))];
  const ascii = ent(before) + script;
  if (/[^\x00-\x7F]/.test(ascii)) throw new Error('artifact page is not pure ASCII');
  return ascii;
}
