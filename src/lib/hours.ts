/**
 * When a market has live prices, from Pyth's symbols registry. Pyth publishes a feed in one or more
 * sessions (a US stock: regular hours, pre-market, after-hours and overnight), and the market has a
 * fresh price in any of them: a stock with all four runs from Sunday evening to Friday evening, one
 * with regular hours alone only while its exchange is open. A composite has live prices only while
 * both its feeds do. Outside these hours a trading-hours market runs on its last price, under the
 * after-hours limits.
 *
 * A registry schedule reads "<time zone>;<seven days, Monday first>;<holiday overrides>", each day
 * "O" (open all day), "C" (closed) or "HHMM-HHMM" ranges joined by "&".
 */
import type { ProSymbol } from "@liberta-labs/bazaar-sdk";

const DAY = 1_440;
const WEEK = 7 * DAY;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
/** A single weekly run at least this long counts as around the clock on weekdays. */
const ROUND_THE_CLOCK_MIN = 4.5 * DAY;

/** A schedule read: its time zone, the minutes of the week it is open (Monday 00:00 first), and whether it lists holidays. */
export interface WeekSchedule {
  readonly zone: string;
  readonly open: Uint8Array;
  readonly holidays: boolean;
}

/** One registry schedule, or null when it can't be read. */
export function parseSchedule(schedule: string): WeekSchedule | null {
  const [zone, days, holidays] = schedule.split(";");
  if (!zone || days === undefined) return null;
  const d = days.split(",");
  if (d.length !== 7) return null;
  const open = new Uint8Array(WEEK);
  for (let i = 0; i < 7; i++) {
    const day = d[i]!.trim();
    if (day === "O") open.fill(1, i * DAY, (i + 1) * DAY);
    else if (day !== "C") {
      for (const r of day.split("&")) {
        const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(r);
        if (!m || Number(m[2]) > 59 || Number(m[4]) > 59) return null;
        const from = Number(m[1]) * 60 + Number(m[2]);
        const to = Number(m[3]) * 60 + Number(m[4]);
        if (from >= to || to > DAY) return null;
        open.fill(1, i * DAY + from, i * DAY + to);
      }
    }
  }
  return { zone, open, holidays: Boolean(holidays?.trim()) };
}

/** Every session of a feed together, or null when one can't be read or they name different time zones. */
export function feedSchedule(feed: Pick<ProSymbol, "schedule" | "sessions">): WeekSchedule | null {
  const listed = Object.values(feed.sessions ?? {});
  const parsed = (listed.length ? listed : [feed.schedule]).map(parseSchedule);
  if (parsed.length === 0 || parsed.some((p) => p === null)) return null;
  const all = parsed as WeekSchedule[];
  const zone = all[0]!.zone;
  if (all.some((p) => p.zone !== zone)) return null;
  const open = new Uint8Array(WEEK);
  for (const p of all) for (let t = 0; t < WEEK; t++) if (p.open[t]) open[t] = 1;
  return { zone, open, holidays: all.some((p) => p.holidays) };
}

/** When a market's feeds all have live prices, as a page shows it. */
export interface TradingHoursText {
  /** "24/7", "24/5" (around the clock on weekdays), or "hours" (set hours). */
  readonly kind: "24/7" | "24/5" | "hours";
  /** "Sun 20:00 – Fri 20:00" or "Mon–Fri 09:30–16:00" in `zone`'s time; null for 24/7. */
  readonly text: string | null;
  /** The same hours in the viewer's time zone this week, or null when it is `zone`'s (or 24/7). */
  readonly local: string | null;
  /** "New York". */
  readonly zone: string;
  /** Pyth lists holiday closures or early closes. */
  readonly holidays: boolean;
}

/**
 * The hours a market's legs (MarketInfo.legFeeds) all have live prices, or null when a leg has no
 * registry entry, a schedule can't be read, or the legs keep different time zones.
 * `offsetMinutes(zone)` is how far the viewer's clock runs ahead of `zone`'s now (default: from the
 * browser's).
 */
