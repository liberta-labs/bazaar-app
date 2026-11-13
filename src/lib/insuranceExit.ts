/**
 * Leaving an insurance fund, as the Earn page draws it: four steps (request, a 13-day cooldown, lock,
 * collect), which of them a withdrawal is at, and when one needs the insurer now.
 */
import type { insurance } from "@liberta-labs/bazaar-sdk";

export const EXIT_STEPS = ["Request", "Cool down", "Lock", "Collect"] as const;

type Plan = Pick<insurance.InsuranceExitPlan, "step" | "lockTs" | "requestTs" | "requestedShares" | "windowOpensTs" | "now">;

/** Which of the four steps a withdrawal is at (0 to 3); null for an ended market, where one call pays out. */
export function exitStage(plan: Plan): number | null {
  switch (plan.step) {
    case "none":
    case "request":
    case "expired":
      return 0;
    case "cooldown":
      return 1;
    case "lock":
      return 2;
    case "waitClaim":
    case "claim":
      return 3;
    case "redeem":
      return null;
    case "blocked":
      // Held back by something outside the withdrawal: placed by what has happened so far.
      if (plan.lockTs !== null) return 3;
      if (plan.requestTs !== null && plan.requestedShares > 0n) return plan.windowOpensTs !== null && plan.now >= plan.windowOpensTs ? 2 : 1;
      return 0;
  }
}

/** Steps with a call to make now inside a closing window, or a window that closed: shown without a click. */
export function exitDue(step: insurance.InsuranceExitStep): boolean {
  return step === "lock" || step === "claim" || step === "redeem" || step === "expired";
}
