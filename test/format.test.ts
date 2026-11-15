import { describe, expect, it } from "vitest";
import { chartPrecision, price, priceInput, sizeText, zerosAfterPoint } from "../src/lib/format";

const e18 = (s: string) => {
  const [w = "0", f = ""] = s.split(".");
  return BigInt(w) * 10n ** 18n + BigInt(f.padEnd(18, "0"));
};

describe("price", () => {
  it("formats as the SDK does down to $0.0001, and below keeps 4 significant figures", () => {
    expect(price(e18("72884.77"))).toBe("$72,884.77");
    expect(price(e18("0.05783546"))).toBe("$0.05783546");
    expect(price(e18("0.0001"))).toBe("$0.0001");
    // MOG: 8 decimals would read $0.00000007, and its day's change $0.
    expect(price(e18("0.000000071234567"))).toBe("$0.00000007123");
    expect(price(-e18("0.0000000067"))).toBe("-$0.0000000067");
    expect(price(0n)).toBe("$0");
  });
});

describe("priceInput", () => {
  it("suggests a price to 5 significant figures under $1, and to the cent above", () => {
    expect(priceInput(e18("64925.876"))).toBe("64925.87");
    // The mark button used to fill DOGE's 0.05783… as 0.05 and MOG's as 0.
    expect(priceInput(e18("0.0578354612"))).toBe("0.057835");
    expect(priceInput(e18("0.0000000753241"))).toBe("0.000000075324");
  });
});

describe("chartPrecision", () => {
  it("gives the axis enough decimals for 5 significant figures under $1, and at least 6", () => {
    expect([chartPrecision(null), chartPrecision(e18("72884.77")), chartPrecision(e18("161.02"))]).toEqual([2, 2, 4]);
    expect([chartPrecision(e18("0.5")), chartPrecision(e18("0.0578"))]).toEqual([6, 6]);
    expect(chartPrecision(e18("0.000000071"))).toBe(12);
    expect([zerosAfterPoint(e18("0.001372")), zerosAfterPoint(e18("5")), zerosAfterPoint(0n)]).toEqual([2, 0, 0]);
  });
});

describe("sizeText", () => {
  it("shows a size to at least 4 significant figures, so it never looks smaller than it is", () => {
    // A $100 bid at $72,884.77 is 0.001372… BTC: 4 decimals would show 0.0013.
    expect(sizeText(1_372_028_751_685_708n)).toBe("0.001372");
    // What a 0.0013 sell left of it: 4 decimals would show 0.
    expect(sizeText(72_028_751_685_708n)).toBe("0.00007202");
    expect(sizeText(1_300_000_000_000_000n)).toBe("0.0013");
    expect(sizeText(5n * 10n ** 18n)).toBe("5");
    expect(sizeText(123_456_789_000_000_000n)).toBe("0.1234");
    expect(sizeText(0n)).toBe("0");
    expect(sizeText(-72_028_751_685_708n)).toBe("-0.00007202");
  });
});