export function tradingHours(legs: readonly (ProSymbol | null)[], offsetMinutes: (zone: string) => number | null = viewerOffset): TradingHoursText | null {
  if (legs.length === 0 || legs.some((l) => l === null)) return null;
  const schedules = legs.map((l) => feedSchedule(l!));
  if (schedules.some((s) => s === null)) return null;
  const all = schedules as WeekSchedule[];
  const zone = all[0]!.zone;
  if (all.some((s) => s.zone !== zone)) return null;
  const open = new Uint8Array(WEEK);
  for (let t = 0; t < WEEK; t++) open[t] = all.every((s) => s.open[t]) ? 1 : 0;
  const zoneName = zone.split("/").pop()!.replace(/_/g, " ");
  const holidays = all.some((s) => s.holidays);
  if (open.every((x) => x === 1)) return { kind: "24/7", text: null, local: null, zone: zoneName, holidays: false };
  const r = runs(open);
  if (r.length === 0) return null;
  const kind = r.length === 1 && r[0]![1] - r[0]![0] >= ROUND_THE_CLOCK_MIN ? "24/5" : "hours";
  const offset = offsetMinutes(zone);
  return { kind, text: describe(open), local: offset ? describe(shift(open, offset)) : null, zone: zoneName, holidays };
}

/** The open runs of a week, as [start, end) minutes from Monday 00:00; a run over Sunday midnight ends past the week. */
function runs(open: Uint8Array): [number, number][] {
  const closed = open.indexOf(0);
  if (closed < 0) return [[0, WEEK]];
  const out: [number, number][] = [];
  let start: number | null = null;
  for (let i = 1; i <= WEEK; i++) {
    const t = closed + i;
    const isOpen = open[t % WEEK] === 1;
    if (isOpen && start === null) start = t;
    if (!isOpen && start !== null) {
      out.push([start % WEEK, start % WEEK + (t - start)]);
      start = null;
    }
  }
  return out;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** A minute of the week as "Fri 20:00"; an end on midnight reads as the day before at 24:00. */
function at(t: number, end = false): string {
  const w = ((t % WEEK) + WEEK) % WEEK;
  if (end && w % DAY === 0) return `${DAYS[(w / DAY + 6) % 7]} 24:00`;
  return `${DAYS[Math.floor(w / DAY)]} ${hhmm(w % DAY)}`;
}

/**
 * One run over the week: "Sun 20:00 – Fri 20:00". The same hours on consecutive days: "Mon–Fri
 * 09:30–16:00", or "Sun–Thu 18:00–17:00 next day" for hours that run past midnight. Otherwise each
 * day's hours, days with the same hours together: "Mon–Thu 09:30–12:00, 13:00–16:00 · Fri 09:30–12:00".
 */
function describe(open: Uint8Array): string {
  const r = runs(open);
  if (r.length === 1 && r[0]![1] - r[0]![0] > DAY) return `${at(r[0]![0])} – ${at(r[0]![1], true)}`;
  const daily = sameDaily(r);
  if (daily) return daily;
  const days = DAYS.map((_, i) => {
    const ranges: string[] = [];
    let from: number | null = null;
    for (let m = 0; m <= DAY; m++) {
      const isOpen = m < DAY && open[i * DAY + m] === 1;
      if (isOpen && from === null) from = m;
      if (!isOpen && from !== null) {
        ranges.push(`${hhmm(from)}–${hhmm(m)}`);
        from = null;
      }
    }
    return ranges.join(", ");
  });
  const groups: string[] = [];
  for (let i = 0; i < 7; ) {
    let j = i;
    while (j + 1 < 7 && days[j + 1] === days[i]) j++;
    if (days[i]) groups.push(`${i === j ? DAYS[i] : `${DAYS[i]}–${DAYS[j]}`} ${days[i]}`);
    i = j + 1;
  }
  return groups.join(" · ");
}

/** Runs that open at the same time for the same length on consecutive days, as "Mon–Fri 09:30–16:00"; null otherwise. */
function sameDaily(r: readonly [number, number][]): string | null {
  const [s0, e0] = r[0]!;
  const start = s0 % DAY;
  const len = e0 - s0;
  if (len > DAY || r.some(([s, e]) => s % DAY !== start || e - s !== len)) return null;
  const days = new Set(r.map(([s]) => Math.floor(s / DAY) % 7));
  if (days.size !== r.length) return null;
  const first = [...days].find((d) => !days.has((d + 6) % 7));
  if (first === undefined) return null;
  for (let k = 0; k < r.length; k++) if (!days.has((first + k) % 7)) return null;
  const last = (first + r.length - 1) % 7;
  const span = r.length === 1 ? DAYS[first] : `${DAYS[first]}–${DAYS[last]}`;
  const end = start + len;
  return `${span} ${hhmm(start)}–${end > DAY ? `${hhmm(end - DAY)} next day` : hhmm(end)}`;
}

/** The week moved `offset` minutes later: the same instants on a clock that runs `offset` minutes ahead. */
function shift(open: Uint8Array, offset: number): Uint8Array {
  const out = new Uint8Array(WEEK);
  for (let t = 0; t < WEEK; t++) out[(((t + offset) % WEEK) + WEEK) % WEEK] = open[t]!;
  return out;
}

/** How far the browser's clock runs ahead of `zone`'s right now, in minutes; null when the zone is unknown. */
function viewerOffset(zone: string): number | null {
  try {
    const now = new Date();
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]),
    );
    const zoneDay = DAYS.indexOf(parts.weekday as (typeof DAYS)[number]);
    if (zoneDay < 0) return null;
    const zoneMin = zoneDay * DAY + Number(parts.hour) * 60 + Number(parts.minute);
    const localMin = ((now.getDay() + 6) % 7) * DAY + now.getHours() * 60 + now.getMinutes();
    let d = (((localMin - zoneMin) % WEEK) + WEEK) % WEEK;
    if (d > WEEK / 2) d -= WEEK;
    return d;
  } catch {
    return null;
  }
}

