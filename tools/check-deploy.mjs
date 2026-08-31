/* Is a deployment complete? One command, any URL.

   Atlas loads five modules lazily — the wallet only when somebody clicks Trade,
   which is hours after the deploy that forgot to copy it. The browser then says
   "Importing a module script failed", which names neither the file nor the
   reason. This asks for every file the app can ever need and says which ones
   are not there.

     node tools/check-deploy.mjs https://your-site.example/
     node tools/check-deploy.mjs http://localhost:8080/                        */
const base = process.argv[2] || 'http://localhost:8080/';

/* Everything index.html can pull, in the order it would need it. A single-file
   build needs none of these — it carries them — so a 404 on demo.html is not a
   finding, which is why the shape of the page is checked first. */
const NEEDED = [
  ['index.html', 'the page itself', ''],
  ['app.js', 'the app', 'nothing renders'],
  ['data.js', 'every API client', 'nothing renders'],
  ['styles.css', 'the stylesheet', 'the page is unstyled'],
  ['vendor/fuse.mjs', 'fuzzy search', 'nothing renders'],
  ['config.js', 'credentials', 'the wallet and the AI reader cannot start'],
  ['wallet.js', 'the wallet', 'Trade says "the wallet could not load"'],
  ['trade.js', 'quotes and swaps', 'a sheet cannot price a trade'],
  ['mcp.js', 'CoinGecko over MCP', 'search falls back to the local index only'],
  ['nl.js', 'the sentence reader', 'a question is searched literally'],
  ['vendor/privy.mjs', 'the wallet SDK', 'sign-in fails after the form appears'],
];

const url = p => new URL(p, base.endsWith('/') ? base : base + '/').href;
const ask = async p => {
  try {
    const r = await fetch(url(p), { redirect: 'follow' });
    const type = r.headers.get('content-type') || '';
    return { ok: r.ok, status: r.status, type, size: +(r.headers.get('content-length') || 0) };
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
for (const [file, what, cost] of NEEDED) {
  const r = await ask(file);
  const js = /\.m?js$/.test(file);
  // a host that answers 200 with an HTML error page is worse than a 404: the
  // browser fails on the first line of the "module" and blames the module
  const bad = js && r.ok && !/javascript|ecmascript/.test(r.type);
  if (!r.ok) { missing++; console.log(`  MISSING  ${file.padEnd(18)} ${String(r.status || r.err).padEnd(6)} ${what} — ${cost}`); }
  else if (bad) { wrongType++; console.log(`  WRONG    ${file.padEnd(18)} served as ${r.type} — the browser will not run it as a module`); }
  else console.log(`  ok       ${file.padEnd(18)} ${r.size ? (r.size / 1024).toFixed(0) + 'KB' : ''}`);
}

const build = await ask('demo.html');
console.log(`\n${missing} missing, ${wrongType} served with the wrong type`);
if (missing || wrongType) {
  console.log('\nEvery file above sits beside index.html in the repository. A deploy that');
  console.log('copies only some of them leaves the app looking fine until somebody opens');
  console.log('the part that needed the rest.');
  if (build.ok) console.log(`\ndemo.html is here and carries all of them inline — serving that instead works with no siblings at all.`);
}
process.exit(missing || wrongType ? 1 : 0);
