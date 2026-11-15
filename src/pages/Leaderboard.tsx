/**
 * The leaderboard: a badge for each part of Bazaar tried once, and points for each day with a trade and
 * for the longest run of such days. On a testnet, where money is free, it rewards using the whole product
 * rather than size. The service scores it every 15 minutes; this page only reads the result.
 *
 * A podium for the top three, your level (by points), streak and badge collection, and the standings.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Empty, Loading, Tip, useAsync } from "../components/ui";
import { ACTIVE, addressUrl } from "../config/networks";
import { explain } from "../lib/errors";
import { relative, shortAddr } from "../lib/format";
import {
  BADGE_INFO,
  BADGES,
  type Badge,
  entryOf,
  fetchLeaderboard,
  type Leaderboard,
  type LeaderboardEntry,
  levelOf,
  medalOf,
  nextBadge,
  streakState,
} from "../lib/leaderboard";
import { useWallet } from "../state/connection";
import { useSort } from "../state/sort";
import "../styles/leaderboard.css";

/** How often an open page reads the board again: the service makes a new one every 15 minutes. */
const REFRESH_MS = 5 * 60_000;
/** Rows shown before "Show all". */
const SHOWN = 100;

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** An emoji that is decoration beside words that already say it. */
const E = ({ children, label }: { children: string; label?: string }) =>
  label ? (
    <span className="lb-emoji" role="img" aria-label={label}>
      {children}
    </span>
  ) : (
    <span className="lb-emoji" aria-hidden>
      {children}
    </span>
  );

/** The badges an account holds, as their emojis, each named on hover. */
function BadgeStrip({ badges }: { badges: readonly Badge[] }) {
  return (
    <span className="lb-strip">
      {badges.map((b) => (
        <Tip key={b} text={BADGE_INFO[b].label}>
          <E label={BADGE_INFO[b].label}>{BADGE_INFO[b].emoji}</E>
        </Tip>
      ))}
    </span>
  );
}

function You() {
  return <span className="badge mine">you</span>;
}

function Podium({ entries, mine }: { entries: readonly LeaderboardEntry[]; mine: string | undefined }) {
  const top = entries.slice(0, 3);
  if (!top.length) return null;
  // Second, first, third: the winner in the middle, standing tallest.
  const spots = [top[1] && { e: top[1], place: 2 }, { e: top[0]!, place: 1 }, top[2] && { e: top[2], place: 3 }];
  return (
    <section className="panel">
      <div className="spread" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>
          <E>🏆</E> Top of the board
        </h2>
        <span className="small muted">Ties share a medal</span>
      </div>
      <div className="lb-podium">
        {spots.map((s, i) =>
          s ? (
            <div key={s.e.account} className={`lb-spot p${s.place}`}>
              {s.e.rank === 1 && (
                <div className="lb-crown">
                  <E>👑</E>
                </div>
              )}
              <div className="lb-medal">
                <E label={`Rank ${s.e.rank}`}>{medalOf(s.e.rank) ?? "🎖️"}</E>
              </div>
              <div className="lb-who">
                <a className="mono small" style={{ whiteSpace: "nowrap" }} href={addressUrl(s.e.account)} target="_blank" rel="noopener noreferrer">
                  {shortAddr(s.e.account)}
                </a>
                {s.e.account === mine && <You />}
              </div>
              <div className="small muted">
                <E>{levelOf(s.e.points).level.emoji}</E> {levelOf(s.e.points).level.name}
                {s.e.currentStreak > 0 && (
                  <>
                    {" · "}
                    <E>🔥</E> {s.e.currentStreak}
                  </>
                )}
              </div>
              <div className="lb-pts">
                {s.e.points.toLocaleString()}
                <small>pts</small>
              </div>
              <BadgeStrip badges={s.e.badges} />
              <div className="lb-step">{s.place}</div>
            </div>
          ) : (
            <div key={`empty-${i}`} />
          ),
        )}
      </div>
      <div className="lb-podium-base" />
    </section>
  );
}

function StreakCard({ e }: { e: LeaderboardEntry | null }) {
  const state = streakState(e);
  const n = e?.currentStreak ?? 0;
  return (
    <div className={`stat lb-streak${n > 0 ? " on" : ""}${state === "atRisk" ? " atRisk" : ""}`}>
      <span className="lb-flame">
        <E>{n > 0 ? "🔥" : "🧊"}</E>
      </span>
      <div>
        <div className="lb-big">{n > 0 ? `${days(n)}` : "No streak yet"}</div>
        <div className="small muted">
          {state === "safe"
            ? `You traded today. Come back tomorrow to make it ${n + 1}!`
            : state === "atRisk"
              ? "⏳ Trade today to keep it alive!"
              : "Trade today to light your first flame."}
        </div>
      </div>
    </div>
  );
}

