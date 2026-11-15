/**
 * A trader's page (/trader/<address>), opened from an address on the leaderboard: who they are, their
 * realized profit and loss over a day, a week, a month or all time, their open positions and their
 * trades, each a page at a time. It reads the subgraph and the live price board, so it shows the same for
 * any address, connected or not.
 */
import type { history } from "@liberta-labs/bazaar-sdk";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type Address, getAddress, isAddress } from "viem";
import { AssetIcon } from "../components/AssetIcon";
import { Pager, usePaged } from "../components/Pager";
import { Empty, Loading, Pnl, TxLink, useAsync } from "../components/ui";
import { ACTIVE, addressUrl } from "../config/networks";
import { explain } from "../lib/errors";
import { dateTime, leverage, pct, price, shortAddr, signedUsd, sizeText, usd } from "../lib/format";
import { BADGES, entryOf, fetchLeaderboard, levelOf, medalOf } from "../lib/leaderboard";
import { describeChange, pnlOver } from "../lib/trader";
import { useBoard, useRead, useWallet } from "../state/connection";
import "../styles/trader.css";

const E18 = 10n ** 18n;
/** Rows on each page of positions and of activity. */
const PAGE = 10;

const PERIODS = [
  { key: "1D", days: 1, label: "Today (UTC)" },
  { key: "1W", days: 7, label: "Past week" },
  { key: "1M", days: 30, label: "Past month" },
  { key: "ALL", days: null, label: "All time" },
] as const;
type Period = (typeof PERIODS)[number]["key"];

export function TraderPage() {
  const { address = "" } = useParams();
  if (!isAddress(address, { strict: false })) {
    return <Empty title="That isn't an address" action={<Link to="/leaderboard">Back to the leaderboard</Link>} />;
  }
  const account = getAddress(address);
  // A fresh page per address: its tabs and pages start again.
  return <Trader key={account} account={account} />;
}

/** Two colours from the address, for an avatar that stays the same for a trader. */
function avatarOf(account: string): string {
  const h1 = parseInt(account.slice(2, 6), 16) % 360;
  const h2 = (h1 + 40 + (parseInt(account.slice(6, 10), 16) % 200)) % 360;
  return `linear-gradient(135deg, hsl(${h1} 70% 60%), hsl(${h2} 65% 45%))`;
}

function CopyAddress({ account }: { account: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(account).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button className="small" onClick={copy} title={account}>
      {copied ? "Copied" : "Copy address"}
    </button>
  );
}

/** An open position, priced now. */
interface Holding {
  readonly p: history.HistoryPosition;
  readonly now: bigint | null;
  /** Size at the price now; null without a price. */
  readonly value: bigint | null;
  /** Price PnL if closed at the price now; null without a price. */
  readonly pnl: bigint | null;
}

