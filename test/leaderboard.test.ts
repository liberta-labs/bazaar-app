import { describe, expect, it } from "vitest";
import { BADGES, entryOf, levelOf, medalOf, nextBadge, parseLeaderboard, streakState } from "../src/lib/leaderboard";

const A = "0x00000000000000000000000000000000000000aa";
const doc = (entries: unknown[], extra: Record<string, unknown> = {}) => ({
  version: 1,
  chainId: 421614,
  generatedAt: 1_794_528_000,
  block: 5,
  rules: { badgePoints: 100, dayPoints: 10, streakDayPoints: 20, badges: [] },
  entries,
  ...extra,
});
const entry = (o: Record<string, unknown> = {}) => ({
  rank: 1,
  account: A,
  points: 560,
  badges: ["deposit", "marketOrder"],
  daysActive: 2,
  longestStreak: 2,
  currentStreak: 1,
  lastActiveDay: 1_794_528_000,
  ...o,
});

describe("parseLeaderboard", () => {
  it("reads the service's document", () => {
    const b = parseLeaderboard(doc([entry()]));
    expect(b).toEqual({ chainId: 421614, generatedAt: 1_794_528_000, rules: { badgePoints: 100, dayPoints: 10, streakDayPoints: 20 }, entries: [entry()] });
  });

  it("drops rows it can't read and badges it doesn't know, in the board's own badge order", () => {
    const b = parseLeaderboard(
      doc([entry({ badges: ["keeper", "someNewBadge", "deposit"] }), entry({ account: "<script>" }), entry({ points: "560" }), null, entry({ account: `0x${"b".repeat(40)}`, lastActiveDay: null })]),
    );
    expect(b.entries.map((e) => [e.account, e.badges])).toEqual([
      [A, ["deposit", "keeper"]],
      [`0x${"b".repeat(40)}`, ["deposit", "marketOrder"]],
    ]);
    expect(b.entries[1]!.lastActiveDay).toBeNull();
  });

  it("refuses a document of another shape or version", () => {
    expect(() => parseLeaderboard(null)).toThrow();
    expect(() => parseLeaderboard(doc([], { version: 2 }))).toThrow();
    expect(() => parseLeaderboard(doc([], { rules: {} }))).toThrow(/rules/);
    expect(() => parseLeaderboard(doc([], { entries: "none" }))).toThrow();
  });
});

describe("entryOf", () => {
  it("finds the account in any case, or nothing", () => {
    const b = parseLeaderboard(doc([entry()]));
    expect(entryOf(b, A.toUpperCase().replace("0X", "0x"))?.points).toBe(560);
    expect(entryOf(b, `0x${"c".repeat(40)}`)).toBeNull();
    expect(entryOf(b, null)).toBeNull();
  });
});

describe("levelOf", () => {
  it("names the level the points reach, and how far it is to the next", () => {
    expect(levelOf(0)).toMatchObject({ level: { name: "Rookie" }, next: { name: "Explorer" }, toNext: 200, progress: 0 });
    expect(levelOf(560)).toMatchObject({ level: { name: "Trader" }, next: { name: "Pro" }, toNext: 240, progress: 0.2 });
    // Every badge, and nothing else, reaches Pro.
    expect(levelOf(BADGES.length * 100)).toMatchObject({ level: { name: "Pro" }, toNext: 700 });
    expect(levelOf(5000)).toMatchObject({ level: { name: "Legend" }, next: null, toNext: 0, progress: 1 });
  });
});

describe("medalOf", () => {
  it("gives the top three a medal, by rank, so a tie shares one", () => {
    expect([1, 2, 3, 4].map(medalOf)).toEqual(["🥇", "🥈", "🥉", null]);
  });
});

describe("streakState", () => {
  const DAY = 86_400;
  const now = 20_770 * DAY + 3_600;
  const e = (currentStreak: number, lastDay: number | null) =>
    parseLeaderboard(doc([entry({ currentStreak, lastActiveDay: lastDay === null ? null : lastDay * DAY })])).entries[0]!;
  it("is safe after a trade today, at risk when the run ended yesterday, and none without a run", () => {
    expect(streakState(e(3, 20_770), now)).toBe("safe");
    expect(streakState(e(3, 20_769), now)).toBe("atRisk");
    expect(streakState(e(0, 20_760), now)).toBe("none");
    expect(streakState(null, now)).toBe("none");
  });
});

describe("nextBadge", () => {
  it("suggests the first badge not yet earned, in the board's order", () => {
    expect(nextBadge(new Set(["deposit", "marketOrder"]))).toBe("makerFill");
    expect(nextBadge(new Set(BADGES))).toBeNull();
  });
});
