/** Keeps agent/share.js filling up to TARGET GB of home RAM. @param {NS} ns */
export async function main(ns){ const TARGET = Number(ns.args[0] ?? 500000); ns.disableLog('ALL');
  while(true){ const used = ns.ps('home').filter(p=>p.filename==='agent/share.js').reduce((a,p)=>a+p.threads*4,0);
    const free = ns.getServerMaxRam('home') - ns.getServerUsedRam('home') - 64;
    const want = Math.floor(Math.min(TARGET - used, free) / 4);
    if (want > 100) ns.exec('agent/share.js', 'home', want);
    await ns.sleep(30000); } }