/** temp probe */
export async function main(ns) {
  ns.tprint(JSON.stringify(ns.stock.getConstants()));
  ns.tprint('wse ' + ns.stock.hasWseAccount() + ' tix ' + ns.stock.hasTixApiAccess());
}
