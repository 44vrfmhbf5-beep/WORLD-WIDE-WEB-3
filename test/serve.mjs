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
/* Same walk, rescaled to finish exactly at `base`. History ends now, and the
   sheet reads its headline off the last point — a series that drifts away from
   the row's own number would make a chart keyed on the wrong entity invisible. */
const walkTo = (seed, n, base) => { const o = walk(seed, n, base); const k = base / o[n-1];
  return o.map(v => v * k); };

const BY_ID = Object.fromEntries(NAMES.map(([id,sym])=>[id,PRICES[sym]??1.23]));
const markets = (cat) => NAMES.map(([id,sym,name],i)=>({
  id, symbol:sym.toLowerCase(), name, image:`https://assets.coingecko.com/coins/images/${i}/large/x.png`,
  current_price:PRICES[sym]??1.23, market_cap:(2e12)/((i+1)**2), market_cap_rank:i+1,
  total_volume:(4e10)/(i+1)*(1+(i%9)*.9), price_change_percentage_24h:((i%7)-3)*1.4,
  // the request already asks for these windows; a fixture that omits them lets
  // a dropped field pass as an em dash
  price_change_percentage_7d_in_currency:((i%9)-4)*2.6,
  price_change_percentage_30d_in_currency:((i%11)-5)*5.2,
  price_change_percentage_1y_in_currency:((i%13)-4)*24,
  circulating_supply:(2.1e7)*(i+1), max_supply:i%3?null:(2.1e7)*(i+1)*2,
  high_24h:(PRICES[sym]??1.23)*1.03, low_24h:(PRICES[sym]??1.23)*0.96,
  ath:(PRICES[sym]??1.23)*1.6, ath_change_percentage:-((i%9)*7+4),
  fully_diluted_valuation:(2e12)/((i+1)**2)*1.2,
  sparkline_in_7d:{price:walk(id,168,PRICES[sym]??1.23)},
})).slice(0, cat ? 40 : 101);

// tokenized equities: the ticker plus an x, issued onchain
const EQ=[['tesla-xstock','TSLAX','Tesla xStock',412.6,8.4e8],['nvidia-xstock','NVDAX','NVIDIA xStock',182.3,6.1e8],
  ['apple-xstock','AAPLX','Apple xStock',241.9,5.2e8],['msft-xstock','MSFTX','Microsoft xStock',508.1,4.4e8],
  ['sp500-xstock','SPYX','S&P 500 xStock',612.7,9.6e8],
  // one per issuer naming convention: Dinari prefixes a d, Robinhood and
  // Coinbase issue under the plain ticker
  ['dinari-tesla','DTSLA','Dinari Tesla dShare',411.2,4.1e7],
  ['robinhood-nvda','NVDA','Robinhood Tokenized NVIDIA',181.8,9.2e7],
  ['coinbase-aapl','AAPL','Coinbase Tokenized Apple Stock',241.1,1.4e8],
  ['swarm-msft','MSFT','Swarm Microsoft Stock Token',507.4,3.1e7],
  // in the category and not an equity: the loader must drop both
  ['ondo-treasury','OUSG','Ondo Short-Term US Treasuries',108.4,6.2e8],
  ['paxos-gold','PAXG','Pax Gold',2640.5,7.1e8]];
const STOCKS=(cat)=>EQ.map(([id,sym,name,price,mcap],i)=>({
  id, symbol:sym.toLowerCase(), name, image:'https://img.invalid/eq/'+id+'.png',
  current_price:price, market_cap:mcap,
  market_cap_rank:i+1, total_volume:mcap/40, price_change_percentage_24h:((i%5)-2)*1.3,
  price_change_percentage_7d_in_currency:((i%7)-3)*2.1,
  ath:price*1.3, ath_change_percentage:-((i%6)*6+3), circulating_supply:mcap/price,
  sparkline_in_7d:{price:walk(id,168,price)},
  // the second category overlaps the first: the loader must dedupe
})).slice(cat==='xstocks-ecosystem'?2:0);

