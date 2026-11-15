/**
 * The leaderboard the service publishes (GET /leaderboard/<chainId>.json): a badge for each kind of
 * action, once, and points for each day with a trade and for the longest run of such days. The service
 * scores it from the subgraph every 15 minutes, once for everyone, so the page costs the subgraph nothing.
 */
import { SERVICE_URL } from "../config/env";

export const BADGES = ["deposit", "marketOrder", "makerFill", "tpslTriggered", "threeMarkets", "insurance", "proposal", "keeper"] as const;
export type Badge = (typeof BADGES)[number];

export interface LeaderboardEntry {
  readonly rank: number;
  readonly account: string;
  readonly points: number;
  readonly badges: readonly Badge[];
  readonly daysActive: number;
  readonly longestStreak: number;
  readonly currentStreak: number;
  /** The start of the latest day with a trade (unix seconds), or null. */
  readonly lastActiveDay: number | null;
}

export interface Leaderboard {
  readonly chainId: number;
  /** unix seconds */
  readonly generatedAt: number;
  readonly rules: { readonly badgePoints: number; readonly dayPoints: number; readonly streakDayPoints: number };
  readonly entries: readonly LeaderboardEntry[];
}

/** What each badge is called, its emoji, and how to earn it; `to` is the app page where it's done. */
export const BADGE_INFO: Record<Badge, { readonly label: string; readonly emoji: string; readonly how: string; readonly to?: string }> = {
  deposit: { label: "Deposit", emoji: "💰", how: "Deposit collateral on any market.", to: "/" },
  marketOrder: { label: "First trade", emoji: "⚡", how: "Buy or sell at market on any market.", to: "/" },
  makerFill: { label: "Limit order filled", emoji: "🎯", how: "Place a limit order that someone else fills.", to: "/" },
  tpslTriggered: { label: "Take-profit or stop-loss", emoji: "🛡️", how: "Set a take-profit or stop-loss that triggers.", to: "/" },
  threeMarkets: { label: "Three markets", emoji: "🌍", how: "Trade on three different markets.", to: "/" },
  insurance: { label: "Insurer", emoji: "☂️", how: "Deposit to a market's insurance fund.", to: "/earn" },
  proposal: { label: "Proposal", emoji: "📜", how: "Propose a new market, a market's termination, or an identifier upgrade.", to: "/proposals" },
  keeper: { label: "Keeper", emoji: "🤖", how: "Run a liquidation, trigger or ADL batch for someone else, with the SDK's keeper." },
};

/** Levels by points, lowest first. All eight badges reach Pro; Legend takes a few weeks of coming back too. */
export const LEVELS = [
  { min: 0, name: "Rookie", emoji: "🌱" },
  { min: 200, name: "Explorer", emoji: "🧭" },
  { min: 500, name: "Trader", emoji: "⚔️" },
  { min: 800, name: "Pro", emoji: "🏅" },
  { min: 1500, name: "Legend", emoji: "👑" },
] as const;
export type Level = (typeof LEVELS)[number];

/** The level `points` reach, the next one (null at the top), the points still to go, and how far along (0 to 1). */
export function levelOf(points: number): { level: Level; next: Level | null; toNext: number; progress: number } {
  let i = 0;
  while (i + 1 < LEVELS.length && points >= LEVELS[i + 1]!.min) i++;
  const level = LEVELS[i]!;
  const next = LEVELS[i + 1] ?? null;
  if (!next) return { level, next, toNext: 0, progress: 1 };
  return { level, next, toNext: next.min - points, progress: Math.max(0, Math.min(1, (points - level.min) / (next.min - level.min))) };
}

/** The medal for a rank in the top three, else null. */
export const medalOf = (rank: number): string | null => ["🥇", "🥈", "🥉"][rank - 1] ?? null;

/**
 * Where the account's streak stands: none, safe (it traded today, UTC), or at risk (its run ended
 * yesterday, so a trade today keeps it going and none breaks it).
 */
export function streakState(e: LeaderboardEntry | null, now: number = Date.now() / 1000): "none" | "safe" | "atRisk" {
  if (!e || e.currentStreak === 0 || e.lastActiveDay === null) return "none";
  const today = Math.floor(now / 86_400) * 86_400;
  return e.lastActiveDay >= today ? "safe" : "atRisk";
}

/** The first badge, in the board's order, not yet earned; null once all are. */
export const nextBadge = (earned: ReadonlySet<Badge>): Badge | null => BADGES.find((b) => !earned.has(b)) ?? null;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const isBadge = (v: unknown): v is Badge => typeof v === "string" && (BADGES as readonly string[]).includes(v);
const ADDRESS = /^0x[0-9a-f]{40}$/;

/** The service's document, checked; throws on anything else. Unknown badges are dropped, so a newer service doesn't break the page. */
export function parseLeaderboard(v: unknown): Leaderboard {
  const o = v as Partial<Record<string, unknown>> | null;
  const rules = o?.rules as Partial<Record<string, unknown>> | undefined;
  if (typeof o !== "object" || o === null || o.version !== 1 || !isInt(o.chainId) || !isInt(o.generatedAt) || !Array.isArray(o.entries)) {
    throw new Error("The leaderboard came back in a form this page can't read.");
  }
  if (!rules || !isInt(rules.badgePoints) || !isInt(rules.dayPoints) || !isInt(rules.streakDayPoints)) throw new Error("The leaderboard came back without its rules.");
  const entries = o.entries.flatMap((x): LeaderboardEntry[] => {
    const e = x as Partial<Record<string, unknown>> | null;
    if (typeof e !== "object" || e === null || typeof e.account !== "string" || !ADDRESS.test(e.account)) return [];
    if (![e.rank, e.points, e.daysActive, e.longestStreak, e.currentStreak].every(isInt) || !Array.isArray(e.badges)) return [];
    return [
      {
        rank: e.rank as number,
        account: e.account,
        points: e.points as number,
        badges: BADGES.filter((b) => (e.badges as unknown[]).some((y) => isBadge(y) && y === b)),
        daysActive: e.daysActive as number,
        longestStreak: e.longestStreak as number,
        currentStreak: e.currentStreak as number,
        lastActiveDay: isInt(e.lastActiveDay) ? e.lastActiveDay : null,
      },
    ];
  });
  return { chainId: o.chainId, generatedAt: o.generatedAt, rules: { badgePoints: rules.badgePoints, dayPoints: rules.dayPoints, streakDayPoints: rules.streakDayPoints }, entries };
}

/** The chain's leaderboard, or null when the service has none yet (it reads every 15 minutes, and from its start). */
export async function fetchLeaderboard(chainId: number): Promise<Leaderboard | null> {
  const r = await fetch(`${SERVICE_URL}/leaderboard/${chainId}.json`);
  if (r.status === 404 || r.status === 503) return null;
  if (!r.ok) throw new Error(`The leaderboard can't be read right now (HTTP ${r.status}).`);
  return parseLeaderboard(await r.json());
}

/** The account's entry, any case, or null when it has no points yet. */
export function entryOf(board: Leaderboard, account: string | null | undefined): LeaderboardEntry | null {
  if (!account) return null;
  const a = account.toLowerCase();
  return board.entries.find((e) => e.account === a) ?? null;
}
