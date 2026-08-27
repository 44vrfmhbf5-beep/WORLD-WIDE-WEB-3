// Replays CoinGecko + DeFiLlama response shapes locally so the UI can be tested
// end to end without network access. MODE=ok|slow|429|down|partial
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.env.MODE || 'ok';
const PORT = +(process.env.PORT || 8899);

const NAMES = [['bitcoin','BTC','Bitcoin'],['ethereum','ETH','Ethereum'],['solana','SOL','Solana'],
  ['tether','USDT','Tether'],['usd-coin','USDC','USDC'],['binancecoin','BNB','BNB'],
  ['lido-staked-ether','STETH','Lido Staked Ether'],['jito-governance-token','JTO','Jito'],
  ['jupiter-exchange-solana','JUP','Jupiter'],['aave','AAVE','Aave'],['chainlink','LINK','Chainlink'],
  ['sui','SUI','Sui'],['aptos','APT','Aptos'],['hyperliquid','HYPE','Hyperliquid'],
  ['wrapped-bitcoin','WBTC','Wrapped Bitcoin'],['avalanche-2','AVAX','Avalanche'],
  ['arbitrum','ARB','Arbitrum'],['optimism','OP','Optimism'],['aerodrome-finance','AERO','Aerodrome'],
  // hostile name: onchain strings are attacker-controlled, the UI must escape them
  ['evil-token','<img src=x onerror="window.__XSS=1">','"><script>window.__XSS=1</script>']];
const PRICES = { BTC:96240, ETH:3412.8, SOL:186.42, USDT:1.0001, USDC:0.9999, BNB:712.3, STETH:3402.1,
  JTO:2.61, JUP:0.94, AAVE:321.4, LINK:22.14, SUI:3.86, APT:9.34, HYPE:34.8, WBTC:96180,
  AVAX:41.2, ARB:0.79, OP:1.64, AERO:1.12 };

const walk = (seed, n, base) => { let h = 0; for (const c of seed) h = (h*31+c.charCodeAt(0))>>>0;
  const o=[]; let v=base; for(let i=0;i<n;i++){h=(h*1664525+1013904223)>>>0; v*=1+((h/4294967296)-.5)*.02; o.push(v);} return o; };

const markets = (cat) => NAMES.map(([id,sym,name],i)=>({
  id, symbol:sym.toLowerCase(), name, image:`https://assets.coingecko.com/coins/images/${i}/large/x.png`,
  current_price:PRICES[sym]??1.23, market_cap:(2e12)/(i+1), market_cap_rank:i+1,
  total_volume:(4e10)/(i+1), price_change_percentage_24h:((i%7)-3)*1.4,
  sparkline_in_7d:{price:walk(id,168,PRICES[sym]??1.23)},
})).slice(0, cat ? 8 : 21);

const PROJECTS=['aave-v3','kamino-lend','morpho-blue','compound-v3','venus-core-pool','moonwell','suilend','marginfi','spark','euler-v2'];
const CHAINS=['Ethereum','Solana','Base','Arbitrum','BSC','Sui','Optimism','Avalanche','Polygon','Aptos'];
const SYMS=['USDC','ETH','SOL','WBTC','USDT','SUI','STETH','AAVE','ARB','HYPE'];
const pools=[]; const lend=[];
for(let i=0;i<160;i++){
  const id=`pool-${i}`, sym=SYMS[i%SYMS.length];
  const supply=(1e10)/(i+3), borrow=supply*(.2+((i*7)%60)/100);
  pools.push({pool:id, chain:CHAINS[i%CHAINS.length], project:PROJECTS[i%PROJECTS.length], symbol:sym,
    tvlUsd:supply-borrow, apyBase:1+((i*13)%900)/100, apyReward:i%4?0:1.5, apy:1+((i*13)%900)/100+(i%4?0:1.5),
    poolMeta:i%5?null:'e-mode', stablecoin:sym.startsWith('US')});
  lend.push({pool:id, apyBaseBorrow:2+((i*17)%1100)/100, apyRewardBorrow:i%3?0:.9,
    totalSupplyUsd:supply, totalBorrowUsd:borrow, ltv:.5+((i%40)/100), borrowable:true});
}
// one pool that is too small to index, one on an unsupported chain
pools.push({pool:'tiny',chain:'Ethereum',project:'aave-v3',symbol:'USDC',tvlUsd:1e3,apy:1,apyBase:1});
lend.push({pool:'tiny',totalSupplyUsd:1e4,totalBorrowUsd:1e3,ltv:.5});
pools.push({pool:'exotic',chain:'Fantom',project:'x',symbol:'FTM',tvlUsd:1e9,apy:5,apyBase:5});
lend.push({pool:'exotic',totalSupplyUsd:1e9,totalBorrowUsd:1e8,ltv:.5});

const MIME={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript'};
let hits=0;
http.createServer(async (req,res)=>{
  const u=new URL(req.url,'http://x'); const p=u.pathname;
  const json=(o,code=200)=>{res.writeHead(code,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify(o));};
  if(MODE==='slow') await new Promise(r=>setTimeout(r,900));
  if(p.startsWith('/api/')||p.startsWith('/llama/')){
    if(MODE==='down') return json({error:'nope'},503);
    if(MODE==='429'&&hits++<2) return json({error:'rate limited'},429);
    if(MODE==='partial'&&p.startsWith('/llama/')) return json({error:'nope'},503);
  }
  if(p==='/api/v3/coins/markets') return json(markets(u.searchParams.get('category')));
  if(p.startsWith('/api/v3/coins/')&&p.endsWith('/market_chart')){
    const id=p.split('/')[4], days=+u.searchParams.get('days')||1;
    return json({prices:walk(id+days,Math.min(days*24,400),PRICES.SOL).map((v,i)=>[Date.now()-i*36e5,v])});
  }
  if(p==='/llama/pools') return json({status:'success',data:pools});
  if(p==='/llama/lendBorrow') return json(lend);
  if(p.startsWith('/llama/chart/')) return json({data:walk(p,400,6).map((v,i)=>({timestamp:i,apy:v,tvlUsd:1e8}))});

  // static site, with data.js re-pointed at this server
  const f=path.join(ROOT,p==='/'?'index.html':p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end('nope');}
  let body=fs.readFileSync(f);
  if(p==='/data.js') body=Buffer.from(String(body)
    .replace("'https://api.coingecko.com/api/v3'","'/api/v3'")
    .replace("'https://yields.llama.fi'","'/llama'"));
  res.writeHead(200,{'content-type':MIME[path.extname(f)]||'text/plain'});
  res.end(body);
}).listen(PORT,()=>console.log('fixtures on',PORT,'mode',MODE));