function BadgeTile({ b, done, points }: { b: Badge; done: boolean; points: number }) {
  const info = BADGE_INFO[b];
  return (
    <div className={`lb-badge ${done ? "earned" : "locked"}`}>
      <div className="lb-badge-icon">
        <E>{info.emoji}</E>
      </div>
      <div className="lb-badge-label">{info.label}</div>
      <div className="small muted">{info.how}</div>
      <span className="lb-tag">{done ? "✓ Earned" : `🔒 +${points}`}</span>
      {!done && info.to && (
        <Link className="small" to={info.to}>
          Go there →
        </Link>
      )}
    </div>
  );
}

function YourProgress({ board }: { board: Leaderboard }) {
  const w = useWallet();
  const me = entryOf(board, w.address);
  const earned = new Set<Badge>(me?.badges ?? []);
  const points = me?.points ?? 0;
  const { level, next, toNext, progress } = levelOf(points);
  const up = nextBadge(earned);
  const collection = (
    <>
      <div className="lb-bar-label">
        <span>
          <E>🎖️</E> Badge collection
        </span>
        <span>
          {earned.size} of {BADGES.length}
        </span>
      </div>
      <div className="lb-bar">
        <span style={{ width: `${(earned.size / BADGES.length) * 100}%` }} />
      </div>
      <div className="lb-badges">
        {BADGES.map((b) => (
          <BadgeTile key={b} b={b} done={earned.has(b)} points={board.rules.badgePoints} />
        ))}
      </div>
    </>
  );

  if (!w.address) {
    return (
      <section className="panel">
        <h2 style={{ marginTop: 0 }}>
          <E>🎮</E> Your progress
        </h2>
        <Empty title="Connect to see your level, streak and badges" action={<button className="primary" onClick={w.openConnect}>Connect</button>}>
          Here's everything you can collect:
        </Empty>
        {collection}
      </section>
    );
  }

  const medal = me ? medalOf(me.rank) : null;
  return (
    <section className="panel">
      <div className="lb-me-head">
        <div className="lb-level-icon">
          <E>{level.emoji}</E>
        </div>
        <div>
          <div className="small muted">Your level</div>
          <div className="lb-level-name">{level.name}</div>
        </div>
        <div className="lb-me-score">
          <div className="lb-big">{points.toLocaleString()} pts</div>
          <div className="small muted">
            {me ? (
              <>
                {medal ? <E>{medal}</E> : "#"}
                {medal ? " " : ""}
                Rank {me.rank} of {board.entries.length}
              </>
            ) : (
              "Not on the board yet"
            )}
          </div>
        </div>
      </div>

      <div className="lb-bar-label">
        <span>
          <E>{level.emoji}</E> {level.name}
        </span>
        <span>
          {next ? (
            <>
              {toNext.toLocaleString()} pts to <E>{next.emoji}</E> {next.name}
            </>
          ) : (
            "Top level reached 👑"
          )}
        </span>
      </div>
      <div className="lb-bar">
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      <div className="lb-me-grid">
        <StreakCard e={me} />
        <div className="stat">
          <div className="label">
            <Tip text={`Each day of your longest run of days in a row with a trade is worth ${board.rules.streakDayPoints} points.`}>
              <E>🏆</E> Best streak
            </Tip>
          </div>
          <div className="value">{days(me?.longestStreak ?? 0)}</div>
        </div>
        <div className="stat">
          <div className="label">
            <Tip text={`Days (UTC) with at least one trade. Each is worth ${board.rules.dayPoints} points.`}>
              <E>📅</E> Days traded
            </Tip>
          </div>
          <div className="value">{me?.daysActive ?? 0}</div>
        </div>
      </div>

      {up ? (
        <div className="lb-next">
          <E>{BADGE_INFO[up].emoji}</E>
          <div className="grow">
            <div>
              <b>Next up: {BADGE_INFO[up].label}</b> <span className="accent">+{board.rules.badgePoints}</span>
            </div>
            <div className="small muted">{BADGE_INFO[up].how}</div>
          </div>
          {BADGE_INFO[up].to && (
            <Link className="btn small primary" to={BADGE_INFO[up].to}>
              Go →
            </Link>
          )}
        </div>
      ) : (
        <div className="lb-done-all">
          <E>💎</E> Full collection! You've tried every part of Bazaar.
        </div>
      )}

      {collection}
      {!me && <p className="small muted">Nothing counted yet. Your first deposit or trade shows up within 15 minutes.</p>}
    </section>
  );
}

