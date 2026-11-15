/**
 * The Portfolio's head: volume and fees over the period chosen in the Account panel, with the unclaimed
 * balance and a button that claims it all; the account's P&L over that period and what it holds now; and
 * a chart of daily P&L or volume. The history is the subgraph's per-day account data, one query for every
 * period; what the account holds now comes from the live account and the insurance read the Balances tab
 * shares.
 */
import { account, fromUsdcUnits, type history } from "@liberta-labs/bazaar-sdk";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import { signedUsd, usd } from "../lib/format";
import { claimFeesPart } from "../lib/jobs";
import { ytdDays } from "../lib/periods";
import { useBoard, useRead } from "../state/connection";
import { useLiveAccount } from "../state/data";
import { useInsuranceStakes } from "../state/insurance";
import { useTx } from "../state/tx";
import { PnlChart } from "./PnlChart";
import { ActionButton, Loading, Pnl, Term, Tip, useAsync } from "./ui";

const DAY = 86_400;
const PERIODS = [
  { key: "1", label: "Today" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "365", label: "1 year" },
  { key: "all", label: "All time" },
] as const;
type Period = (typeof PERIODS)[number]["key"];

/** The UTC days a period covers, today included; null for all time. */
const daysOf = (p: Period): number | null => (p === "all" ? null : p === "ytd" ? ytdDays() : Number(p));

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
  const tx = useTx();
  const stakes = useInsuranceStakes(user);
  const [period, setPeriod] = useState<Period>("30");
  const [chart, setChart] = useState<"pnl" | "volume">("pnl");
  const history = useAsync(async () => (readBz ? (await readBz.history.accountDayData(user, { from: 0, first: 1000 })).items : []), [readBz, user]);

  const now = Math.floor(Date.now() / 1000);
  const today = now - (now % DAY);
  const all = history.data ?? [];
  const since = (n: number) => all.filter((d) => d.date > today - n * DAY);
  const lifetime = sum(all);
  const span = daysOf(period);
  const inPeriod = span === null ? lifetime : sum(since(span));
  // The period as the cards name it: "Volume, 30 days", "Fees paid, year to date".
  const periodName = PERIODS.find((p) => p.key === period)!.label.toLowerCase();

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

  // Every market with something to claim, largest first. Each keeps its own balance and a claim has no
  // gasless form, so claiming them all is one wallet transaction per market, in one window.
  const owed = [...acct.snaps.values()].filter((s) => s.claimableFees > 0n).sort((a, b) => (b.claimableFees > a.claimableFees ? 1 : -1));
  const claimAll = () => {
    const n = owed.length;
    const where = n === 1 ? `on ${owed[0]!.market.label}` : `across ${n} markets`;
    void tx.run({
      title: n === 1 ? `Claim on ${owed[0]!.market.label}` : `Claim on ${n} markets`,
      summary: [
        `Send ${usd(held.claimable)} you're owed ${where} to your wallet.`,
        ...(n > 1 ? [`Each market's balance is claimed in its own transaction, so your wallet asks ${n} times.`] : []),
        "Sent from your wallet: it needs a little ETH for gas.",
      ],
      parts: owed.map((s) => claimFeesPart(s.market.address, `Claim ${usd(s.claimableFees)} on ${s.market.label}`)),
    });
  };
  const markets = held.collateral + held.unrealized;
  const total = markets + insured + held.claimable + held.wallet;

  const first = all[0]?.date ?? today;
  const chartFrom = span === null ? first : today - ((span === 1 ? 14 : span) - 1) * DAY;
  const bars = fillDays(all, chartFrom, today, chart === "pnl" ? (d) => d.realizedPnl - d.feesPaid : (d) => d.makerVolumeNotional + d.takerVolumeNotional);
  const loading = history.loading && !history.data;

  return (
    <div className="summary-grid">
      <div className="stat-stack">
        <div className="stat">
          <div className="label">Volume, {periodName}</div>
          <div className="value">{loading ? "…" : usd(inPeriod.volume)}</div>
          <div className="small muted">{loading ? "" : `${inPeriod.trades.toLocaleString()} fills${span === null ? "" : ` · lifetime ${usd(lifetime.volume)}`}`}</div>
        </div>
        <div className="stat">
          <div className="label">Fees paid, {periodName}</div>
          <div className="value">{loading ? "…" : usd(inPeriod.fees)}</div>
          <div className="small muted">{loading ? "" : `${span === null ? "" : `lifetime ${usd(lifetime.fees)}. `}Rates vary by market: each ticket shows its own.`}</div>
          <div className="spread summary-claim">
            <span className="small">
              <Term t="claimable">Unclaimed</Term> <b className="mono">{usd(held.claimable)}</b>
            </span>
            <ActionButton className="small" onClick={claimAll} disabledReason={owed.length ? null : "Nothing to claim: refunded bounties and rewards show here when a market owes you some."}>
              {owed.length > 1 ? `Claim all (${owed.length} markets)` : "Claim"}
            </ActionButton>
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="spread">
          <h3 style={{ margin: 0 }}>Account</h3>
          <select className="compact" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
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
          <span className="small muted">{period === "1" ? "last 14 days" : PERIODS.find((p) => p.key === period)?.label.toLowerCase()}, by UTC day</span>
        </div>
        {loading ? <Loading /> : !all.length ? <p className="small muted">Your daily P&L and volume show here once you trade.</p> : <PnlChart days={bars} kind={chart} />}
      </section>
    </div>
  );
}
