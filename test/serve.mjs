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

// tokenized equities: the ticker plus an x, issued onchain
const EQ=[['tesla-xstock','TSLAX','Tesla xStock',412.6,8.4e8],['nvidia-xstock','NVDAX','NVIDIA xStock',182.3,6.1e8],
  ['apple-xstock','AAPLX','Apple xStock',241.9,5.2e8],['msft-xstock','MSFTX','Microsoft xStock',508.1,4.4e8],
  ['coinbase-xstock','COINX','Coinbase xStock',312.4,2.8e8],['sp500-xstock','SPYX','S&P 500 xStock',612.7,9.6e8]];
const STOCKS=(cat)=>EQ.map(([id,sym,name,price,mcap],i)=>({
  id, symbol:sym.toLowerCase(), name, image:null, current_price:price, market_cap:mcap,
  market_cap_rank:i+1, total_volume:mcap/40, price_change_percentage_24h:((i%5)-2)*1.3,
  sparkline_in_7d:{price:walk(id,168,price)},
  // the second category overlaps the first: the loader must dedupe
})).slice(cat==='xstocks-ecosystem'?2:0);

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
  if(p.startsWith('/api/')||p.startsWith('/llama/')||p.startsWith('/dl/')||p.startsWith('/stable/')||p.startsWith('/bridge/')||p.startsWith('/dex/')||p.startsWith('/gt/')||p.startsWith('/pk/')||p.startsWith('/bn/')||p.startsWith('/nft/')||p.startsWith('/me/')){
    if(MODE==='down') return json({error:'nope'},503);
    if(MODE==='429'&&hits++<2) return json({error:'rate limited'},429);
    if(MODE==='partial'&&(p.startsWith('/llama/')||p.startsWith('/dl/'))) return json({error:'nope'},503);
  }
  if(p==='/api/v3/coins/markets'){
    const cat=u.searchParams.get('category')||'';
    // a category request used to fall through to the same coins, which filled
    // the stocks tab with bitcoin
    if(/tokenized-stock|xstocks/.test(cat)) return json(STOCKS(cat));
    return json(markets(cat));
  }
  if(p.startsWith('/api/v3/coins/')&&!p.endsWith('/market_chart')&&!p.endsWith('/markets')){
    const id=p.split('/')[4];
    return json({id, description:{en:`<p><a href="https://x.invalid">${id}</a> is a decentralised network. `
      +`Its token secures the chain and pays for execution.</p>`}});
  }
  if(p.startsWith('/api/v3/coins/')&&p.endsWith('/market_chart')){
    const id=p.split('/')[4], days=+u.searchParams.get('days')||1;
    const n=Math.min(days*24,400);
    return json({prices:walk(id+days,n,PRICES.SOL).map((v,i)=>[Date.now()-i*36e5,v]),
      total_volumes:walk('v'+id+days,n,3e9).map((v,i)=>[Date.now()-i*36e5,v])});
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
  if(p==='/dex/latest/dex/search'){
    const q=(u.searchParams.get('q')||'').toLowerCase();
    const names=['CashCat','PepeCoin','BonkInu','WifHat','MoonDog','TurboToad','TinyCoin','BlastCat'];
    return json({pairs: names.filter(n=>n.toLowerCase().includes(q)||q.length<3).map((n,i)=>({
      chainId: n==='BlastCat' ? 'blast' : ['solana','base','ethereum'][i%3],
      dexId:['raydium','aerodrome','uniswap'][i%3],
      pairAddress:'pair'+n, url:'https://dexscreener.com/x/'+n,
      baseToken:{address:'0x'+n, name:n, symbol:n.slice(0,6).toUpperCase()},
      quoteToken:{symbol:'SOL'}, priceUsd:String(0.0004*(i+1)),
      priceChange:{h24:((i%5)-2)*7.4}, liquidity:{usd: n==='TinyCoin' ? 1800 : (9e5)/(i+1)},
      volume:{h24:(4e6)/(i+1)}, fdv:(2e7)/(i+1) }))});
  }
  if(p==='/nft/collections') return json(Array.from({length:40},(_,i)=>({
    collectionId:'0xcol'+i, name:['Bored Ape Yacht Club','CryptoPunks','Pudgy Penguins','Azuki','Milady',
      'Doodles','Moonbirds','Art Blocks','Clone X','Chromie Squiggle'][i%10]+(i>9?' '+i:''),
    symbol:'COL'+i, image:'https://img.invalid/'+i+'.png', chain:['Ethereum','Base','Polygon'][i%3],
    floorPrice:(30)/(i+1), floorPriceUSD:(9e4)/(i+1), floorPricePctChange1Day:((i%7)-3)*2.4,
    floorPricePctChange7Day:((i%5)-2)*5.1, dailyVolumeUSD:(4e6)/(i+1), totalSupply:10000-i*100 })));
  if(p==='/me/marketplace/popular_collections') return json(Array.from({length:12},(_,i)=>({
    symbol:'mad_lads'+i, name:['Mad Lads','Claynosaurz','Famous Fox Federation','SMB Gen2','Okay Bears'][i%5]+(i>4?' '+i:''),
    image:'https://img.invalid/me'+i+'.png', floorPrice:(120e9)/(i+1), volumeAll:(9e11)/(i+1) })));
  if(p.startsWith('/nft/chart/')) return json(walk(p,200,80000).map((v,i)=>({timestamp:i,floorPriceUSD:v})));
  if(p==='/pk/tickers') return json(Array.from({length:60},(_,i)=>({
    id:'pk-'+i, name:'Paprika '+i, symbol:'PK'+i, rank:i+1,
    quotes:{USD:{price:1000/(i+1), market_cap:2e12/(i+1), volume_24h:1e10/(i+1),
      percent_change_24h:((i%7)-3)*1.2, percent_change_7d:((i%5)-2)*3.1,
      percent_change_30d:((i%9)-4)*6.4, percent_change_1y:((i%11)-5)*22.5}}})));
  if(p==='/bn/klines'){ const n=+(u.searchParams.get('limit')||100);
    return json(walk('bn'+u.searchParams.get('symbol'),n,100).map(v=>[0,0,0,0,String(v),0])); }
  if(/^\/gt\/networks\/[^/]+\/pools$/.test(p)){
    const rows=[]; for(let i=0;i<10;i++) rows.push({id:'net_p'+i,type:'pool',
      attributes:{name:'CHAINTOK'+i+' / SOL',address:'ct'+i,base_token_price_usd:String(0.5*(i+1)),
        price_change_percentage:{h24:'3.2'},reserve_in_usd:String(2e6/(i+1)),
        volume_usd:{h24:String(5e6/(i+1))},fdv_usd:String(3e7/(i+1))}});
    return json({data:rows});
  }
  if(/ohlcv/.test(p)) return json({data:{attributes:{ohlcv_list:
    walk('ohlcv'+p,60,1).map((v,i)=>[i,0,0,0,v,0])}}});
  if(p==='/gt/search/pools'){
    const q=(u.searchParams.get('query')||'').toLowerCase();
    const rows=[];
    if('cashcat'.includes(q)||q.includes('cashcat')) rows.push({ id:'solana_gtcash', type:'pool',
      attributes:{ name:'CASHCAT / SOL', address:'gtcash', base_token_price_usd:'0.00041',
        price_change_percentage:{h24:'29.0'}, reserve_in_usd:'880000',
        volume_usd:{h24:'3900000'}, fdv_usd:'19000000' }});
    return json({data:rows});
  }
  if(p==='/gt/networks/trending_pools'){
    const rows=[];
    for(let i=0;i<12;i++) rows.push({
      id:['solana','base','eth'][i%3]+'_pool'+i, type:'pool',
      attributes:{ name:'TREND'+i+' / SOL', address:'addr'+i,
        base_token_price_usd:String(0.02*(i+1)),
        price_change_percentage:{h24:String(((i%6)-3)*5.1)},
        reserve_in_usd:String((3e6)/(i+1)),
        volume_usd:{h24:String((8e6)/(i+1))}, fdv_usd:String((4e7)/(i+1)) }});
    return json({data:rows});
  }
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
    .replace("'https://bridges.llama.fi'","'/bridge'")
    .replace("'https://api.dexscreener.com'","'/dex'")
    .replace("'https://api.geckoterminal.com/api/v2'","'/gt'")
    .replace("'https://api.coinpaprika.com/v1'","'/pk'")
    .replace("'https://api.binance.com/api/v3'","'/bn'")
    .replace("'https://nft.llama.fi'","'/nft'")
    .replace("'https://api-mainnet.magiceden.dev/v2'","'/me'"));
  res.writeHead(200,{'content-type':MIME[path.extname(f)]||'text/plain'});
  res.end(body);
}).listen(PORT,()=>console.log('fixtures on',PORT,'mode',MODE));
