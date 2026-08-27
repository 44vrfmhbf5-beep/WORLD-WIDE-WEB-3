// Bundles the site into one self-contained demo.html — no server, no install.
// Each module is wrapped in an IIFE so minified internals (Fuse declares `$`,
// so does app.js) cannot collide at shared scope.
//   node build.mjs
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(f, 'utf8');

const fuse = read('vendor/fuse.mjs').replace(/export\s*\{\s*re as default\s*\}\s*;?\s*$/, 'return re;');
if (!fuse.includes('return re;')) throw new Error('fuse export shape changed — bundler needs updating');

const NAMES = ['CHAINS', 'CH', 'ApiError', 'loadAssets', 'loadPools', 'loadAssetChart', 'loadPoolChart', 'links'];
const data = read('data.js').replace(/^export\s+/gm, '');

const app = read('app.js').replace(/^import[^;]+;$/gm, '');

const js = `
const Fuse = (() => {\n${fuse}\n})();
const { ${NAMES.join(', ')} } = (() => {\n${data}\nreturn { ${NAMES.join(', ')} };\n})();
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

fs.writeFileSync('demo.html', html);
console.log(`demo.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)}KB`);
