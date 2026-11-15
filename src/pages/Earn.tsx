import { type Bazaar, type history, type insurance, type markets, MIN_COLLATERAL_DEPOSIT, fromUsdcUnits, toNumber18 } from "@liberta-labs/bazaar-sdk";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { HistoryLag } from "../components/HistoryLag";
import { MarketFilterChips, NoMarketMatch, matchesSearch, useMarketFilter } from "../components/MarketFilters";
import { Modal } from "../components/Modal";
import { StarButton } from "../components/StarButton";
import { ActionButton, Empty, Loading, Pnl, StatusBadge, Term, Tip, useAsync } from "../components/ui";
import { explain } from "../lib/errors";
import { amount, dateTime, parseInput, pct, relative, signedPct, signedUsd, toInput, usd } from "../lib/format";
import { EXIT_STEPS, exitDue, exitStage } from "../lib/insuranceExit";
import { RETURN_WINDOW_SECONDS, type ReturnEstimate, estimateInsuranceReturn, returnWindowSeconds, sharePriceOfEvent, windowText } from "../lib/insuranceReturn";
import { forAccount, insuranceDepositPart, insuranceExecutePart, insuranceRequestPart } from "../lib/jobs";
import { openInterestNotional } from "../lib/openInterest";
import { CONTRACT_WALLET_REASON } from "../lib/wallet";
import { AssetIcon } from "../components/AssetIcon";
import { useBoard, useRead, useWallet } from "../state/connection";
import { useMarketSnapshots } from "../state/data";
import { useSort } from "../state/sort";
import { useTx } from "../state/tx";

const TRADE_PAGES = 10;
/** The protocol docs' page on the insurance fund. */
const INSURANCE_DOCS = "https://docs.bazaar.finance/protocol/insurance.html";

type Pair = markets.MarketInfo["address"];
const keyOf = (a: string) => a.toLowerCase();

/** What a market's return estimate reads from history: the window's fills and the share price then and now. */
interface ReturnInputs {
  readonly trades: readonly history.Trade[];
  readonly sharePriceNow: bigint;
  readonly sharePriceThen: bigint | null;
  readonly complete: boolean;
  /** What the fees are annualized over: 30 days, or the fund's life when it is younger. */
  readonly windowSeconds: number;
}

async function readReturnInputs(bz: Bazaar, pair: Pair): Promise<ReturnInputs> {
  const now = Math.floor(Date.now() / 1000);
  // On a 5-minute boundary, so everyone looking within the same 5 minutes asks the very same queries
  // and the service answers them from one cached read. It lengthens a 30-day window by 5 minutes at most.
  const from = now - (now % 300) - RETURN_WINDOW_SECONDS;
  const trades: history.Trade[] = [];
  let after: string | null = null;
  let complete = true;
  for (let i = 0; i < TRADE_PAGES; i++) {
    const p: history.Page<history.Trade> = await bz.history.trades({ pair, from, first: 1000, after });
    trades.push(...p.items);
    if (!p.next) break;
    after = p.next;
    if (i === TRADE_PAGES - 1) complete = false;
  }
  const [sharePriceNow, events, firstEvent] = await Promise.all([
    bz.insurance.getInsuranceSharePrice(pair),
    bz.history.insuranceEvents({ pair, to: from, order: "desc", first: 20 }),
    // The fund's first event, at the market's listing: a younger fund's fees are annualized over its own life.
    bz.history.insuranceEvents({ pair, order: "asc", first: 1 }),
  ]);
  const sharePriceThen = events.items.map(sharePriceOfEvent).find((x) => x !== null) ?? null;
  const windowSeconds = returnWindowSeconds(now, firstEvent.items[0]?.timestamp ?? null);
  return { trades, sharePriceNow, sharePriceThen, complete, windowSeconds };
}

/**
 * Each market's return inputs, read once per market as markets appear in the table, each on its own so
 * a slow market holds no other back. A market missing from the map is still being read; null means its
 * read failed.
 */
