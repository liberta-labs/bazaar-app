import type { ProSymbol } from "@liberta-labs/bazaar-sdk";
import { describe, expect, it } from "vitest";
import { FALLBACK_SESSION_HOURS, feedSchedule, fundingHoursPerYear, parseSchedule, tradingHours } from "../src/lib/hours";

// Schedules as Pyth's registry writes them.
const NY = "America/New_York";
const HOL = "0907/C,1126/C,1127/0930-1300,1225/C";
const REGULAR = `${NY};0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;${HOL}`;
const PRE = `${NY};0400-0930,0400-0930,0400-0930,0400-0930,0400-0930,C,C;${HOL}`;
const POST = `${NY};1600-2000,1600-2000,1600-2000,1600-2000,1600-2000,C,C;${HOL}`;
const NIGHT = `${NY};0000-0400&2000-2400,0000-0400&2000-2400,0000-0400&2000-2400,0000-0400&2000-2400,0000-0400,C,2000-2400;0906/C`;
const ALWAYS = `${NY};O,O,O,O,O,O,O;`;
const FX = `${NY};O,O,O,O,0000-1700,C,1700-2400;1224/0000-1700`;
const GOLD = `${NY};0000-1700&1800-2400,0000-1700&1800-2400,0000-1700&1800-2400,0000-1700&1800-2400,0000-1700,C,1800-2400;1225/C`;
const TOKYO = "Asia/Tokyo;0900-1130&1230-1525,0900-1130&1230-1525,0900-1130&1230-1525,0900-1130&1230-1525,0900-1130&1230-1525,C,C;";

const feed = (schedule: string, sessions: Record<string, string> = {}): ProSymbol => ({
  id: 1,
  feedId: "0x01",
  symbol: "",
  name: "",
  description: "",
  assetType: "",
  minChannel: "",
  state: "stable",
  schedule,
  sessions,
  exponent: null,
  hermesId: null,
});

const sameClock = () => 0;

describe("parseSchedule", () => {
  it("reads the open minutes of each day, and refuses what it can't read", () => {
    const s = parseSchedule(REGULAR)!;
    expect(s.zone).toBe(NY);
    expect(s.holidays).toBe(true);
    expect(s.open.reduce((a, b) => a + b, 0)).toBe(5 * 390);
    expect(parseSchedule(ALWAYS)!.holidays).toBe(false);
    for (const bad of ["", "America/New_York", `${NY};O,O,O`, `${NY};0930-1600,x,C,C,C,C,C;`, `${NY};1600-0930,C,C,C,C,C,C;`, `${NY};0960-1000,C,C,C,C,C,C;`]) {
      expect(parseSchedule(bad)).toBeNull();
    }
  });

  it("takes every session of a feed together, or its regular schedule when it lists none", () => {
    expect(feedSchedule(feed(REGULAR, { regular: REGULAR, pre_market: PRE, post_market: POST, over_night: NIGHT }))!.open.reduce((a, b) => a + b, 0)).toBe(5 * 1_440);
    expect(feedSchedule(feed(REGULAR))!.open.reduce((a, b) => a + b, 0)).toBe(5 * 390);
    expect(feedSchedule(feed(REGULAR, { regular: REGULAR, odd: TOKYO }))).toBeNull();
  });
});