function Standings({ board, mine }: { board: Leaderboard; mine: string | undefined }) {
  const [all, setAll] = useState(false);
  const { sorted, th } = useSort(board.entries, {
    rank: (e: LeaderboardEntry) => e.rank,
    points: (e: LeaderboardEntry) => e.points,
    badges: (e: LeaderboardEntry) => e.badges.length,
    days: (e: LeaderboardEntry) => e.daysActive,
    current: (e: LeaderboardEntry) => e.currentStreak,
    longest: (e: LeaderboardEntry) => e.longestStreak,
  });
  const rows = all ? sorted : sorted.slice(0, SHOWN);
  return (
    <section className="panel tight">
      <div className="panel-head">
        <h2>
          <E>📊</E> Standings
        </h2>
        <span className="small muted">Updated {relative(board.generatedAt)}, every 15 minutes</span>
      </div>
      {!board.entries.length ? (
        <Empty title="No one has points yet">Deposit and trade to be first on the board.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="lb-table">
            <thead>
              <tr>
                <th {...th("rank", "num")}>Rank</th>
                <th>Trader</th>
                <th {...th("points", "num")}>Points</th>
                <th {...th("badges")}>Badges</th>
                <th {...th("current", "num")}>Streak</th>
                <th {...th("longest", "num hide-sm")}>Best streak</th>
                <th {...th("days", "num hide-sm")}>Days traded</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const lvl = levelOf(e.points).level;
                const medal = medalOf(e.rank);
                return (
                  <tr key={e.account} className={e.account === mine ? "lb-mine" : ""}>
                    <td className="num lb-rank">{medal ? <E label={`Rank ${e.rank}`}>{medal}</E> : <span className="small muted">#{e.rank}</span>}</td>
                    <td>
                      <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <Tip text={lvl.name}>
                          <E label={lvl.name}>{lvl.emoji}</E>
                        </Tip>
                        <a className="mono" style={{ whiteSpace: "nowrap" }} href={addressUrl(e.account)} target="_blank" rel="noopener noreferrer">
                          {shortAddr(e.account)}
                        </a>
                        {e.account === mine && <You />}
                      </span>
                    </td>
                    <td className="num">
                      <b>{e.points.toLocaleString()}</b>
                    </td>
                    <td>
                      <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                        <span className="hide-sm">
                          <BadgeStrip badges={e.badges} />
                        </span>
                        <span className="small muted" style={{ whiteSpace: "nowrap" }}>
                          {e.badges.length}/{BADGES.length}
                        </span>
                      </span>
                    </td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {e.currentStreak > 0 ? (
                        <>
                          <E>🔥</E> {e.currentStreak}
                        </>
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                    <td className="num hide-sm">{days(e.longestStreak)}</td>
                    <td className="num hide-sm">{e.daysActive}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!all && sorted.length > SHOWN && (
        <div className="row" style={{ justifyContent: "center", padding: 10 }}>
          <button onClick={() => setAll(true)}>Show all {sorted.length}</button>
        </div>
      )}
    </section>
  );
}

export function LeaderboardPage() {
  const w = useWallet();
  const mine = w.address?.toLowerCase();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  const board = useAsync(() => fetchLeaderboard(ACTIVE.chainId), [tick]);
  const rules = board.data?.rules;

  return (
    <div className="stack lb">
      <div className="hero lb-hero" style={{ marginBottom: 0 }}>
        <h1>
          <E>🏆</E> Leaderboard
        </h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          Collect badges for trying every part of Bazaar, keep your streak alive, and climb the ranks.
        </p>
        {rules && (
          <div className="lb-chips">
            <span className="lb-chip">
              <E>🎖️</E> {rules.badgePoints} per badge
            </span>
            <span className="lb-chip">
              <E>📅</E> +{rules.dayPoints} per trading day
            </span>
            <span className="lb-chip">
              <E>🔥</E> +{rules.streakDayPoints} per day of your best streak
            </span>
            <span className="lb-chip">
              <E>⏱️</E> Updated every 15 minutes
            </span>
          </div>
        )}
      </div>
      {board.data === undefined ? (
        board.error ? (
          <Empty title={explain(board.error)} action={<button onClick={board.reload}>Try again</button>} />
        ) : (
          <Loading what="Loading the leaderboard" />
        )
      ) : board.data === null ? (
        <Empty title="The leaderboard isn't ready yet">It's worked out every 15 minutes. Check back shortly.</Empty>
      ) : (
        <>
          <Podium entries={board.data.entries} mine={mine} />
          <YourProgress board={board.data} />
          <Standings board={board.data} mine={mine} />
        </>
      )}
    </div>
  );
}
