import { type history, type insurance, type markets, MIN_COLLATERAL_DEPOSIT, fromUsdcUnits, toNumber18 } from "@liberta-labs/bazaar-sdk";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { HistoryLag } from "../components/HistoryLag";
import { Modal } from "../components/Modal";
import { ActionButton, Empty, Loading, Pnl, StatusBadge, Term, Tip, useAsync } from "../components/ui";
import { explain } from "../lib/errors";
import { amount, dateTime, parseInput, pct, relative, signedPct, signedUsd, toInput, usd } from "../lib/format";
import { RETURN_WINDOW_SECONDS, type ReturnEstimate, estimateInsuranceReturn, sharePriceOfEvent } from "../lib/insuranceReturn";
import { forAccount, insuranceDepositPart, insuranceExecutePart, insuranceRequestPart } from "../lib/jobs";
import { CONTRACT_WALLET_REASON } from "../lib/wallet";
import { AssetIcon } from "../components/AssetIcon";
import { useBoard, useRead, useWallet } from "../state/connection";
import { useMarketSnapshots } from "../state/data";
import { useTx } from "../state/tx";

const TRADE_PAGES = 10;

/** The return estimate for one market: the window's fills, the fund now, the share price then. */
function useReturn(m: markets.MarketInfo, snap: markets.MarketSnapshot | undefined) {
  const { readBz } = useRead();
  return useAsync(async (): Promise<ReturnEstimate | null> => {
    if (!readBz || !snap) return null;
    const now = Math.floor(Date.now() / 1000);
    // On a 5-minute boundary, so everyone looking within the same 5 minutes asks the very same queries
    // and the service answers them from one cached read. It lengthens a 30-day window by 5 minutes at most.
    const from = now - (now % 300) - RETURN_WINDOW_SECONDS;
    const trades: history.Trade[] = [];
    let after: string | null = null;
    let complete = true;
    for (let i = 0; i < TRADE_PAGES; i++) {
      const p: history.Page<history.Trade> = await readBz.history.trades({ pair: m.address, from, first: 1000, after });
      trades.push(...p.items);
      if (!p.next) break;
      after = p.next;
      if (i === TRADE_PAGES - 1) complete = false;
    }
    const [nowPrice, events] = await Promise.all([
      readBz.insurance.getInsuranceSharePrice(m.address),
      readBz.history.insuranceEvents({ pair: m.address, to: from, order: "desc", first: 20 }),
    ]);
    const then = events.items.map(sharePriceOfEvent).find((x) => x !== null) ?? null;
    return estimateInsuranceReturn({ trades, fundValue: snap.insurance.freeCapital, sharePriceNow: nowPrice, sharePriceThen: then, complete });
  }, [readBz, m.address, snap?.block === undefined]);
}