describe("tradingHours", () => {
  it("says 24/7 for a feed priced all week", () => {
    expect(tradingHours([feed(ALWAYS, { regular: ALWAYS })], sameClock)).toEqual({ kind: "24/7", text: null, local: null, zone: "New York", holidays: false });
  });

  it("says 24/5 for a US stock priced in every session, and gives its weekly run", () => {
    const h = tradingHours([feed(REGULAR, { regular: REGULAR, pre_market: PRE, post_market: POST, over_night: NIGHT })], sameClock)!;
    expect(h).toEqual({ kind: "24/5", text: "Sun 20:00 – Fri 20:00", local: null, zone: "New York", holidays: true });
    expect(tradingHours([feed(FX, { regular: FX })], sameClock)).toMatchObject({ kind: "24/5", text: "Sun 17:00 – Fri 17:00" });
  });

  it("gives set hours by day for a stock priced in its exchange's hours", () => {
    expect(tradingHours([feed(REGULAR, { regular: REGULAR })], sameClock)).toEqual({ kind: "hours", text: "Mon–Fri 09:30–16:00", local: null, zone: "New York", holidays: true });
    expect(tradingHours([feed(REGULAR, { regular: REGULAR, pre_market: PRE, post_market: POST })], sameClock)).toMatchObject({ kind: "hours", text: "Mon–Fri 04:00–20:00" });
    expect(tradingHours([feed(TOKYO, { regular: TOKYO })], sameClock)).toMatchObject({ kind: "hours", text: "Mon–Fri 09:00–11:30, 12:30–15:25", zone: "Tokyo", holidays: false });
    expect(tradingHours([feed(GOLD, { regular: GOLD })], sameClock)).toMatchObject({ kind: "hours", text: "Sun–Thu 18:00–17:00 next day" });
  });

  it("adds the viewer's own time when it differs from the venue's", () => {
    const stock = feed(REGULAR, { regular: REGULAR, pre_market: PRE, post_market: POST, over_night: NIGHT });
    expect(tradingHours([stock], () => -180)).toMatchObject({ text: "Sun 20:00 – Fri 20:00", local: "Sun 17:00 – Fri 17:00" });
    expect(tradingHours([feed(REGULAR)], () => 840)).toMatchObject({ text: "Mon–Fri 09:30–16:00", local: "Mon–Fri 23:30–06:00 next day" });
    expect(tradingHours([feed(REGULAR)], () => null)).toMatchObject({ local: null });
  });

  it("keeps only the hours a composite's legs share", () => {
    const fx = feed(FX, { regular: FX });
    const stock = feed(REGULAR, { regular: REGULAR, pre_market: PRE, post_market: POST, over_night: NIGHT });
    expect(tradingHours([stock, fx], sameClock)).toMatchObject({ kind: "24/5", text: "Sun 20:00 – Fri 17:00" });
    expect(tradingHours([feed(TOKYO), fx], sameClock)).toBeNull(); // different time zones
  });

  it("says nothing when a leg has no registry entry or an unreadable schedule", () => {
    expect(tradingHours([], sameClock)).toBeNull();
    expect(tradingHours([null], sameClock)).toBeNull();
    expect(tradingHours([feed("garbage")], sameClock)).toBeNull();
    expect(tradingHours([feed(`${NY};C,C,C,C,C,C,C;`)], sameClock)).toBeNull();
  });
});

describe("fundingHoursPerYear", () => {
  const market = (legFeeds: (ProSymbol | null)[], continuous = false) => ({ continuous, legFeeds });
  const stock = feed(REGULAR, { regular: REGULAR, pre: PRE, post: POST, overnight: NIGHT });

  it("counts every hour of the year on a 24/7 market", () => {
    expect(fundingHoursPerYear(market([feed(ALWAYS)], true))).toBe(8_760);
  });

  it("counts the hours a week the prices are live, times 365/7: about 6,260 for 24/5, about 1,700 for regular hours", () => {
    // Sunday 20:00 to Friday 20:00 in New York: 120 hours a week.
    expect(fundingHoursPerYear(market([stock]))).toBeCloseTo((120 * 365) / 7, 6);
    // 09:30 to 16:00 on weekdays: 32.5 hours a week.
    expect(fundingHoursPerYear(market([feed(REGULAR, { regular: REGULAR })]))).toBeCloseTo((32.5 * 365) / 7, 6);
  });

  it("counts only the hours every leg of a composite is live", () => {
    expect(fundingHoursPerYear(market([stock, feed(REGULAR, { regular: REGULAR })]))).toBeCloseTo((32.5 * 365) / 7, 6);
  });

  it("falls back to regular hours when the schedule can't be read", () => {
    expect(fundingHoursPerYear(market([null]))).toBe(FALLBACK_SESSION_HOURS);
    expect(fundingHoursPerYear(market([feed("not a schedule")]))).toBe(FALLBACK_SESSION_HOURS);
    expect(fundingHoursPerYear(market([feed(TOKYO), feed(REGULAR)]))).toBe(FALLBACK_SESSION_HOURS);
    expect(fundingHoursPerYear(market([]))).toBe(FALLBACK_SESSION_HOURS);
  });
});