for (const [id,,,price] of EQ) BY_ID[id]=price;
const PROJECTS=['aave-v3','kamino-lend','morpho-blue','compound-v3','venus-core-pool','moonwell','suilend','marginfi','spark','euler-v2'];
const CHAINS=['Ethereum','Solana','Base','Arbitrum','BSC','Sui','Optimism','Avalanche','Polygon','Aptos'];
const SYMS=['USDC','ETH','SOL','WBTC','USDT','SUI','STETH','AAVE','ARB','HYPE'];
const pools=[]; const lend=[];
for(let i=0;i<1300;i++){
  const id=`pool-${i}`, sym=SYMS[i%SYMS.length];
  const supply=(1e10)/(i+3), borrow=supply*(.2+((i*7)%75)/100);
  const supplyOnly = i%7===3;      // plenty of real markets take deposits only
  const apy=1+((i*13)%900)/100+(i%4?0:1.5);
  pools.push({pool:id, chain:CHAINS[i%CHAINS.length], project:PROJECTS[i%PROJECTS.length], symbol:sym,
    tvlUsd:supply-borrow, apyBase:1+((i*13)%900)/100, apyReward:i%4?0:1.5, apy,
    // the rate's own month, and DeFiLlama's read on where it is going
    apyMean30d:apy*(.85+((i%7)/20)), apyPct30D:((i%9)-4)*1.8, sigma:((i%5)+1)/10,
    predictions:{predictedClass:['Stable','Up','Down'][i%3], predictedProbability:55+(i%40)},
    exposure:i%3?'single':'multi', ilRisk:i%3?'no':'yes',
    poolMeta:i%5?null:'e-mode', stablecoin:sym.startsWith('US')});
  lend.push({pool:id, apyBaseBorrow:supplyOnly?0:2+((i*17)%1100)/100, apyRewardBorrow:i%3?0:.9,
    totalSupplyUsd:supply, totalBorrowUsd:supplyOnly?0:borrow,
    ltv:.5+((i%40)/100), borrowable:!supplyOnly});
}
// one pool that is too small to index, one on an unsupported chain
pools.push({pool:'tiny',chain:'Ethereum',project:'aave-v3',symbol:'USDC',tvlUsd:1e3,apy:1,apyBase:1});
lend.push({pool:'tiny',totalSupplyUsd:1e4,totalBorrowUsd:1e3,ltv:.5});
pools.push({pool:'exotic',chain:'Fantom',project:'x',symbol:'FTM',tvlUsd:1e9,apy:5,apyBase:5});
lend.push({pool:'exotic',totalSupplyUsd:1e9,totalBorrowUsd:1e8,ltv:.5});
// a rate eight times its own month, and one the source itself flags — both look
// perfectly ordinary in every column the table shows
pools.push({pool:'spikefarm',chain:'Ethereum',project:'spike-fi',symbol:'SPIKE',tvlUsd:4e6,
  apy:96,apyBase:96,apyMean30d:12,apyPct30D:700,predictions:{predictedClass:'Down',predictedProbability:81}});
pools.push({pool:'outlierfarm',chain:'Ethereum',project:'outlier-fi',symbol:'OUTLIER',tvlUsd:8e6,
  apy:41,apyBase:41,apyMean30d:39,outlier:true});

// /dl/protocols hands out (5e10)/(i+2); the slug carries that index back
const PROTO_SLUG = i => i<PROJECTS.length ? PROJECTS[i] : PROJECTS[i%PROJECTS.length]+'-'+i;
const PROTO_TVL_BY = Object.fromEntries(Array.from({length:120},(_,i)=>[PROTO_SLUG(i),(5e10)/(i+2)]));
const PROTO_TVL = path => PROTO_TVL_BY[decodeURIComponent(path.split('/').pop())] ?? 1e9;
const ALL_CHAINS=['Ethereum','Solana','Base','Arbitrum','BSC','Hyperliquid','Optimism','Polygon',
  'Avalanche','Sui','Aptos','Tron','TON','Bitcoin','Berachain','Sonic','Mantle','Blast','Scroll',
  'Linea','zkSync Era','Sei','Unichain','Ink','Abstract','Plume','Story','Monad','Celo'];
