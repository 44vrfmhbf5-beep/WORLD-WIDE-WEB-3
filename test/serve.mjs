// Replays CoinGecko + DeFiLlama response shapes locally so the UI can be tested
// end to end without network access. MODE=ok|slow|429|down|partial
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.env.MODE || 'ok';
const PORT = +(process.env.PORT || 8899);

const EXTRA=[];
for(let i=0;i<80;i++) EXTRA.push([`coin-${i}`,`TK${i}`,`Token ${i}`]);
const NAMES = [['bitcoin','BTC','Bitcoin'],['ethereum','ETH','Ethereum'],['solana','SOL','Solana'],
  ['tether','USDT','Tether'],['usd-coin','USDC','USDC'],['binancecoin','BNB','BNB'],
  ['lido-staked-ether','STETH','Lido Staked Ether'],['jito-governance-token','JTO','Jito'],
  ['jupiter-exchange-solana','JUP','Jupiter'],['aave','AAVE','Aave'],['chainlink','LINK','Chainlink'],
  ['sui','SUI','Sui'],['aptos','APT','Aptos'],['hyperliquid','HYPE','Hyperliquid'],
  ['wrapped-bitcoin','WBTC','Wrapped Bitcoin'],['avalanche-2','AVAX','Avalanche'],
  ['arbitrum','ARB','Arbitrum'],['optimism','OP','Optimism'],['aerodrome-finance','AERO','Aerodrome'],
  // hostile name: onchain strings are attacker-controlled, the UI must escape them
  ['evil-token','<img src=x onerror="window.__XSS=1">','"><script>window.__XSS=1</script>'],...EXTRA];
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
})).slice(0, cat ? 40 : 101);

const PROJECTS=['aave-v3','kamino-lend','morpho-blue','compound-v3','venus-core-pool','moonwell','suilend','marginfi','spark','euler-v2'];
const CHAINS=['Ethereum','Solana','Base','Arbitrum','BSC','Sui','Optimism','Avalanche','Polygon','Aptos'];
const SYMS=['USDC','ETH','SOL','WBTC','USDT','SUI','STETH','AAVE','ARB','HYPE'];
const pools=[]; const lend=[];
for(let i=0;i<1300;i++){
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
  if(p.startsWith('/api/')||p.startsWith('/llama/')||p.startsWith('/dl/')||p.startsWith('/stable/')||p.startsWith('/bridge/')){
    if(MODE==='down') return json({error:'nope'},503);
    if(MODE==='429'&&hits++<2) return json({error:'rate limited'},429);
    if(MODE==='partial'&&(p.startsWith('/llama/')||p.startsWith('/dl/'))) return json({error:'nope'},503);
  }
  if(p==='/api/v3/coins/markets') return json(markets(u.searchParams.get('category')));
  if(p.startsWith('/api/v3/coins/')&&p.endsWith('/market_chart')){
    const id=p.split('/')[4], days=+u.searchParams.get('days')||1;
    return json({prices:walk(id+days,Math.min(days*24,400),PRICES.SOL).map((v,i)=>[Date.now()-i*36e5,v])});
  }
  if(p==='/dl/protocols') return json(Array.from({length:120},(_,i)=>({
    id:String(i), name:PROJECTS[i%PROJECTS.length].replace(/-/g,' ')+' '+i, slug:PROJECTS[i%PROJECTS.length]+(i?'-'+i:''),
    category:['Lending','Dexes','Liquid Staking','CDP','Yield'][i%5],
    chains:[CHAINS[i%CHAINS.length],CHAINS[(i+1)%CHAINS.length]],
    tvl:(5e10)/(i+2), change_1d:((i%7)-3)*1.1, change_7d:((i%5)-2)*2.4,
    url:'https://example.invalid/'+i, logo:null })));
  if(p==='/dl/overview/dexs') return json({protocols:[{name:'Aave V3',total24h:1.2e9},{name:'aave-v3',total24h:1.2e9}]});
  if(p==='/dl/overview/fees') return json({protocols:[{name:'Aave V3',total24h:3.4e6,revenue24h:9.1e5}]});
  if(p==='/dl/v2/chains') return json(CHAINS.map((c,i)=>({name:c,tvl:(9e10)/(i+1),tokenSymbol:c.slice(0,3).toUpperCase()})));
  if(p.startsWith('/dl/protocol/')) return json({tvl:walk(p,400,1e9).map((v,i)=>({date:i,totalLiquidityUSD:v}))});
  if(p==='/stable/stablecoins') return json({peggedAssets:[
    {id:'1',symbol:'USDC',name:'USD Coin',circulating:{peggedUSD:4.1e10},price:1.0001,pegMechanism:'fiat-backed',chains:['Ethereum','Solana']},
    {id:'2',symbol:'USDT',name:'Tether',circulating:{peggedUSD:1.18e11},price:0.9998,pegMechanism:'fiat-backed',chains:['Ethereum','BSC']}]});
  if(p==='/dl/overview/derivatives') return json({protocols:[{name:'Aave V3',total24h:4.2e8}]});
  if(p==='/dl/overview/options') return json({protocols:[{name:'Aave V3',total24h:1.1e7}]});
  if(p==='/bridge/bridges') return json({bridges:Array.from({length:14},(_,i)=>({
    id:i, name:'bridge'+i, displayName:'Bridge '+i, chains:[CHAINS[i%CHAINS.length],CHAINS[(i+2)%CHAINS.length]],
    lastDailyVolume:(4e8)/(i+1), volumePrev2Day:(3.6e8)/(i+1) }))});
  if(p==='/dl/raises') return json({raises:Array.from({length:40},(_,i)=>({
    date: Math.floor(Date.now()/1000)-i*86400*9, name:'Venture Co '+i, round:['Seed','Series A','Series B'][i%3],
    amount:(120)/(i+1), chains:[CHAINS[i%CHAINS.length]], sector:'Infrastructure',
    leadInvestors:['Paradigm'], otherInvestors:['a16z','Polychain'], valuation:(900)/(i+1),
    source:'https://example.invalid/raise'+i }))});
  if(p==='/dl/hacks') return json(Array.from({length:24},(_,i)=>({
    date: Math.floor(Date.now()/1000)-i*86400*21, name:'Protocol '+i+' exploit', amount:(6e7)/(i+1),
    technique:['Flash loan','Price oracle','Private key','Reentrancy'][i%4],
    chains:[CHAINS[i%CHAINS.length]], source:'https://example.invalid/hack'+i })));
  if(p==='/llama/pools') return json({status:'success',data:pools});
  if(p==='/llama/lendBorrow') return json(lend);
  if(p.startsWith('/llama/chart/')) return json({data:walk(p,400,6).map((v,i)=>({timestamp:i,apy:v,tvlUsd:1e8}))});

  // static site, with data.js re-pointed at this server
  const f=path.join(ROOT,p==='/'?'index.html':p);
  if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);return res.end('nope');}
  let body=fs.readFileSync(f);
  if(p==='/data.js' && process.env.REWRITE!=='0') body=Buffer.from(String(body)
    .replace("'https://api.coingecko.com/api/v3'","'/api/v3'")
    .replace("'https://yields.llama.fi'","'/llama'")
    .replace("'https://api.llama.fi'","'/dl'")
    .replace("'https://stablecoins.llama.fi'","'/stable'")
    .replace("'https://bridges.llama.fi'","'/bridge'"));
  res.writeHead(200,{'content-type':MIME[path.extname(f)]||'text/plain'});
  res.end(body);
}).listen(PORT,()=>console.log('fixtures on',PORT,'mode',MODE));
