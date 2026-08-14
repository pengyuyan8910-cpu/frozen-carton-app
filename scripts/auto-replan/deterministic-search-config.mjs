export const DETERMINISTIC_SEARCH_BUDGET = Object.freeze({
  phase4MaxColumnActions: 2000,
  phase5MaxRounds: 20,
  phase5MaxMoveCandidatesPerRound: 40,
  phase5MaxSwapCandidatesPerRound: 20,
  phase5MaxFragmentCandidatesPerRound: 0,
  phase5MaxCategoryCandidatesPerRound: 0,
  outerWatchdogMs: 60000
});

export function resolveDeterministicSearchBudget(options = {}) {
  return Object.freeze({
    maxColumnActions: Math.min(2000, Math.max(1, Math.floor(Number(options.maxColumnActions ?? DETERMINISTIC_SEARCH_BUDGET.phase4MaxColumnActions)))),
    maxRounds: Math.min(50, Math.max(1, Math.floor(Number(options.maxRounds ?? DETERMINISTIC_SEARCH_BUDGET.phase5MaxRounds)))),
    maxMoveCandidates: Math.min(500, Math.max(1, Math.floor(Number(options.maxMoveCandidates ?? DETERMINISTIC_SEARCH_BUDGET.phase5MaxMoveCandidatesPerRound)))),
    maxSwapCandidates: Math.min(200, Math.max(0, Math.floor(Number(options.maxSwapCandidates ?? DETERMINISTIC_SEARCH_BUDGET.phase5MaxSwapCandidatesPerRound))))
  });
}
