// Bundles the site into one self-contained demo.html — no server, no install.
// Each module is wrapped in an IIFE so minified internals (Fuse declares `$`,
// so does app.js) cannot collide at shared scope.
//   node build.mjs
import fs from 'node:fs';

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

fs.writeFileSync('demo.html', html);
console.log(`demo.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)}KB`);
