/* Sample dataset for the hosted artifact, where a strict CSP blocks every
   external request. Deterministic, plausible, and clearly labelled in the UI —
   it is illustrative, not a market snapshot. Only the artifact build ships it. */
const A = [
  ['bitcoin','btc','Bitcoin',96240,1.86,1.90e12,2.84e10],   ['ethereum','eth','Ethereum',3412.80,-1.14,4.11e11,1.42e10],
  ['tether','usdt','Tether',1.0001,0.01,1.18e11,4.20e10],    ['solana','sol','Solana',186.42,4.21,8.96e10,3.90e9],
  ['binancecoin','bnb','BNB',712.30,0.94,1.02e11,1.80e9],    ['usd-coin','usdc','USDC',0.9999,0.00,4.12e10,7.10e9],
  ['lido-staked-ether','steth','Lido Staked Ether',3402.10,-1.18,1.89e10,1.20e8],
  ['wrapped-bitcoin','wbtc','Wrapped Bitcoin',96180,1.79,1.34e10,4.10e8],
  ['chainlink','link','Chainlink',22.14,2.35,1.38e10,5.40e8], ['sui','sui','Sui',3.86,6.14,1.24e10,1.10e9],
  ['hyperliquid','hype','Hyperliquid',34.80,8.05,1.16e10,7.80e8], ['avalanche-2','avax','Avalanche',41.20,2.66,1.71e10,6.20e8],
  ['uniswap','uni','Uniswap',12.06,-0.78,7.20e9,2.90e8],     ['aptos','apt','Aptos',9.34,-1.28,5.80e9,2.40e8],
  ['aave','aave','Aave',321.40,5.12,4.80e9,3.20e8],          ['polygon-ecosystem-token','pol','Polygon',0.42,-0.63,3.90e9,1.60e8],
  ['arbitrum','arb','Arbitrum',0.79,-2.11,3.40e9,2.10e8],    ['jupiter','jup','Jupiter',0.94,7.62,2.80e9,3.18e8],
  ['optimism','op','Optimism',1.64,-1.55,2.70e9,1.40e8],     ['ethena','ena','Ethena',0.68,-3.44,2.10e9,1.80e8],
  ['bonk','bonk','Bonk',0.0000241,12.84,1.90e9,2.40e8],      ['dogwifhat','wif','dogwifhat',1.72,-5.30,1.70e9,1.90e8],
  ['ether-fi-staked-eth','weeth','Ether.fi Staked ETH',3588.40,-0.94,6.20e9,7.20e7],
  ['coinbase-wrapped-btc','cbbtc','Coinbase Wrapped BTC',96210,1.81,3.10e9,9.60e7],
  ['jito-governance-token','jto','Jito',2.61,3.04,8.80e8,6.10e7], ['pyth-network','pyth','Pyth Network',0.31,-2.41,1.10e9,4.40e7],
  ['aerodrome-finance','aero','Aerodrome',1.12,9.41,9.40e8,8.80e7], ['morpho','morpho','Morpho',1.84,6.02,9.40e8,4.20e7],
  ['pancakeswap-token','cake','PancakeSwap',2.41,-1.92,7.20e8,6.40e7], ['jito-staked-sol','jitosol','Jito Staked SOL',212.06,4.36,2.60e9,8.40e7],
  ['deepbook','deep','DeepBook',0.14,11.20,4.10e8,3.80e7],   ['gmx','gmx','GMX',24.60,3.18,2.40e8,3.10e7],
  ['velodrome-finance','velo','Velodrome',0.084,4.72,1.90e8,1.20e7], ['wrapped-steth','wsteth','Wrapped stETH',4041.20,-1.02,1.89e10,1.20e8],
];
// protocol, chain, symbol, supplyAPY, borrowAPY, suppliedUSD, utilisation%, ltv
const P = [
  ['aave-v3','Ethereum','USDC',6.72,8.44,2.90e9,84,.87], ['aave-v3','Ethereum','ETH',2.14,3.02,4.80e9,58,.83],
  ['aave-v3','Ethereum','WBTC',0.42,1.86,1.60e9,22,.73], ['aave-v3','Ethereum','WSTETH',0.18,1.24,3.40e9,12,.79],
  ['aave-v3','Ethereum','USDT',6.31,8.10,1.70e9,81,.85], ['aave-v3','Base','ETH',2.02,2.94,1.10e9,56,.82],
  ['aave-v3','Base','USDC',6.98,9.05,6.40e8,80,.86],     ['aave-v3','Arbitrum','ARB',1.34,3.86,1.42e8,42,.66],
  ['aave-v3','Arbitrum','USDC',6.44,8.60,8.10e8,79,.86], ['aave-v3','Optimism','OP',1.12,3.44,8.80e7,39,.65],
  ['aave-v3','Polygon','POL',1.86,4.20,1.24e8,46,.68],   ['aave-v3','Avalanche','AVAX',2.51,5.02,2.60e8,52,.72],
  ['morpho-blue','Ethereum','USDC',7.40,9.12,1.80e9,88,.86], ['morpho-blue','Ethereum','WEETH',3.16,4.60,9.40e8,66,.86],
  ['morpho-blue','Base','CBBTC',1.02,2.90,7.24e8,38,.86], ['morpho-blue','Base','USDC',7.61,9.44,8.90e8,85,.86],
  ['spark','Ethereum','USDT',6.88,8.05,1.10e9,80,.83],   ['spark','Ethereum','USDC',6.52,7.90,1.40e9,82,.83],
  ['compound-v3','Ethereum','USDC',6.10,7.92,1.40e9,79,.82], ['compound-v3','Base','USDC',6.74,8.51,4.20e8,77,.82],
  ['euler-v2','Ethereum','ETH',2.46,3.68,6.20e8,61,.80], ['euler-v2','Ethereum','USDC',7.02,9.30,3.80e8,83,.85],
  ['kamino-lend','Solana','USDC',9.18,12.40,1.24e9,86,.80], ['kamino-lend','Solana','SOL',6.42,8.91,8.42e8,72,.75],
  ['kamino-lend','Solana','JITOSOL',5.10,7.62,4.10e8,64,.70], ['kamino-lend','Solana','USDT',8.44,11.60,3.10e8,82,.78],
  ['marginfi','Solana','USDC',8.46,11.70,4.02e8,81,.80], ['marginfi','Solana','SOL',5.84,8.20,3.18e8,68,.72],
  ['drift','Solana','USDC',8.90,12.10,2.96e8,83,.80],    ['drift','Solana','SOL',6.05,9.40,2.28e8,70,.74],
  ['save','Solana','USDT',7.92,10.85,1.64e8,78,.78],     ['moonwell','Base','USDC',7.26,9.60,5.12e8,82,.84],
  ['moonwell','Base','CBBTC',0.88,2.44,3.88e8,34,.78],   ['fluid','Arbitrum','ETH',2.58,3.90,2.86e8,63,.85],
  ['fluid','Ethereum','ETH',2.31,3.44,9.10e8,60,.85],    ['radiant','Arbitrum','USDC',7.04,9.88,9.60e7,76,.80],
  ['silo-finance','Arbitrum','GMX',2.20,6.10,4.40e7,48,.60], ['venus-core-pool','BSC','USDT',6.40,8.72,9.40e8,77,.80],
  ['venus-core-pool','BSC','BNB',2.94,5.10,6.80e8,59,.75], ['suilend','Sui','SUI',4.88,7.90,3.42e8,67,.70],
  ['suilend','Sui','USDC',8.10,10.90,2.20e8,79,.78],     ['navi-protocol','Sui','USDC',9.60,13.20,1.88e8,85,.78],
  ['aries-markets','Aptos','APT',3.42,6.28,9.60e7,57,.70], ['hyperlend','Hyperliquid','HYPE',7.15,11.04,2.64e8,73,.65],
  ['benqi','Avalanche','AVAX',2.66,5.34,2.14e8,54,.72],
];
const ECO = { 'solana-ecosystem':['sol','usdc','jup','jto','pyth','bonk','wif','jitosol'],
  'ethereum-ecosystem':['eth','usdt','steth','wbtc','link','uni','aave','ena','weeth','wsteth'],
  'base-ecosystem':['cbbtc','aero','morpho'], 'arbitrum-ecosystem':['arb','gmx'],
  'optimism-ecosystem':['op','velo'], 'polygon-ecosystem':['pol'], 'binance-smart-chain':['bnb','cake'],
  'avalanche-ecosystem':['avax'], 'sui-ecosystem':['sui','deep'], 'aptos-ecosystem':['apt'],
  'bitcoin-ecosystem':['btc','wbtc'], 'hyperliquid-ecosystem':['hype'] };