function Trader({ account }: { account: Address }) {
  const { readBz } = useRead();
  const { prices } = useBoard();
  const w = useWallet();
  const isMe = w.address?.toLowerCase() === account.toLowerCase();
  const [tab, setTab] = useState<"positions" | "activity">("positions");

  const data = useAsync(async () => {
    if (!readBz) return null;
    const [stats, days, open] = await Promise.all([
      readBz.history.accountStats(account),
      readBz.history.accountDayData(account, { first: 1000 }),
      readBz.history.positions({ account, openOnly: true, first: 1000 }),
    ]);
    return { stats, days: days.items, open: open.items };
  }, [readBz, account]);
  const board = useAsync(() => fetchLeaderboard(ACTIVE.chainId), []);
  const rank = board.data ? entryOf(board.data, account) : null;

  const holdings = useMemo((): Holding[] => {
    const rows = (data.data?.open ?? [])
      .filter((p) => p.size > 0n)
      .map((p) => {
        const now = prices?.price(p.pair)?.spot ?? null;
        const value = now === null ? null : (p.size * now) / E18;
        const pnl = value === null ? null : p.isLong ? value - p.entryValue : p.entryValue - value;
        return { p, now, value, pnl };
      });
    return rows.sort((a, b) => ((b.value ?? b.p.entryValue) > (a.value ?? a.p.entryValue) ? 1 : -1));
  }, [data.data, prices]);

  if (data.data === undefined || data.data === null) {
    return data.error ? <Empty title={explain(data.error)} action={<button onClick={data.reload}>Try again</button>} /> : <Loading what="Loading this trader" />;
  }
  const { stats, days } = data.data;
  const positionsValue = holdings.reduce((s, h) => s + (h.value ?? 0n), 0n);
  const unrealized = holdings.reduce((s, h) => s + (h.pnl ?? 0n), 0n);
  const volume = stats ? stats.makerVolumeNotional + stats.takerVolumeNotional : 0n;
  const lvl = rank ? levelOf(rank.points).level : null;

  return (
    <div className="stack trader">
      <div className="trader-top">
        <section className="panel trader-card">
          <div className="trader-who">
            <span className="trader-avatar" style={{ background: avatarOf(account) }} aria-hidden="true" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <h1 className="mono trader-name" title={account}>
                {shortAddr(account)} {isMe && <span className="badge mine">you</span>}
              </h1>
              <div className="small muted">
                {stats ? `Joined ${new Date(stats.firstSeenTimestamp * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : "No activity on Bazaar yet"}
                {rank && lvl && (
                  <>
                    {" · "}
                    <Link to="/leaderboard">{medalOf(rank.rank) ?? `#${rank.rank}`} on the leaderboard</Link>
                    {` · ${lvl.emoji} ${lvl.name} · ${rank.badges.length}/${BADGES.length} badges`}
                  </>
                )}
              </div>
            </div>
            <div className="row trader-actions">
              <CopyAddress account={account} />
              <a className="small" href={addressUrl(account)} target="_blank" rel="noopener noreferrer">
                Arbiscan ↗
              </a>
            </div>
          </div>
          <div className="trader-stats">
            <div>
              <div className="trader-stat">{usd(positionsValue)}</div>
              <div className="small muted">Positions value</div>
            </div>
            <div>
              <div className="trader-stat">{usd(volume)}</div>
              <div className="small muted">Volume</div>
            </div>
            <div>
              <div className="trader-stat">{holdings.length}</div>
              <div className="small muted">Open positions</div>
            </div>
            <div>
              <div className="trader-stat">{(stats?.tradeCount ?? 0).toLocaleString()}</div>
              <div className="small muted">Trades</div>
            </div>
          </div>
        </section>
        <PnlCard days={days} unrealized={unrealized} hasPrices={holdings.every((h) => h.value !== null)} />
      </div>

      <section className="panel tight">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "positions"} className={tab === "positions" ? "on" : ""} onClick={() => setTab("positions")}>
            Positions ({holdings.length})
          </button>
          <button role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "on" : ""} onClick={() => setTab("activity")}>
            Activity
          </button>
        </div>
        {tab === "positions" ? <Positions holdings={holdings} isMe={isMe} /> : <Activity account={account} isMe={isMe} />}
      </section>
      <p className="small muted">
        Profit and loss is realized from closed trades, after trading fees; funding settles into collateral and isn't counted. Open positions are valued at the latest oracle price.
      </p>
    </div>
  );
}

/** A market's icon and name, linked to its page; the bare address for a market no longer listed. */
function MarketCell({ pair }: { pair: string }) {
  const { markets } = useRead();
  const m = markets.find((x) => x.address.toLowerCase() === pair.toLowerCase());
  if (!m) return <span className="mono small">{shortAddr(pair)}</span>;
  return (
    <Link to={`/market/${m.address}`} className="trader-market">
      <AssetIcon market={m} size={22} />
      <b>{m.label}</b>
    </Link>
  );
}

