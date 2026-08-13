import {
  allocateStore,
  recalculatePlan,
  validatePlan,
  planSignature
} from "./strict-allocation-engine.mjs";

export function runStrictAllocation(options, optimization = {}) {
  return allocateStore(options, optimization);
}

export function recalculateStrictPlan(plan, options = {}) {
  recalculatePlan(plan);
  plan.validation = validatePlan(plan, options);
  return plan;
}

export { validatePlan, planSignature };

const strictAllocationAdapter = {
  allocateStore: runStrictAllocation,
  recalculatePlan: recalculateStrictPlan,
  validatePlan,
  planSignature
};

if (typeof globalThis !== "undefined") {
  globalThis.StrictAllocationAdapter = strictAllocationAdapter;
}