const CHAIN_TVL = Object.fromEntries(ALL_CHAINS.map((c,i)=>[c,(9e10)/((i+1)**1.9)]));
const STABLE_SUP = { 1: 4.1e10, 2: 1.18e11, 3: 5.3e9, 4: 6.4e8, 5: 3.1e8 };
const BRIDGE_VOL = Object.fromEntries(Array.from({length:14},(_,i)=>[String(i),(4e8)/((i+1)**2)]));
const MIME={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript'};
let hits=0;
http.createServer(async (req,res)=>{
  const u=new URL(req.url,'http://x'); const p=u.pathname;
  const json=(o,code=200)=>{res.writeHead(code,{'content-type':'application/json','access-control-allow-origin':'*'});res.end(JSON.stringify(o));};
  if(MODE==='slow') await new Promise(r=>setTimeout(r,900));
  if(p.startsWith('/api/')||p.startsWith('/llama/')||p.startsWith('/dl/')||p.startsWith('/stable/')||p.startsWith('/bridge/')||p.startsWith('/dex/')||p.startsWith('/gt/')||p.startsWith('/pk/')||p.startsWith('/bn/')||p.startsWith('/nft/')||p.startsWith('/me/')||p==='/uni'||p.startsWith('/jup/')||p==='/morpho'){
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
    return json({prices:walkTo(id+days,n,BY_ID[id]??PRICES.SOL).map((v,i)=>[Date.now()-(n-1-i)*36e5,v]),
      total_volumes:walk('v'+id+days,n,3e9).map((v,i)=>[Date.now()-i*36e5,v])});
  }
  if(p==='/dl/protocols') return json(Array.from({length:120},(_,i)=>({
    id:String(i), name:PROJECTS[i%PROJECTS.length].replace(/-/g,' ')+' '+i, slug:PROTO_SLUG(i),
    category:['Lending','Dexes','Liquid Staking','CDP','Yield'][i%5],
    chains:[CHAINS[i%CHAINS.length],CHAINS[(i+1)%CHAINS.length]],
    tvl:(5e10)/(i+2), change_1d:((i%7)-3)*1.1, change_7d:((i%5)-2)*2.4,
    url:'https://example.invalid/'+i,
    logo: i%9===4 ? null : 'https://icons.invalid/protocols/'+i+'.png' })));
  const overview=(f)=>({protocols:Array.from({length:120},(_,i)=>({
    name:PROJECTS[i%PROJECTS.length].replace(/-/g,' ')+' '+i, ...f(i)})).filter((_,i)=>i%3!==2)});
  if(p==='/dl/overview/dexs') return json(overview(i=>({total24h:(1.2e9)/(i+1)})));
  if(p==='/dl/overview/fees') return json(overview(i=>({total24h:(3.4e6)/(i+1),revenue24h:(9.1e5)/(i+1)})));
  // the app carries thirty networks; a fixture that prices ten of them cannot
  // tell a threshold that separates from one that matches whatever is left
  if(p==='/dl/v2/chains') return json(ALL_CHAINS.map((c,i)=>({
    name:c, tvl:(9e10)/((i+1)**1.9), tokenSymbol:c.slice(0,3).toUpperCase()})));
  if(p.startsWith('/dl/protocol/')) return json({
    description:`<p>${p.split('/').pop()} is a protocol described by its own source.</p>`,
    tvl:walkTo(p,400,PROTO_TVL(p)).map((v,i)=>({date:i,totalLiquidityUSD:v}))});
  if(p==='/stable/stablecoins') return json({peggedAssets:[
    {id:'1',symbol:'USDC',name:'USD Coin',circulating:{peggedUSD:4.1e10},price:1.0001,pegMechanism:'fiat-backed',chains:['Ethereum','Solana']},
    {id:'2',symbol:'USDT',name:'Tether',circulating:{peggedUSD:1.18e11},price:0.9998,pegMechanism:'fiat-backed',chains:['Ethereum','BSC']},
    {id:'3',symbol:'DAI',name:'Dai',circulating:{peggedUSD:5.3e9},price:0.9994,pegMechanism:'crypto-backed',chains:['Ethereum','Base']},
    {id:'4',symbol:'FRAX',name:'Frax',circulating:{peggedUSD:6.4e8},price:0.997,pegMechanism:'algorithmic',chains:['Ethereum']},
    // one that has genuinely come off its peg, which is the case the chip is for
    {id:'5',symbol:'USDD',name:'Decentralized USD',circulating:{peggedUSD:3.1e8},price:0.948,pegMechanism:'algorithmic',chains:['Tron']}]});
  if(p==='/dl/overview/derivatives') return json(overview(i=>({total24h:(4.2e8)/(i+1)})));
  if(p==='/dl/overview/options') return json(overview(i=>({total24h:(1.1e7)/(i+1)})));
  if(p==='/bridge/bridges') return json({bridges:Array.from({length:14},(_,i)=>({
    id:i, name:'bridge'+i, displayName:'Bridge '+i, chains:[CHAINS[i%CHAINS.length],CHAINS[(i+2)%CHAINS.length]],
    // half of them shrank yesterday, and the tail is well under $10M a day
    lastDailyVolume:(4e8)/((i+1)**2), volumePrev2Day:(4e8)/((i+1)**2)*(i%2?1.3:0.8) }))});
  if(p==='/dl/raises') return json({raises:Array.from({length:40},(_,i)=>({
    date: Math.floor(Date.now()/1000)-i*86400*24, name:'Venture Co '+i, round:['Seed','Series A','Series B'][i%3],
    amount:(120)/(i+1), chains:[CHAINS[i%CHAINS.length]], sector:'Infrastructure',
    leadInvestors:['Paradigm'], otherInvestors:['a16z','Polychain'],
    // a third of rounds never disclose one, which is what that chip is for
    valuation: i%3===2 ? 0 : (900)/(i+1),
    source:'https://example.invalid/raise'+i }))});
  if(p==='/dex/latest/dex/search'){
    const q=(u.searchParams.get('q')||'').toLowerCase();
    const names=['CashCat','PepeCoin','BonkInu','WifHat','MoonDog','TurboToad','TinyCoin','BlastCat'];
    return json({pairs: names.filter(n=>n.toLowerCase().includes(q)||q.length<3).map((n,i)=>({
      chainId: n==='BlastCat' ? 'blast' : n==='TurboToad' ? 'berachain'
        : ['solana','base','ethereum'][i%3],
      dexId:['raydium','aerodrome','uniswap'][i%3],
      pairAddress:'pair'+n, url:'https://dexscreener.com/x/'+n,
      baseToken:{address:'0x'+n, name:n, symbol:n.slice(0,6).toUpperCase()},
      // TinyCoin keeps a moving quote on purpose: a price in SOL is not a price
      quoteToken:{symbol: n==='TinyCoin' ? 'SOL' : 'USDC'},
      // DexScreener returns a token logo with the pair, and one hostile scheme
      info: i%4===3 ? undefined
        : { imageUrl: i===1 ? 'javascript:alert(1)' : 'https://img.invalid/tok/'+n+'.png' },
      priceUsd:String(0.0004*(i+1)),
      priceChange:{h24:((i%5)-2)*7.4}, liquidity:{usd: n==='TinyCoin' ? 1800 : (9e5)/(i+1)},
      volume:{h24:(4e6)/(i+1)}, fdv:(2e7)/(i+1) }))});
  }
  if(p==='/nft/collections') return json(Array.from({length:40},(_,i)=>({
    collectionId:'0xcol'+i, name:['Bored Ape Yacht Club','CryptoPunks','Pudgy Penguins','Azuki','Milady',
      'Doodles','Moonbirds','Art Blocks','Clone X','Chromie Squiggle'][i%10]+(i>9?' '+i:''),
    symbol:'COL'+i, image:'https://img.invalid/'+i+'.png', chain:['Ethereum','Base','Polygon'][i%3],
    floorPrice:(30)/(i+1), floorPriceUSD:(9e4)/(i+1), floorPricePctChange1Day:((i%7)-3)*2.4,
    floorPricePctChange7Day:((i%5)-2)*5.1, dailyVolumeUSD:(4e6)/(i+1), totalSupply:10000-i*100 })));
  // what is actually listed inside a collection — keyless on Magic Eden
  if(/^\/me\/collections\/[^/]+\/listings$/.test(p)){
    const sym=p.split('/')[3];
    return json(Array.from({length:12},(_,i)=>({
      pdaAddress:'pda'+i, tokenMint:sym+'-mint-'+i, price:(4.2)/(i+1),
      token:{ mintAddress:sym+'-mint-'+i, name:sym.toUpperCase()+' #'+(1000+i),
        image:'https://img.invalid/nft/'+sym+'/'+i+'.png',
        attributes:[{trait_type:'Background',value:['Blue','Gold','Rust'][i%3]},
          {trait_type:'Eyes',value:['Laser','Sleepy'][i%2]}] }})));
  }
  if(p==='/me/marketplace/popular_collections') return json(Array.from({length:12},(_,i)=>({
    symbol:'mad_lads'+i, name:['Mad Lads','Claynosaurz','Famous Fox Federation','SMB Gen2','Okay Bears'][i%5]+(i>4?' '+i:''),
    image:'https://img.invalid/me'+i+'.png', floorPrice:(120e9)/(i+1), volumeAll:(9e11)/(i+1) })));
  if(p.startsWith('/nft/chart/')){
    const m=/0xcol(\d+)$/.exec(p);
    return json(walkTo(p,200,(9e4)/((m?+m[1]:0)+1)).map((v,i)=>({timestamp:i,floorPriceUSD:v})));
  }
  if(p==='/pk/tickers') return json(Array.from({length:60},(_,i)=>({
    id:'pk-'+i, name:'Paprika '+i, symbol:'PK'+i, rank:i+1,
    quotes:{USD:{price:1000/(i+1), market_cap:2e12/(i+1), volume_24h:1e10/(i+1),
      percent_change_24h:((i%7)-3)*1.2, percent_change_7d:((i%5)-2)*3.1,
      percent_change_30d:((i%9)-4)*6.4, percent_change_1y:((i%11)-5)*22.5}}})));
  if(p==='/bn/klines'){ const n=+(u.searchParams.get('limit')||100);
    return json(walk('bn'+u.searchParams.get('symbol'),n,100).map(v=>[0,0,0,0,String(v),0])); }
  if(/^\/gt\/networks\/[^/]+\/pools$/.test(p)){
    const rows=[]; for(let i=0;i<10;i++) rows.push({id:'net_p'+i,type:'pool',
      relationships:{ base_token:{ data:{ id:'ctok'+i, type:'token' } } },
      attributes:{name:'CHAINTOK'+i+(i%4?' / USDC':' / WETH'),address:'ct'+i,base_token_price_usd:String(0.5*(i+1)),
        price_change_percentage:{h24:'3.2'},reserve_in_usd:String(2e6/(i+1)),
        volume_usd:{h24:String(5e6/(i+1))},fdv_usd:String(3e7/(i+1))}});
    const included=Array.from({length:10},(_,i)=>({ id:'ctok'+i, type:'token',
      attributes:{ image_url:'https://img.invalid/ct/'+i+'.png' }}));
    return json({data:rows,included});
  }
  if(/ohlcv/.test(p)){
    // trending pool i is priced at 0.02*(i+1); the series has to land there or
    // the sheet shows one token's price under another token's name
    const m=/addr(\d+)/.exec(p), price = m ? 0.02*(+m[1]+1) : 1;
    return json({data:{attributes:{ohlcv_list:
      walkTo('ohlcv'+p,60,price).map((v,i)=>[i,v,v,v,v,0]).reverse()}}});
  }
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
      relationships:{ base_token:{ data:{ id:'tok'+i, type:'token' } } },
      attributes:{ name:'TREND'+i+(i%3?' / USDC':' / SOL'), address:'addr'+i,
        base_token_price_usd:String(0.02*(i+1)),
        price_change_percentage:{h24:String(((i%6)-3)*5.1)},
        // half of them trade less than their own liquidity in a day
        reserve_in_usd:String((3e6)/(i+1)),
        volume_usd:{h24:String((3e6)/(i+1)*(i%2?2.7:0.4))}, fdv_usd:String((4e7)/(i+1)) }});
    // one hostile scheme, and one token the include simply does not cover
    const included=Array.from({length:12},(_,i)=>({ id:'tok'+i, type:'token',
      attributes:{ image_url: i===2 ? 'javascript:alert(1)' : i===5 ? null
        : 'https://img.invalid/gt/'+i+'.png' }}));
    return json(u.searchParams.get('include')==='base_token' ? {data:rows,included} : {data:rows});
  }
  if(p==='/dl/hacks') return json(Array.from({length:24},(_,i)=>({
    date: Math.floor(Date.now()/1000)-i*86400*21, name:'Protocol '+i+' exploit', amount:(6e7)/(i+1),
    technique:['Flash loan','Price oracle','Private key','Reentrancy'][i%4],
    chains:[CHAINS[i%CHAINS.length]], source:'https://example.invalid/hack'+i })));
  if(p.startsWith('/dl/v2/historicalChainTvl/')){
    const c=decodeURIComponent(p.split('/').pop());
    return json(walkTo(p,400,CHAIN_TVL[c]??4e10)
      .map((v,i)=>({date:Math.floor(Date.now()/1000)-(400-i)*86400, tvl:v})));
  }
  if(p==='/stable/stablecoincharts/all'){
    const id=u.searchParams.get('stablecoin')||'1';
    return json(walkTo(p+id,400,STABLE_SUP[id]??8e10)
      .map((v,i)=>({date:Math.floor(Date.now()/1000)-(400-i)*86400, totalCirculating:{peggedUSD:v}})));
  }
  if(p==='/bridge/bridgevolume/all'){
    const id=u.searchParams.get('id')||'0';
    // deposits and withdrawals are summed, so each side is half the reported day
    const day=(BRIDGE_VOL[id]??2e8)/2;
    return json(walkTo(p+id,200,day)
      .map((v,i)=>({date:Math.floor(Date.now()/1000)-(200-i)*86400, depositUSD:v, withdrawUSD:v})));
  }

  // the two registries that say which token is real, and Morpho's own markets
  if(p==='/uni') return json({name:'Uniswap Labs Default', tokens:[
    {chainId:1,address:'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',name:'USDC',symbol:'USDC',decimals:6},
    {chainId:1,address:'0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',name:'Wrapped BTC',symbol:'WBTC',decimals:8},
    {chainId:8453,address:'0x4200000000000000000000000000000000000006',name:'Wrapped Ether',symbol:'WETH',decimals:18},
    {chainId:42161,address:'0x912CE59144191C1204E64559FE8253a0e49E6548',name:'Arbitrum',symbol:'ARB',decimals:18}]});
  if(p==='/jup/tokens/v2/tag') return json([
    {id:'So11111111111111111111111111111111111111112',symbol:'SOL',name:'Wrapped SOL',isVerified:true},
    {id:'GTCASHaddr',symbol:'CASHCAT',name:'CashCat',isVerified:true},
    {id:'addr0',symbol:'TREND0',name:'Trendy Zero',isVerified:true}]);
  if(p==='/morpho'){
    const items=Array.from({length:24},(_,i)=>({
      uniqueKey:'0xmorpho'+i, lltv:String((77+(i%3)*4)*1e16),
      loanAsset:{symbol:['USDC','WETH','USDT','DAI'][i%4]},
      collateralAsset:{symbol:['wstETH','cbBTC','WBTC','sUSDe'][i%4]},
      morphoBlue:{chain:{id:[1,8453,42161][i%3]}},
      state:{supplyApy:(4+i%6)/100, borrowApy:(6+i%7)/100,
        supplyAssetsUsd:(9e8)/(i+1), borrowAssetsUsd:(6e8)/(i+1), utilization:.66}}));
    return json({data:{markets:{items}}});
  }
  if(p==='/llama/pools') return json({status:'success',data:pools});
  if(p==='/llama/lendBorrow') return json(lend);
  if(p.startsWith('/llama/chart/')){
    const id=p.split('/').pop(), i=+(/pool-(\d+)/.exec(id)?.[1]??0);
    // /pools hands out this exact APY for pool-i; the history has to land on it
    const now=1+((i*13)%900)/100+(i%4?0:1.5);
    return json({data:walkTo(p,400,now).map((v,j)=>({timestamp:j,apy:v,tvlUsd:1e8}))});
  }

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
    .replace("'https://api-mainnet.magiceden.dev/v2'","'/me'")
    .replace("'https://tokens.uniswap.org'","'/uni'")
    .replace("'https://lite-api.jup.ag'","'/jup'")
    .replace("'https://api.morpho.org/graphql'","'/morpho'"));
  res.writeHead(200,{'content-type':MIME[path.extname(f)]||'text/plain'});
  res.end(body);
}).listen(PORT,()=>console.log('fixtures on',PORT,'mode',MODE));