function Positions({ holdings, isMe }: { holdings: readonly Holding[]; isMe: boolean }) {
  const { shown, pager } = usePaged(holdings, PAGE);
  if (!holdings.length) return <Empty title="No open positions">{isMe ? "Open one from any market." : "This trader holds nothing right now."}</Empty>;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th className="num">Value</th>
              <th className="num">Profit &amp; loss</th>
              <th className="num hide-sm">Size</th>
              <th className="num hide-sm">Entry</th>
              <th className="num">Now</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((h) => {
              const lev = h.value !== null && h.p.collateral > 0n ? Number((h.value * 100n) / h.p.collateral) / 100 : null;
              const pnlPct = h.pnl !== null && h.p.collateral > 0n ? Number((h.pnl * 10_000n) / h.p.collateral) / 10_000 : null;
              return (
                <tr key={h.p.id}>
                  <td>
                    <span className="trader-asset">
                      <MarketCell pair={h.p.pair} />
                      <span className={`badge ${h.p.isLong ? "up" : "down"}`}>
                        {h.p.isLong ? "Long" : "Short"}
                        {lev !== null ? ` ${leverage(lev)}` : ""}
                      </span>
                    </span>
                  </td>
                  <td className="num">{h.value === null ? "–" : usd(h.value)}</td>
                  <td className="num">
                    {h.pnl === null ? (
                      "–"
                    ) : (
                      <Pnl value={h.pnl}>
                        {signedUsd(h.pnl)}
                        {pnlPct !== null && <span className="small"> ({pct(pnlPct, 1)})</span>}
                      </Pnl>
                    )}
                  </td>
                  <td className="num hide-sm">{sizeText(h.p.size)}</td>
                  <td className="num hide-sm">{price(h.p.entryPrice)}</td>
                  <td className="num">{h.now === null ? "–" : price(h.now)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pager}
    </>
  );
}

/** The account's trades, newest first, read a page at a time; each page's cursor is kept for going back. */
function Activity({ account, isMe }: { account: Address; isMe: boolean }) {
  const { readBz } = useRead();
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const after = cursors[page] ?? null;
  const rows = useAsync(async () => (readBz ? readBz.history.positionChanges({ account, first: PAGE, after }) : null), [readBz, account, after]);
  const next = rows.data?.next ?? null;
  const go = (p: number) => {
    if (p > page) {
      if (!next) return;
      setCursors((c) => [...c.slice(0, p), next]);
    }
    setPage(p);
  };
  if (rows.data === undefined || rows.data === null) {
    return rows.error ? <Empty title={explain(rows.error)} action={<button onClick={rows.reload}>Try again</button>} /> : <Loading what="Loading activity" />;
  }
  if (!rows.data.items.length && page === 0) return <Empty title="No trades yet">{isMe ? "Your trades show up here." : "This trader hasn't traded yet."}</Empty>;
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Market</th>
              <th>Time</th>
              <th>Action</th>
              <th className="num">Amount</th>
              <th className="num hide-sm">Price</th>
              <th className="num">Realized</th>
              <th className="hide-sm" />
            </tr>
          </thead>
          <tbody>
            {rows.data.items.map((c) => {
              const t = describeChange(c);
              return (
                <tr key={c.id}>
                  <td>
                    <span className="trader-asset">
                      <MarketCell pair={c.pair} />
                      <span className={`badge ${t.long ? "up" : "down"}`}>{t.long ? "Long" : "Short"}</span>
                    </span>
                  </td>
                  <td className="small" style={{ whiteSpace: "nowrap" }}>
                    {dateTime(c.timestamp)}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{t.action}</td>
                  <td className="num">{usd((t.traded * c.executionPrice) / E18)}</td>
                  <td className="num hide-sm">{price(c.executionPrice)}</td>
                  <td className="num">{c.realizedPnl === 0n ? <span className="muted">–</span> : <Pnl value={c.realizedPnl}>{signedUsd(c.realizedPnl)}</Pnl>}</td>
                  <td className="hide-sm">
                    <TxLink hash={c.transactionHash}>tx ↗</TxLink>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={page} hasNext={next !== null} onPage={go} summary={`Page ${page + 1}${rows.loading ? " · loading…" : ""}`} />
    </>
  );
}

/** Realized profit and loss over the chosen period, with its running total drawn. */
function PnlCard({ days, unrealized, hasPrices }: { days: readonly history.AccountDayData[]; unrealized: bigint; hasPrices: boolean }) {
  const [period, setPeriod] = useState<Period>("1W");
  const p = PERIODS.find((x) => x.key === period)!;
  const { total, points } = pnlOver(days, p.days);
  const tone = total > 0n ? "up" : total < 0n ? "down" : "";
  return (
    <section className="panel trader-pnl">
      <div className="spread">
        <span className={`small ${tone || "muted"}`}>{total > 0n ? "▲" : total < 0n ? "▼" : "•"} Profit / loss</span>
        <div className="trader-periods" role="tablist">
          {PERIODS.map((x) => (
            <button key={x.key} role="tab" aria-selected={x.key === period} className={`small${x.key === period ? " on" : ""}`} onClick={() => setPeriod(x.key)}>
              {x.key}
            </button>
          ))}
        </div>
      </div>
      <div className={`trader-pnl-value ${tone}`}>{signedUsd(total)}</div>
      <div className="small muted">
        {p.label}
        {unrealized !== 0n && hasPrices && (
          <>
            {" · "}
            <Pnl value={unrealized}>{signedUsd(unrealized)}</Pnl> unrealized on open positions
          </>
        )}
      </div>
      <PnlChart points={points} />
    </section>
  );
}

/** The running total as a line with a fill under it, coloured by where it ends against zero. */
function PnlChart({ points }: { points: readonly { t: number; v: bigint }[] }) {
  const W = 600;
  const H = 120;
  const ts = points.map((x) => x.t);
  const vs = points.map((x) => Number(x.v) / 1e18);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const lo = Math.min(0, ...vs);
  const hi = Math.max(0, ...vs);
  const xOf = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
  const yOf = (v: number) => (hi === lo ? H / 2 : H - 6 - ((v - lo) / (hi - lo)) * (H - 12));
  const line = points.map((x, i) => `${i ? "L" : "M"}${xOf(x.t).toFixed(1)},${yOf(vs[i]!).toFixed(1)}`).join(" ");
  const last = vs[vs.length - 1] ?? 0;
  const tone = last > 0 ? "up" : last < 0 ? "down" : "flat";
  return (
    <svg className={`trader-chart ${tone}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Running profit and loss over the period">
      <line x1={0} x2={W} y1={yOf(0)} y2={yOf(0)} className="zero" />
      <path d={`${line} L${W},${yOf(0)} L0,${yOf(0)} Z`} className="fill" />
      <path d={line} className="stroke" />
    </svg>
  );
}