function useReturnInputs(pairs: readonly Pair[]): ReadonlyMap<string, ReturnInputs | null> {
  const { readBz } = useRead();
  const [got, setGot] = useState<ReadonlyMap<string, ReturnInputs | null>>(() => new Map());
  const asked = useRef(new Set<string>());
  const gen = useRef(0);
  useEffect(() => {
    gen.current += 1;
    asked.current = new Set();
    setGot(new Map());
  }, [readBz]);
  const pairsKey = pairs.map(keyOf).join(",");
  useEffect(() => {
    if (!readBz) return;
    const g = gen.current;
    for (const p of pairs) {
      const k = keyOf(p);
      if (asked.current.has(k)) continue;
      asked.current.add(k);
      readReturnInputs(readBz, p).then(
        (r) => g === gen.current && setGot((m) => new Map(m).set(k, r)),
        (e) => {
          console.warn("insurance return", p, e);
          if (g === gen.current) setGot((m) => new Map(m).set(k, null));
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readBz, pairsKey]);
  return got;
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
            Connect to deposit
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

/** One holding as the chain has it now. */
interface Holding {
  readonly shares: bigint;
  readonly value: bigint;
  readonly sharePrice: bigint;
  readonly plan: insurance.InsuranceExitPlan;
}

/** Where a withdrawal stands, in a word or two, for the collapsed row. Nothing while none is under way. */
function ExitPill({ plan }: { plan: insurance.InsuranceExitPlan }) {
  const at = plan.nextCallAt !== null && plan.nextCallAt > plan.now ? ` ${relative(plan.nextCallAt, plan.now)}` : "";
  switch (plan.step) {
    case "cooldown":
      return <span className="badge">Withdrawing · lock{at}</span>;
    case "lock":
      return <span className="badge warn">Lock your withdrawal</span>;
    case "waitClaim":
      return <span className="badge">Withdrawing · collect{at}</span>;
    case "claim":
      return <span className="badge warn">Ready to collect</span>;
    case "redeem":
      return <span className="badge warn">Ready to redeem</span>;
    case "expired":
      return <span className="badge bad">Withdrawal window closed</span>;
    case "blocked":
      return <span className="badge">Withdrawals on hold</span>;
    default:
      return null;
  }
}

/** The way out of a fund, step by step, with the one in hand marked. */
function ExitSteps({ plan, continuous }: { plan: insurance.InsuranceExitPlan; continuous: boolean }) {
  const stage = exitStage(plan);
  if (stage === null) return null;
  return (
    <>
      <ol className="exit-steps" aria-label="Steps to leave the fund">
        {EXIT_STEPS.map((label, i) => (
          <li key={label} className={i < stage ? "done" : i === stage ? "now" : undefined} aria-current={i === stage ? "step" : undefined}>
            <span className="exit-dot">{i < stage ? "✓" : i + 1}</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <div className="small muted">
        A request moves no money. After a 13-day cooldown, lock your amount, then collect it 5 minutes later, both inside a {continuous ? "2" : "4"}-day window.
      </div>
    </>
  );
}

/** A holding opened up: the position in full, and the way out with the next call to make. */
function HoldingDetail({ m, p, d, onChanged }: { m: markets.MarketInfo; p: history.InsuranceProvider; d: Holding; onChanged: () => void }) {
  const w = useWallet();
  const tx = useTx();
  const [reqText, setReqText] = useState("");
  const plan = d.plan;
  const gain = d.value + p.withdrawn - p.deposited;
  const busy = tx.busy(m.address);
  const free = plan.shares - plan.lockedForVoting;
  const reqShares = parseInput(reqText) ?? free;

  let action: ReactNode = null;
  if (plan.nextAction === "requestInsuranceWithdrawal" && plan.step !== "blocked") {
    action = (
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <input className="num" style={{ width: 130 }} placeholder={amount(free, 4)} value={reqText} onChange={(e) => setReqText(e.target.value)} aria-label="Shares to withdraw" />
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
              onDone: onChanged,
            })
          }
        >
          Request withdrawal
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
            onDone: onChanged,
          })
        }
      >
        {label}
        {plan.step !== "lock" && plan.payoutEstimate ? ` ${usd(plan.payoutEstimate)}` : ""}
      </ActionButton>
    );
  }

  return (
    <div className="fund-detail">
      <div>
        <h4>Your position</h4>
        <div className="kv">
          <span>
            <Term t="insuranceShare">Shares</Term>
          </span>
          <span>{amount(d.shares, 4)}</span>
          <span>Share price</span>
          <span>{usd(d.sharePrice)}</span>
          <span>Value now</span>
          <span>{usd(d.value)}</span>
          <span>You paid</span>
          <span>{usd(p.deposited)}</span>
          {p.withdrawn > 0n && (
            <>
              <span>Withdrawn</span>
              <span>{usd(p.withdrawn)}</span>
            </>
          )}
          <span>Gain / loss</span>
          <span>
            <Pnl value={gain}>{signedUsd(gain)}</Pnl>
          </span>
          {plan.lockedForVoting > 0n && (
            <>
              <span>Committed to a vote</span>
              <span>{amount(plan.lockedForVoting, 4)} shares</span>
            </>
          )}
        </div>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <h4>Withdraw</h4>
        <ExitSteps plan={plan} continuous={m.continuous} />
        <div>
          <div className="small">
            <b>{STEP_LABEL[plan.step]}</b>
            {plan.requestedShares > 0n && plan.step !== "request" && plan.step !== "expired" && <span className="muted"> · {amount(plan.requestedShares, 4)} shares requested</span>}
            {plan.nextCallAt !== null && plan.nextCallAt > plan.now && <span className="muted"> · next step {dateTime(plan.nextCallAt)} ({relative(plan.nextCallAt, plan.now)})</span>}
            {plan.nextCallBy !== null && <span className="muted"> · by {dateTime(plan.nextCallBy)}</span>}
          </div>
          <div className="small muted">{plan.message}</div>
          {plan.notes.map((x, i) => (
            <div key={i} className="small muted">
              {x}
            </div>
          ))}
        </div>
        {action}
      </div>
    </div>
  );
}

/**
 * One market's fund. A market you insure shows what your stake is worth and opens, on a click, into
 * your position and the way out of the fund; it opens by itself when a withdrawal step is due.
 */
type Budget = Awaited<ReturnType<Bazaar["insurance"]["getInsuranceWithdrawalBudget"]>>;

/** One holding as the chain has it now; null when history still lists one the chain no longer holds. */
async function readHolding(bz: Bazaar, pair: Pair, user: Pair, spot: bigint | null): Promise<Holding | null> {
  const shares = await bz.insurance.insuranceShares(pair, user);
  const [value, sharePrice, plan] = await Promise.all([
    spot && shares > 0n ? bz.insurance.quoteInsuranceWithdrawal(pair, shares, { price: spot }).then((q) => q.value) : bz.insurance.getInsuranceDepositValue(pair, user),
    bz.insurance.getInsuranceSharePrice(pair),
    bz.insurance.insuranceExitPlan(pair, user),
  ]);
  if (shares === 0n && plan.step === "none") return null;
  return { shares, value, sharePrice, plan };
}

function FundRow({
  m,
  snap,
  est,
  provider,
  budget,
  holding,
  stakeColumn,
  cols,
  onInsure,
  onChanged,
}: {
  m: markets.MarketInfo;
  snap: markets.MarketSnapshot | undefined;
  /** Undefined while reading, null when it could not be read. */
  est: ReturnEstimate | null | undefined;
  provider: history.InsuranceProvider | undefined;
  budget: Budget | null | undefined;
  /** Undefined while reading. */
  holding: Holding | null | undefined;
  stakeColumn: boolean;
  cols: number;
  onInsure: () => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<boolean | null>(null);
  const d = holding ?? undefined;
  if (!snap) return null;

  const held = !!provider && !!d;
  const expanded = held && (open ?? exitDue(d.plan.step));
  const toggle = () => setOpen(!expanded);
  const gain = d && provider ? d.value + provider.withdrawn - provider.deposited : 0n;
  const oi = openInterestNotional(snap);
  const target = (oi * snap.insurance.targetRatioBp) / 10_000n;
  const fill = target > 0n ? Math.min(1, toNumber18(snap.insurance.fund) / toNumber18(target)) : 1;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <Fragment>
      <tr className={held ? `clickable${expanded ? " open" : ""}` : undefined} onClick={held ? toggle : undefined}>
        <td data-main="">
          <span className="market-name">
            {held ? (
              <button
                className={`chev${expanded ? " on" : ""}`}
                onClick={(e) => {
                  stop(e);
                  toggle();
                }}
                aria-expanded={expanded}
                aria-label={`${expanded ? "Hide" : "Show"} your ${m.label} position and withdrawal`}
              >
                ›
              </button>
            ) : (
              stakeColumn && <span className="chev-space" />
            )}
            <AssetIcon market={m} size={20} />
            <Link to={`/market/${m.address}`} onClick={stop}>
              {m.label}
            </Link>
          </span>{" "}
          {snap.status !== "live" && <StatusBadge status={snap.status} />} {d && <ExitPill plan={d.plan} />}
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
        <td data-label="Withdrawal budget" className="num hide-sm">
          {budget ? (budget.unlimited ? "no limit" : usd(budget.remaining)) : "–"}
        </td>
        <td data-label="Est. yearly return" className="num">
          {est === undefined ? (
            "…"
          ) : est === null || est.feeApr === null ? (
            "–"
          ) : (
            <Tip text={`The fund's ${usd(est.insuranceFees)} share of ${windowText(est.windowSeconds)} on ${usd(snap.insurance.freeCapital)}, annualized. Past results, not a promise.${est.complete ? "" : " A lower bound: some fills couldn't be read."}`}>
              <span className="term">{pct(est.feeApr)}</span>
            </Tip>
          )}
        </td>
        <td data-label="Share price, 30 days" className={`num hide-sm ${est?.sharePriceChange && est.sharePriceChange < 0 ? "down" : ""}`}>
          {est ? signedPct(est.sharePriceChange) : "–"}
        </td>
        {stakeColumn && (
          <td data-label="Your stake" className={`num${provider ? "" : " no-stake"}`}>
            {!provider ? (
              <span className="muted">–</span>
            ) : !d ? (
              holding === undefined ? "…" : <span className="muted">–</span>
            ) : (
              <span>
                {usd(d.value)}
                <div className="small">
                  <Pnl value={gain}>{signedUsd(gain)}</Pnl>
                </div>
              </span>
            )}
          </td>
        )}
        <td data-actions="" className="right">
          <button className={`small${held ? "" : " primary"}`} disabled={snap.status !== "live"} onClick={(e) => (stop(e), onInsure())}>
            {held ? "Add more" : "Insure"}
          </button>
        </td>
        <td className="star-col">
          <StarButton market={m} list="earn" />
        </td>
      </tr>
      {expanded && provider && d && (
        <tr className="detail-row">
          <td colSpan={cols} data-detail="">
            <HoldingDetail m={m} p={provider} d={d} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function EarnPage() {
  const { readBz, markets: list } = useRead();
  const w = useWallet();
  const { snaps } = useMarketSnapshots();
  const [insure, setInsure] = useState<markets.MarketInfo | null>(null);
  const [q, setQ] = useState("");
  const providers = useAsync(async () => {
    if (!readBz || !w.address) return [];
    return (await readBz.history.insuranceProviders({ account: w.address, first: 100 })).items;
  }, [readBz, w.address]);

  // Your holdings by market: shares in the fund, or a withdrawal under way.
  const mine = useMemo(() => new Map((providers.data ?? []).filter((p) => p.shares > 0n || p.requestedShares > 0n).map((p) => [keyOf(p.pair), p])), [providers.data]);
  // Every live market, and any other you still hold (one ending or ended, to withdraw from).
  const rows = list.filter((m) => snaps.get(m.address)?.status === "live" || mine.has(keyOf(m.address)));
  const inputs = useReturnInputs(rows.map((m) => m.address));

  // Estimates against each fund's value now; worked out again only when a fund's value moves.
  const fundsKey = rows.map((m) => `${m.address}:${snaps.get(m.address)?.insurance.freeCapital ?? ""}`).join(",");
  const estimates = useMemo(() => {
    const out = new Map<string, ReturnEstimate | null>();
    for (const m of rows) {
      const r = inputs.get(keyOf(m.address));
      const snap = snaps.get(m.address);
      if (r === undefined || !snap) continue;
      out.set(
        keyOf(m.address),
        r && estimateInsuranceReturn({ trades: r.trades, fundValue: snap.insurance.freeCapital, windowSeconds: r.windowSeconds, sharePriceNow: r.sharePriceNow, sharePriceThen: r.sharePriceThen, complete: r.complete }),
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, fundsKey]);

  // Your funds first, then the best estimated return. Ordered once every estimate is in, and not again
  // as fund values drift, so a row never moves under the pointer.
  const allIn = rows.every((m) => inputs.has(keyOf(m.address)));
  const estimatesRef = useRef(estimates);
  estimatesRef.current = estimates;
  const rowsKey = rows.map((m) => m.address).join(",");
  const mineKey = [...mine.keys()].join(",");
  const ordered = useMemo(() => {
    const apr = (m: markets.MarketInfo) => estimatesRef.current.get(keyOf(m.address))?.feeApr ?? -1;
    const held = (m: markets.MarketInfo) => (mine.has(keyOf(m.address)) ? 1 : 0);
    return [...rows].sort((a, b) => held(b) - held(a) || (allIn ? apr(b) - apr(a) : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsKey, mineKey, allIn]);

  // Each fund's withdrawal budget and your holdings, read here rather than in the rows so the table can
  // sort by them. A holding is read again after you act on it.
  const { prices } = useBoard();
  const pricesReady = prices !== null;
  const budgets = useAsync(async () => {
    const out = new Map<string, Budget | null>();
    if (!readBz || !prices) return out;
    await Promise.all(
      rows.map(async (m) => {
        const spot = prices.spot(m.address);
        out.set(keyOf(m.address), spot ? await readBz.insurance.getInsuranceWithdrawalBudget(m.address, { price: spot }).catch(() => null) : null);
      }),
    );
    return out;
  }, [readBz, rowsKey, pricesReady]);
  const [reads, setReads] = useState(0);
  const holdings = useAsync(async () => {
    const out = new Map<string, Holding | null>();
    const user = w.address;
    if (!readBz || !user) return out;
    await Promise.all(
      [...mine.values()].map(async (p) => {
        out.set(keyOf(p.pair), await readHolding(readBz, p.pair, user, prices?.spot(p.pair) ?? null).catch(() => null));
      }),
    );
    return out;
  }, [readBz, w.address, mineKey, reads, pricesReady]);

  // A click on a column's header sorts by it; with no column picked, your funds come first as above.
  const { sorted, th, sorting } = useSort(ordered, {
    market: (m) => m.label,
    fund: (m) => snaps.get(m.address)?.insurance.fund,
    budget: (m) => {
      const b = budgets.data?.get(keyOf(m.address));
      return b ? (b.unlimited ? Number.POSITIVE_INFINITY : b.remaining) : null;
    },
    return: (m) => estimates.get(keyOf(m.address))?.feeApr,
    sharePrice: (m) => estimates.get(keyOf(m.address))?.sharePriceChange,
    stake: (m) => holdings.data?.get(keyOf(m.address))?.value,
  });

  // The same filters and search as the markets page, over the funds listed here, with a watchlist of
  // its own (the funds you follow, apart from the markets you trade); the filter picked is kept apart
  // from that page's too. Applied after the sort, so the reads above cover every fund.
  const show = useMarketFilter(rows, "bazaar.earnFilter", "earn");
  const needle = q.trim().toLowerCase();
  const shown = sorted.filter((m) => show.inFilter(m) && matchesSearch(m, needle));

  const stakeColumn = mine.size > 0;
  const cols = stakeColumn ? 8 : 7;
  // "Your funds" and "More markets" headings, while both are in view.
  const groups = !sorting && shown.some((m) => mine.has(keyOf(m.address))) && shown.some((m) => !mine.has(keyOf(m.address)));
  const waitingForMine = !!w.address && providers.loading && !providers.data;

  return (
    <div className="stack">
      <div className="hero">
        <h1>Earn by insuring markets</h1>
        <p className="muted">
          Every market has its own <Term t="insurance">insurance fund</Term>. Insurers earn the fund's share of that market's trading fees, and cover losses when a liquidation can't pay its
          way. Estimates below are past performance, not a promise: liquidation losses can reduce share value.{" "}
          <a href={INSURANCE_DOCS} target="_blank" rel="noopener noreferrer">
            Learn more ↗
          </a>
        </p>
      </div>
      <HistoryLag />
      <section className="panel tight">
        <div className="panel-head">
          <h2 style={{ whiteSpace: "nowrap" }}>Insurance funds</h2>
          {stakeColumn && (
            <span className="small muted hide-sm" style={{ marginLeft: "auto" }}>
              Click a market you insure to see your position and withdraw.
            </span>
          )}
          <input style={{ maxWidth: 260 }} placeholder="Search markets" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
        </div>
        {rows.length > 0 && <MarketFilterChips state={show} />}
        {w.address && !waitingForMine && !mine.size && rows.length > 0 && (
          <p className="small muted" style={{ margin: 0, padding: "10px 14px 0" }}>
            You don't insure any market yet. Pick one below and deposit at least 5 USDC.
          </p>
        )}
        {!rows.length || waitingForMine ? (
          list.length && !waitingForMine ? <Empty title="No live markets right now" /> : <Loading what="Loading markets" />
        ) : !shown.length ? (
          <NoMarketMatch state={show} needle={needle} list={rows} />
        ) : (
          <div className="table-wrap">
            <table className="rtable funds">
              <thead>
                <tr>
                  <th {...th("market")}>Market</th>
                  <th {...th("fund", "num")}>
                    <Term t="coverage">Fund vs target</Term>
                  </th>
                  <th {...th("budget", "num hide-sm")}>
                    <Term t="budget">Withdrawal budget</Term>
                  </th>
                  <th {...th("return", "num")}>
                    <Tip text="The fund's share of the last 30 days of fees (since listing, for a market younger than that) over its value, annualized. Past performance, not a promise.">
                      <span className="term">Est. yearly return</span>
                    </Tip>
                  </th>
                  <th {...th("sharePrice", "num hide-sm")}>Share price, 30 days</th>
                  {stakeColumn && <th {...th("stake", "num")}>Your stake</th>}
                  <th></th>
                  <th className="star-col">
                    <span className="sr-only">Watchlist</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m, i) => {
                  const isMine = mine.has(keyOf(m.address));
                  const first = i === 0 || isMine !== mine.has(keyOf(shown[i - 1]!.address));
                  return (
                    <Fragment key={m.address}>
                      {groups && first && (
                        <tr className="group-row">
                          <td colSpan={cols}>{isMine ? "Your funds" : "More markets"}</td>
                        </tr>
                      )}
                      <FundRow
                        m={m}
                        snap={snaps.get(m.address)}
                        est={estimates.get(keyOf(m.address))}
                        provider={mine.get(keyOf(m.address))}
                        budget={budgets.data ? (budgets.data.get(keyOf(m.address)) ?? null) : undefined}
                        holding={holdings.data ? (holdings.data.get(keyOf(m.address)) ?? null) : undefined}
                        stakeColumn={stakeColumn}
                        cols={cols}
                        onInsure={() => setInsure(m)}
                        onChanged={() => setReads((x) => x + 1)}
                      />
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {insure && snaps.get(insure.address) && <DepositDialog m={insure} snap={snaps.get(insure.address)!} onClose={() => setInsure(null)} />}
    </div>
  );
}