/**
 * A market's hours in a word or two, for lists and pickers: "24/7" for a continuously traded market,
 * "24/5" for one whose feeds trade around the clock on weekdays, else "trading hours" (set hours, or a
 * schedule that can't be read).
 */
export function hoursLabel(m: { readonly continuous: boolean; readonly legFeeds: readonly (ProSymbol | null)[] }): "24/7" | "24/5" | "trading hours" {
  if (m.continuous) return "24/7";
  return tradingHours(m.legFeeds)?.kind === "24/5" ? "24/5" : "trading hours";
}

/** Hours a year in a 24/7 market. */
const YEAR_HOURS = 24 * 365;
/** A US stock's regular session, 6.5 hours a weekday: the assumption when a market's schedule can't be read. */
export const FALLBACK_SESSION_HOURS = 1_700;

/**
 * The hours a year a market accrues funding, for showing an hourly rate as a yearly one. The pair
 * accrues funding only while its price is live (FundingLib), so it's every hour of the year on a 24/7
 * market, and on any other the hours a week all its legs have live prices, times 365/7: about 6,260 for a
 * stock traded around the clock on weekdays (24/5), about 1,700 for one traded in regular hours alone.
 * Holidays aren't taken off. A schedule that can't be read counts as regular hours.
 */
export function fundingHoursPerYear(m: { readonly continuous: boolean; readonly legFeeds: readonly (ProSymbol | null)[] }): number {
  if (m.continuous) return YEAR_HOURS;
  const legs = m.legFeeds;
  if (legs.length === 0 || legs.some((l) => l === null)) return FALLBACK_SESSION_HOURS;
  const schedules = legs.map((l) => feedSchedule(l!));
  if (schedules.some((s) => s === null)) return FALLBACK_SESSION_HOURS;
  const all = schedules as WeekSchedule[];
  if (all.some((s) => s.zone !== all[0]!.zone)) return FALLBACK_SESSION_HOURS;
  let minutes = 0;
  for (let t = 0; t < WEEK; t++) if (all.every((s) => s.open[t])) minutes++;
  return minutes === 0 ? FALLBACK_SESSION_HOURS : (minutes / 60) * (365 / 7);
}
