/**
 * The Portfolio's head: volume and fees over two weeks, the account over a chosen period with what it
 * holds now, and a chart of daily P&L or volume. The history is the subgraph's per-day account data, one
 * query for every period; what the account holds now comes from the live account and the insurance read
 * the Balances tab shares.
 */
import { account, fromUsdcUnits, type history } from "@liberta-labs/bazaar-sdk";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import { signedUsd, usd } from "../lib/format";
import { useBoard, useRead } from "../state/connection";
import { useLiveAccount } from "../state/data";
import { useInsuranceStakes } from "../state/insurance";
import { PnlChart } from "./PnlChart";
import { Loading, Pnl, Term, Tip, useAsync } from "./ui";

const DAY = 86_400;
type Period = 1 | 7 | 30 | 90 | 0;
const PERIODS: { days: Period; label: string }[] = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 0, label: "All time" },
];

interface Sums {
  readonly volume: bigint;
  readonly fees: bigint;
  readonly pnl: bigint;
  readonly trades: number;
}

function sum(days: readonly history.AccountDayData[]): Sums {
  return days.reduce((s, d) => ({ volume: s.volume + d.makerVolumeNotional + d.takerVolumeNotional, fees: s.fees + d.feesPaid, pnl: s.pnl + d.realizedPnl, trades: s.trades + d.tradeCount }), {
    volume: 0n,
    fees: 0n,
    pnl: 0n,
    trades: 0,
  });
}

/** Every UTC day from `from` to today, with the account's figure that day or zero. */
function fillDays(days: readonly history.AccountDayData[], from: number, today: number, value: (d: history.AccountDayData) => bigint) {
  const by = new Map(days.map((d) => [d.date, value(d)]));
  const out: { date: number; pnl: bigint }[] = [];
  for (let t = from; t <= today; t += DAY) out.push({ date: t, pnl: by.get(t) ?? 0n });
  return out;
}

export function PortfolioSummary({ user }: { user: Address }) {
  const { readBz } = useRead();
  const { prices } = useBoard();
  const acct = useLiveAccount();
  const stakes = useInsuranceStakes(user);
  const [period, setPeriod] = useState<Period>(30);
  const [chart, setChart] = useState<"pnl" | "volume">("pnl");
  const history = useAsync(async () => (readBz ? (await readBz.history.accountDayData(user, { from: 0, first: 1000 })).items : []), [readBz, user]);

  const now = Math.floor(Date.now() / 1000);
  const today = now - (now % DAY);
  const all = history.data ?? [];
  const since = (n: number) => all.filter((d) => d.date > today - n * DAY);
  const fortnight = sum(since(14));
  const lifetime = sum(all);
  const inPeriod = period === 0 ? lifetime : sum(since(period));

  // What the account holds now.
  const held = useMemo(() => {
    let collateral = 0n;
    let unrealized = 0n;
    let funding = 0n;
    let claimable = 0n;
    let wallet = 0n;
    for (const s of acct.snaps.values()) {
      wallet = fromUsdcUnits(s.wallet.usdcBalance);
      collateral += s.position.collateral;
      claimable += s.claimableFees;
      if (!s.hasPosition) continue;
      const live = prices?.price(s.market.address);
      const h = live ? account.accountHealth(s, live) : s.health;
      unrealized += h?.totalPnl ?? 0n;
      funding += h?.fundingPnl ?? 0n;
    }
    return { collateral, unrealized, funding, claimable, wallet };
  }, [acct.snaps, prices]);
  const insured = (stakes.data ?? []).reduce((t, k) => t + k.value, 0n);
  const markets = held.collateral + held.unrealized;
  const total = markets + insured + held.claimable + held.wallet;

  const first = all[0]?.date ?? today;
  const chartFrom = period === 0 ? first : today - ((period === 1 ? 14 : period) - 1) * DAY;
  const bars = fillDays(all, chartFrom, today, chart === "pnl" ? (d) => d.realizedPnl - d.feesPaid : (d) => d.makerVolumeNotional + d.takerVolumeNotional);
  const loading = history.loading && !history.data;

  return (
    <div className="summary-grid">
      <div className="stat-stack">
        <div className="stat">
          <div className="label">14-day volume</div>
          <div className="value">{loading ? "…" : usd(fortnight.volume)}</div>
          <div className="small muted">{loading ? "" : `${fortnight.trades} fills · lifetime ${usd(lifetime.volume)}`}</div>
        </div>
        <div className="stat">
          <div className="label">14-day fees paid</div>
          <div className="value">{loading ? "…" : usd(fortnight.fees)}</div>
          <div className="small muted">{loading ? "" : `lifetime ${usd(lifetime.fees)}. Rates vary by market: each ticket shows its own.`}</div>
        </div>
      </div>

      <section className="panel">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Account</h3>
          <select className="compact" value={period} onChange={(e) => setPeriod(Number(e.target.value) as Period)} aria-label="Period">
            {PERIODS.map((p) => (
              <option key={p.days} value={p.days}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="kv" style={{ marginTop: 10 }}>
          <span>
            <Tip text="Profit and loss from reducing and closing positions, less fees, by UTC day. Funding is under Funding history.">
              <span className="term">P&L after fees</span>
            </Tip>
          </span>
          <span>{loading ? "…" : <Pnl value={inPeriod.pnl - inPeriod.fees}>{signedUsd(inPeriod.pnl - inPeriod.fees)}</Pnl>}</span>
          <span>Volume</span>
          <span>{loading ? "…" : usd(inPeriod.volume)}</span>
          <span>Fees</span>
          <span>{loading ? "…" : usd(inPeriod.fees)}</span>
        </div>
        <div className="kv summary-equity">
          <span>
            <Term t="equity">Equity now</Term>
          </span>
          <span>
            <b>{usd(total)}</b>
          </span>
          <span className="indent">Markets</span>
          <span>{usd(markets)}</span>
          <span className="indent2">
            <Term t="unrealized">Unrealized P&L</Term>
          </span>
          <span>
            <Pnl value={held.unrealized}>{signedUsd(held.unrealized)}</Pnl>
          </span>
          <span className="indent2">
            <Term t="fundingPnl">of which funding</Term>
          </span>
          <span>
            <Pnl value={held.funding}>{signedUsd(held.funding)}</Pnl>
          </span>
          <span className="indent">
            <Term t="insurance">Insurance</Term>
          </span>
          <span>{stakes.loading && !stakes.data ? "…" : usd(insured)}</span>
          <span className="indent">
            <Term t="claimable">Claimable</Term>
          </span>
          <span>{usd(held.claimable)}</span>
          <span className="indent">Wallet USDC</span>
          <span>{usd(held.wallet)}</span>
        </div>
      </section>

      <section className="panel">
        <div className="spread">
          <div className="seg" role="radiogroup" aria-label="Chart">
            <button className={chart === "pnl" ? "on" : ""} onClick={() => setChart("pnl")} aria-pressed={chart === "pnl"}>
              P&L after fees
            </button>
            <button className={chart === "volume" ? "on" : ""} onClick={() => setChart("volume")} aria-pressed={chart === "volume"}>
              Volume
            </button>
          </div>
          <span className="small muted">{period === 1 ? "last 14 days" : PERIODS.find((p) => p.days === period)?.label.toLowerCase()}, by UTC day</span>
        </div>
        {loading ? <Loading /> : !all.length ? <p className="small muted">Your daily P&L and volume show here once you trade.</p> : <PnlChart days={bars} kind={chart} />}
      </section>
    </div>
  );
}
