import { describe, expect, it } from "vitest";
import { canSignRelayed, classifyCode } from "../src/lib/wallet";

describe("classifyCode (the smart-wallet check after every connect)", () => {
  it("treats empty code as an ordinary account", () => {
    expect(classifyCode("0x")).toBe("eoa");
    expect(classifyCode(null)).toBe("eoa");
  });

  it("treats an EIP-7702 delegation as an account that still signs with its own key", () => {
    expect(classifyCode("0xef0100" + "ab".repeat(20))).toBe("delegated");
    expect(classifyCode("0xEF0100" + "AB".repeat(20))).toBe("delegated");
    expect(canSignRelayed("delegated")).toBe(true);
  });

  it("treats any other code as a smart-contract wallet that cannot sign relayed requests", () => {
    expect(classifyCode("0x6080604052")).toBe("contract");
    expect(canSignRelayed("contract")).toBe(false);
    expect(canSignRelayed("eoa")).toBe(true);
  });
});
