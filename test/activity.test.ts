import { describe, expect, it } from "vitest";
import { IDLE_AFTER_MS, IDLE_MINUTES, isIdle } from "../src/state/activity";

describe("isIdle", () => {
  it("is idle 15 minutes after the last input, and not a moment before", () => {
    expect(IDLE_MINUTES).toBe(15);
    expect(IDLE_AFTER_MS).toBe(15 * 60_000);
    const last = 1_794_236_400_000;
    expect(isIdle(last, last)).toBe(false);
    expect(isIdle(last, last + IDLE_AFTER_MS - 1)).toBe(false);
    expect(isIdle(last, last + IDLE_AFTER_MS)).toBe(true);
    expect(isIdle(last, last + 60_000, 30_000)).toBe(true);
  });
});
