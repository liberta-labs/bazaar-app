import { describe, expect, it } from "vitest";
import { sizeText } from "../src/lib/format";

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
