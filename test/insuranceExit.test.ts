import { describe, expect, it } from "vitest";
import { EXIT_STEPS, exitDue, exitStage } from "../src/lib/insuranceExit";

const base = { lockTs: null, requestTs: null, requestedShares: 0n, windowOpensTs: null, now: 1_000 };

describe("exitStage", () => {
  it("places each step of a withdrawal on the four-step track", () => {
    expect(EXIT_STEPS).toEqual(["Request", "Cool down", "Lock", "Collect"]);
    expect(exitStage({ ...base, step: "none" })).toBe(0);
    expect(exitStage({ ...base, step: "request" })).toBe(0);
    expect(exitStage({ ...base, step: "cooldown" })).toBe(1);
    expect(exitStage({ ...base, step: "lock" })).toBe(2);
    expect(exitStage({ ...base, step: "waitClaim" })).toBe(3);
    expect(exitStage({ ...base, step: "claim" })).toBe(3);
    // A closed window starts over with a new request.
    expect(exitStage({ ...base, step: "expired" })).toBe(0);
    // An ended market pays in one call: no track.
    expect(exitStage({ ...base, step: "redeem" })).toBeNull();
  });

  it("places a withdrawal on hold by what has happened so far", () => {
    expect(exitStage({ ...base, step: "blocked" })).toBe(0);
    expect(exitStage({ ...base, step: "blocked", requestTs: 500, requestedShares: 10n, windowOpensTs: 2_000 })).toBe(1);
    expect(exitStage({ ...base, step: "blocked", requestTs: 500, requestedShares: 10n, windowOpensTs: 900 })).toBe(2);
    expect(exitStage({ ...base, step: "blocked", requestTs: 500, requestedShares: 10n, windowOpensTs: 900, lockTs: 950 })).toBe(3);
  });
});

describe("exitDue", () => {
  it("is true for a step to take now inside a closing window, or one that closed", () => {
    expect(["lock", "claim", "redeem", "expired"].every((s) => exitDue(s as never))).toBe(true);
    expect(["none", "request", "cooldown", "waitClaim", "blocked"].some((s) => exitDue(s as never))).toBe(false);
  });
});
