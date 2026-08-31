/* What the site is, and whether a deployment actually has it.

   This file is the only place that list lives. The Pages workflow assembles
   the site by asking this script to copy it, `npm run check <url>` asks a live
   host for every file in it, and tools/audit-code.mjs fails if the app can
   lazily load something the list does not name. That is not ceremony: the list
   used to live in a workflow, hand-written when Atlas had four files, and the
   five modules added since were silently never deployed. The app looked fine
   until somebody clicked Trade, and then reported a missing file that was
   sitting in the repository the whole time.

     node tools/check-deploy.mjs https://your-site.example/   # ask a live host
     node tools/check-deploy.mjs --copy _site                 # assemble it
     node tools/check-deploy.mjs --dir _site                  # check a directory
*/
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/* [file, what it is, what its absence costs]. Order is the order the browser
   would ask for them. */
export const SITE = [
  ['index.html', 'the page itself', 'nothing at all'],
  ['app.js', 'the app', 'nothing renders'],
  ['data.js', 'every API client', 'nothing renders'],
  ['styles.css', 'the stylesheet', 'the page is unstyled'],
  ['vendor/fuse.mjs', 'fuzzy search', 'nothing renders'],
  ['vendor/fuse.LICENSE', "Fuse's licence", 'a licence obligation is unmet'],
  ['config.js', 'credentials', 'the wallet, the reader and OpenSea cannot start'],
  ['nl.js', 'the sentence reader', 'a question is searched literally'],
  ['mcp.js', 'CoinGecko over MCP', 'search falls back to the local index only'],
  ['wallet.js', 'the wallet', 'Trade says the wallet could not load'],
  ['trade.js', 'quotes and swaps', 'a sheet cannot price a trade'],
  ['vendor/privy.mjs', 'the wallet SDK', 'sign-in fails after the form appears'],
  ['vendor/privy.LICENSE', "Privy's licence", 'a licence obligation is unmet'],
  ['demo.html', 'the single-file build', 'no copy that works with no siblings'],
  ['.nojekyll', 'the "do not process this" marker', 'the host may rewrite the files'],
];

/* Importing this file must cost nothing: audit-code reads SITE from it, and a
   list that runs a deployment check on import is a list nobody will reuse. */
const RUN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const arg = process.argv[2] || '';
const target = process.argv[3];

/* ---------- assemble ---------- */
if (RUN && arg === '--copy') {
  const out = target || '_site';
  fs.rmSync(out, { recursive: true, force: true });
  for (const [file] of SITE) {
    const to = path.join(out, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!fs.existsSync(file)) {
      console.error(`missing from the repository: ${file}`);
      process.exit(1);
    }
    fs.copyFileSync(file, to);
  }
  console.log(`${out}: ${SITE.length} files`);
  process.exit(0);
}

/* ---------- check a directory ---------- */
if (RUN && arg === '--dir') {
  const dir = target || '_site';
  const missing = SITE.filter(([f]) => !fs.existsSync(path.join(dir, f)));
  for (const [f, what, cost] of missing) console.log(`  MISSING  ${f.padEnd(20)} ${what} — ${cost}`);
  console.log(`\n${missing.length} missing from ${dir}`);
  process.exit(missing.length ? 1 : 0);
}

/* ---------- ask a live host ---------- */
if (!RUN) { /* imported for the list alone */ } else {
const base = arg || 'http://localhost:8080/';
const url = p => new URL(p, base.endsWith('/') ? base : base + '/').href;
const ask = async p => {
  try {
    const r = await fetch(url(p), { redirect: 'follow' });
    return { ok: r.ok, status: r.status, type: r.headers.get('content-type') || '',
      size: +(r.headers.get('content-length') || 0) };
  } catch (e) { return { ok: false, status: 0, err: e.message }; }
};

const page = await ask('index.html');
if (!page.ok) {
  console.log(`${url('index.html')} — ${page.status || page.err}`);
  console.log('\nNothing else is worth checking until the page itself is served.');
  process.exit(1);
}

console.log(`Checking ${base}\n`);
let missing = 0, wrongType = 0;
for (const [file, what, cost] of SITE) {
  const r = await ask(file);
  const js = /\.m?js$/.test(file);
  // a host that answers 200 with an HTML error page is worse than a 404: the
  // browser fails on the first line of the "module" and blames the module
  const bad = js && r.ok && !/javascript|ecmascript/.test(r.type);
  if (!r.ok) { missing++; console.log(`  MISSING  ${file.padEnd(20)} ${String(r.status || r.err).padEnd(5)} ${what} — ${cost}`); }
  else if (bad) { wrongType++; console.log(`  WRONG    ${file.padEnd(20)} served as ${r.type}`); }
  else console.log(`  ok       ${file.padEnd(20)} ${r.size ? (r.size / 1024).toFixed(0) + 'KB' : ''}`);
}

console.log(`\n${missing} missing, ${wrongType} served with the wrong type`);
if (missing || wrongType)
  console.log('\nEvery file above is in the repository. A deploy that copies only some of'
    + '\nthem leaves the app looking fine until somebody opens the part that needed'
    + '\nthe rest. `node tools/check-deploy.mjs --copy _site` assembles the set.');
process.exit(missing || wrongType ? 1 : 0);
}