function DepositDialog({ m, snap, onClose }: { m: markets.MarketInfo; snap: markets.MarketSnapshot; onClose: () => void }) {
  const { readBz } = useRead();
  const { prices } = useBoard();
  const w = useWallet();
  const tx = useTx();
  const [text, setText] = useState("");
  const [quote, setQuote] = useState<insurance.InsuranceQuote | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [walletUsdc, setWalletUsdc] = useState<bigint | null>(null);
  const value = parseInput(text);
  const spot = prices?.spot(m.address) ?? null;

  useEffect(() => {
    if (readBz && w.address) readBz.allowance.usdcBalance(w.address).then((b) => setWalletUsdc(fromUsdcUnits(b)), () => undefined);
  }, [readBz, w.address]);

  useEffect(() => {
    setQuote(null);
    setErr(null);
    if (!readBz || !value || value <= 0n) return;
    let dead = false;
    const t = setTimeout(() => {
      readBz.insurance
        .quoteInsuranceDeposit(m.address, value, spot ? { price: spot } : undefined)
        .then((q) => !dead && setQuote(q))
        .catch((e) => !dead && setErr(explain(e)));
    }, 300);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [readBz, value, m.address, spot]);

  const reason = !w.canSign
    ? CONTRACT_WALLET_REASON
    : !value || value <= 0n
      ? "Enter an amount."
      : value < MIN_COLLATERAL_DEPOSIT
        ? "The minimum deposit is 5 USDC."
        : walletUsdc !== null && value > walletUsdc
          ? `Your wallet holds ${usd(walletUsdc)}.`
          : snap.status !== "live"
            ? "Deposits are open only while the market is live."
            : tx.busy(m.address)
              ? "Your last request on this market is still landing."
              : err;

  return (
    <Modal title={`Insure ${m.label}`} onClose={onClose}>
      <div className="stack">
        <div className="callout small">
          You earn a share of this market's trading fees. If a liquidation loses more than the trader's margin, the fund pays the difference and your shares lose value. Leaving takes a request, a 13-day
          cooldown, then two steps inside a {m.continuous ? "2" : "4"}-day window.
        </div>
        <label className="field">
          Amount (USDC)
          <input className="num" inputMode="decimal" placeholder="0.00" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {walletUsdc !== null && (
          <button className="small ghost" style={{ alignSelf: "flex-start" }} onClick={() => setText(toInput(walletUsdc, 6))}>
            Max ({usd(walletUsdc)})
          </button>
        )}
        {quote && (
          <div className="kv">
            <span>Shares you'd get</span>
            <span>{amount(quote.value, 6)}</span>
            <span>Share price</span>
            <span>{quote.value > 0n ? usd((value! * 10n ** 18n) / quote.value) : "–"}</span>
          </div>
        )}
        {value !== null && value > 0n && reason && <div className="field-error">{reason}</div>}
        {!w.address ? (
          <button className="primary" onClick={w.openConnect}>
            Connect wallet to deposit
          </button>
        ) : (
        <ActionButton
          className="primary"
          disabledReason={reason}
          onClick={() => {
            onClose();
            void tx.run({
              title: `Insure ${m.label}`,
              summary: [`Deposit ${usd(value!)} into the ${m.label} insurance fund${quote ? ` for about ${amount(quote.value, 6)} shares` : ""}.`, "Shares are priced at the fund's value when the deposit lands."],
              pair: m.address,
              parts: [insuranceDepositPart(m.address, value!)],
            });
          }}
        >
          Deposit
        </ActionButton>
        )}
      </div>
    </Modal>
  );
}

const STEP_LABEL: Record<insurance.InsuranceExitStep, string> = {
  none: "No withdrawal",
  request: "Ready to request",
  cooldown: "Cooling down",
  lock: "Lock your amount",
  waitClaim: "Waiting to collect",
  claim: "Ready to collect",
  redeem: "Ready to redeem",
  expired: "Window closed",
  blocked: "On hold",
};

function MyPosition({ p, m, snap }: { p: history.InsuranceProvider; m: markets.MarketInfo; snap: markets.MarketSnapshot | undefined }) {
  const { readBz } = useRead();
  const { prices } = useBoard();
  const w = useWallet();
  const tx = useTx();
  const [n, setN] = useState(0);
  const [reqText, setReqText] = useState("");
  const spot = prices?.spot(m.address) ?? null;
  const data = useAsync(async () => {
    if (!readBz || !w.address) return null;
    const shares = await readBz.insurance.insuranceShares(m.address, w.address);
    const [value, sharePrice, plan] = await Promise.all([
      spot && shares > 0n ? readBz.insurance.quoteInsuranceWithdrawal(m.address, shares, { price: spot }).then((q) => q.value) : readBz.insurance.getInsuranceDepositValue(m.address, w.address),
      readBz.insurance.getInsuranceSharePrice(m.address),
      readBz.insurance.insuranceExitPlan(m.address, w.address),
    ]);
    return { shares, value, sharePrice, plan };
  }, [readBz, w.address, m.address, n, spot === null]);
  const d = data.data;
  if (!d) return <tr><td colSpan={6}><Loading /></td></tr>;
  if (d.shares === 0n && d.plan.step === "none") return null;
  const gain = d.value + p.withdrawn - p.deposited;
  const plan = d.plan;
  const busy = tx.busy(m.address);
  const free = plan.shares - plan.lockedForVoting;
  const reqShares = parseInput(reqText) ?? free;
  const reload = () => setN((x) => x + 1);

  let action: React.ReactNode = null;
  if (plan.nextAction === "requestInsuranceWithdrawal" && plan.step !== "blocked") {
    action = (
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input className="num" style={{ width: 110 }} placeholder={amount(free, 4)} value={reqText} onChange={(e) => setReqText(e.target.value)} aria-label="Shares to withdraw" />
        <ActionButton
          className="small"
          disabledReason={busy ? "Your last request on this market is still landing." : reqShares <= 0n || reqShares > free ? `You can request up to ${amount(free, 6)} shares.` : null}
          onClick={() =>
            void tx.run({
              title: "Request insurance withdrawal",
              summary: [
                `Request to withdraw ${amount(reqShares, 6)} shares of the ${m.label} fund.`,
                "This starts a 13-day cooldown and moves no money yet. Then lock your amount and collect it inside the window.",
              ],
              pair: m.address,
              parts: [forAccount(insuranceRequestPart(m.address, reqShares), w.canSign)],
              onDone: reload,
            })
          }
        >
          Request
        </ActionButton>
      </div>
    );
  } else if (plan.nextAction === "executeInsuranceWithdrawal" && (plan.step === "lock" || plan.step === "claim" || plan.step === "redeem")) {
    const label = plan.step === "lock" ? "Lock amount" : "Collect";
    action = (
      <ActionButton
        className="small primary"
        disabledReason={!w.canSign ? CONTRACT_WALLET_REASON : busy ? "Your last request on this market is still landing." : null}
        onClick={() =>
          void tx.run({
            title: label,
            summary: [
              plan.step === "lock"
                ? "Lock in what your requested shares are worth now. It pays nothing yet; collect it 5 minutes later, inside the window."
                : `Collect your withdrawal${plan.payoutEstimate ? `: about ${usd(plan.payoutEstimate)}` : ""}.`,
            ],
            pair: m.address,
            parts: [insuranceExecutePart(m.address, label)],
            onDone: reload,
          })
        }
      >
        {label}
      </ActionButton>
    );
  }

  return (
    <tr>
      <td data-main="">
        <span className="market-name">
          <AssetIcon market={m} size={20} />
          <Link to={`/market/${m.address}`}>{m.label}</Link>
        </span>{" "}
        {snap && snap.status !== "live" && <StatusBadge status={snap.status} />}
      </td>
      <td data-label="Shares" className="num">
        {amount(d.shares, 4)}
        <div className="small muted">at {usd(d.sharePrice)} each</div>
      </td>
      <td data-label="Value now" className="num">{usd(d.value)}</td>
      <td data-label="You paid" className="num">
        {usd(p.deposited)}
        {p.withdrawn > 0n && <div className="small muted">withdrew {usd(p.withdrawn)}</div>}
      </td>
      <td data-label="Gain / loss" className="num">
        <Pnl value={gain}>{signedUsd(gain)}</Pnl>
      </td>
      <td data-label="Leaving the fund">
        <div className="small">
          <b>{STEP_LABEL[plan.step]}</b>
          {plan.nextCallAt !== null && plan.nextCallAt > plan.now && <span className="muted"> · next step {dateTime(plan.nextCallAt)} ({relative(plan.nextCallAt, plan.now)})</span>}
          {plan.nextCallBy !== null && <span className="muted"> · by {dateTime(plan.nextCallBy)}</span>}
        </div>
        <div className="small muted">{plan.message}</div>
        {plan.notes.map((x, i) => (
          <div key={i} className="small muted">
            {x}
          </div>
        ))}
        <div style={{ marginTop: 6 }}>{action}</div>
      </td>
    </tr>
  );
}

function MarketRow({ m, snap, onInsure }: { m: markets.MarketInfo; snap: markets.MarketSnapshot | undefined; onInsure: () => void }) {
  const { readBz } = useRead();
  const { prices } = useBoard();
  const est = useReturn(m, snap);
  const spot = prices?.spot(m.address) ?? null;
  const budget = useAsync(async () => (readBz && spot ? readBz.insurance.getInsuranceWithdrawalBudget(m.address, { price: spot }) : null), [readBz, m.address, spot === null]);
  if (!snap) return null;
  const oi = snap.openInterest.longNotional + snap.openInterest.shortNotional;
  const target = (oi * snap.insurance.targetRatioBp) / 10_000n;
  const fill = target > 0n ? Math.min(1, toNumber18(snap.insurance.fund) / toNumber18(target)) : 1;
  const e = est.data;
  return (
    <tr>
      <td data-main="">
        <span className="market-name">
          <AssetIcon market={m} size={20} />
          <Link to={`/market/${m.address}`}>{m.label}</Link>
        </span>
      </td>
      <td data-label="Fund vs target" className="num">
        <div style={{ minWidth: 120 }}>
          {usd(snap.insurance.fund)}
          <div className="progress" style={{ marginTop: 4 }} title={`${pct(fill, 0)} of target`}>
            <div style={{ width: `${fill * 100}%` }} />
          </div>
          <div className="small muted">target {usd(target)}</div>
        </div>
      </td>
      <td data-label="Withdrawal budget" className="num hide-sm">{budget.data ? (budget.data.unlimited ? "no limit" : usd(budget.data.remaining)) : "–"}</td>
      <td data-label="Est. yearly return" className="num">
        {est.loading && !e ? (
          "…"
        ) : e?.feeApr === null || !e ? (
          "–"
        ) : (
          <Tip text={`From the insurance share of the last 30 days' fees (${usd(e.insuranceFees)}) on a ${usd(snap.insurance.freeCapital)} fund, annualized. Past performance, not a promise.${e.complete ? "" : " Not every fill could be read: a lower bound."}`}>
            <span className="term">{pct(e.feeApr)}</span>
          </Tip>
        )}
      </td>
      <td data-label="Share price, 30 days" className={`num hide-sm ${e?.sharePriceChange && e.sharePriceChange < 0 ? "down" : ""}`}>{e ? signedPct(e.sharePriceChange) : "–"}</td>
      <td data-actions="" className="right">
        <button className="small primary" disabled={snap.status !== "live"} onClick={onInsure}>
          Insure
        </button>
      </td>
    </tr>
  );
}

export function EarnPage() {
  const { readBz, markets: list } = useRead();
  const w = useWallet();
  const { snaps } = useMarketSnapshots();
  const [insure, setInsure] = useState<markets.MarketInfo | null>(null);
  const providers = useAsync(async () => {
    if (!readBz || !w.address) return [];
    return (await readBz.history.insuranceProviders({ account: w.address, first: 100 })).items;
  }, [readBz, w.address]);
  const byPair = useMemo(() => new Map(list.map((m) => [m.address.toLowerCase(), m])), [list]);
  const mine = (providers.data ?? []).filter((p) => p.shares > 0n || p.requestedShares > 0n);
  const live = list.filter((m) => snaps.get(m.address)?.status === "live");

  return (
    <div className="stack">
      <div className="hero">
        <h1>Earn by insuring markets</h1>
        <p className="muted">
          Every market has its own <Term t="insurance">insurance fund</Term>. Insurers earn the fund's share of that market's trading fees, and cover losses when a liquidation can't pay its
          way. Estimates below are past performance, not a promise: liquidation losses can reduce share value.
        </p>
      </div>
      <HistoryLag />
      {w.address && (
        <section className="panel tight">
          <div className="panel-head">
            <h2>My insurance</h2>
          </div>
          {providers.loading && !providers.data ? (
            <Loading />
          ) : !mine.length ? (
            <Empty title="You don't insure any market yet">Pick a market below and deposit at least 5 USDC.</Empty>
          ) : (
            <div className="table-wrap">
              <table className="rtable">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th className="num">
                      <Term t="insuranceShare">Shares</Term>
                    </th>
                    <th className="num">Value now</th>
                    <th className="num">You paid</th>
                    <th className="num">Gain / loss</th>
                    <th>Leaving the fund</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.map((p) => {
                    const m = byPair.get(p.pair.toLowerCase());
                    return m ? <MyPosition key={p.id} p={p} m={m} snap={snaps.get(m.address)} /> : null;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <section className="panel tight">
        <div className="panel-head">
          <h2>Markets to insure</h2>
        </div>
        {!live.length ? (
          <Empty title={list.length ? "No live markets right now" : "Loading markets…"} />
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead>
                <tr>
                  <th>Market</th>
                  <th className="num">
                    <Term t="coverage">Fund vs target</Term>
                  </th>
                  <th className="num hide-sm">
                    <Term t="budget">Withdrawal budget</Term>
                  </th>
                  <th className="num">
                    <Tip text="The fund's share of the last 30 days of fees over its value, annualized. Past performance, not a promise.">
                      <span className="term">Est. yearly return</span>
                    </Tip>
                  </th>
                  <th className="num hide-sm">Share price, 30 days</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {live.map((m) => (
                  <MarketRow key={m.address} m={m} snap={snaps.get(m.address)} onInsure={() => setInsure(m)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {insure && snaps.get(insure.address) && <DepositDialog m={insure} snap={snaps.get(insure.address)!} onClose={() => setInsure(null)} />}
    </div>
  );
}
