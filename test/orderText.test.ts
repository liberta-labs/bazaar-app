import { BAZAAR_SCALE } from "@liberta-labs/bazaar-sdk";
import { describe, expect, it } from "vitest";
import { orderValue, tifText, triggerCondition } from "../src/lib/orderText";

const X = BAZAAR_SCALE;

describe("triggerCondition", () => {
  it("reads each trigger order the way the pair tests it", () => {
    // A long's take-profit is a sell that fires as the price rises; its stop-loss a sell that fires as it falls.
    expect(triggerCondition("TakeProfit", false, 100n * X)).toBe("Price ≥ $100");
    expect(triggerCondition("StopLoss", false, 90n * X)).toBe("Price ≤ $90");
    // A short's take-profit is a buy that fires as the price falls; a buy stop-limit fires as it rises.
    expect(triggerCondition("TakeProfit", true, 80n * X)).toMatch(/^Price ≤ /);
    expect(triggerCondition("StopLimit", true, 120n * X)).toMatch(/^Price ≥ /);
  });

  it("gives no condition to an order that waits for none, whatever price it stores", () => {
    expect(triggerCondition("Market", true, 100n * X)).toBeNull();
    expect(triggerCondition("Limit", true, 100n * X)).toBeNull();
    expect(triggerCondition("StopLoss", true, 0n)).toBeNull();
  });
});

describe("tifText and orderValue", () => {
  it("names time in force only for orders that rest", () => {
    expect(tifText("Limit", 0, false)).toBe("GTC");
    expect(tifText("Limit", "IOC", true)).toBe("IOC · post-only");
    expect(tifText("Market", "GTC", false)).toBeNull();
    expect(tifText("TakeProfit", 0, false)).toBeNull();
  });

  it("values an order at its limit, else its trigger, and a market order not at all", () => {
    expect(orderValue("Limit", 2n * X, 50n * X, 0n)).toBe(100n * X);
    expect(orderValue("StopLoss", 2n * X, 0n, 40n * X)).toBe(80n * X);
    expect(orderValue("Market", 2n * X, 0n, 40n * X)).toBeNull();
  });
});