const walk = (seed, n, base) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const o = []; let v = base; for (let i = 0; i < n; i++) { h = (h * 1664525 + 1013904223) >>> 0;
    v *= 1 + ((h / 4294967296) - 0.49) * 0.035; o.push(v); } return o; };

const market = ([id, sym, name, price, chg, mcap, vol], i) => ({
  id, symbol: sym, name, image: null, current_price: price, market_cap: mcap,
  market_cap_rank: i + 1, total_volume: vol, price_change_percentage_24h: chg,
  sparkline_in_7d: { price: walk(sym, 168, price) },
});

window.__ATLAS_SAMPLE__ = {
  markets(cat) {
    const rows = cat ? A.filter(a => (ECO[cat] || []).includes(a[1])) : A;
    return rows.map((a, i) => market(a, A.indexOf(a)));
  },
  pools: P.map(([project, chain, symbol, apy, bor, supplied, util, ltv], i) => ({
    pool: `s${i}`, project, chain, symbol, tvlUsd: supplied * (1 - util / 100),
    apy, apyBase: apy, apyReward: 0, poolMeta: null,
    apyBaseBorrow: bor, apyRewardBorrow: 0,
    totalSupplyUsd: supplied, totalBorrowUsd: supplied * util / 100, ltv,
  })),
  priceSeries: (id, days) => walk(id + days, days >= 365 ? 180 : days <= 1 ? 48 : days * 2,
    (A.find(a => a[0] === id) || [, , , 100])[3]).map((v, i) => [i, v]),
  apySeries: (pool, days) => walk(pool, Math.min(days, 180), 6).map((v, i) => ({ timestamp: i, apy: v })),
};
