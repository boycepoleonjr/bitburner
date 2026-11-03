// Deterministic input grid for allocate(). Shared by the golden-fixture generator and test/ramplan-xp-priority.js.
// The fixture test/fixtures/ramplan-allocate-golden.json was generated from the allocate() on main BEFORE the xp-priority
// change (commit 25e5fdd), so "unchanged path" means byte-identical to that output.
export function* grid() {
  for (const usableGb of [0, 1000, 75e6])
    for (const weight of [0, 0.5, 1])
      for (const repActive of [true, false])
        for (const hackNeed of [true, false])
          for (const demandGb of [0, 200, 1e8])
            for (const xpMode of ["auto", "off", "always"])
              for (const shareEnabled of [true, false])
                yield { usableGb, weight, repActive, hackNeed, demandGb, xpMode, shareEnabled };
}
