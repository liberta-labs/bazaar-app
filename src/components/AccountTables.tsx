/**
 * Open positions and open orders, across markets or on one, with every action a trader takes on
 * them: close, take-profit and stop-loss, deposit and withdraw; amend and cancel, one or many.
 */
import { account, OrderType, orders, previews, toNumber18 } from "@liberta-labs/bazaar-sdk";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { explain, inputSentence } from "../lib/errors";
import { amount, leverage, parseInput, pct, price, signedUsd, toInput, usd } from "../lib/format";
import { amendPart, cancelPart, closeOrder, forAccount, orderPart } from "../lib/jobs";
import { orderValue, tifText, triggerCondition } from "../lib/orderText";
import { CONTRACT_WALLET_REASON } from "../lib/wallet";
import { useBoard, useRead, useWallet } from "../state/connection";
import { useMarketSnapshots } from "../state/data";
import { useSort } from "../state/sort";
import { type TxReview, useTx } from "../state/tx";
import { AdlMeter, positionAdl } from "./Adl";
import { CollateralPanel } from "./Collateral";
import { Modal } from "./Modal";
import { ActionButton, Empty, Pnl, Term, Tip } from "./ui";

const baseOf = (label: string) => label.split("/")[0] ?? "";

/** The liquidation price of a held position, and how far the price is from it. */
export function liquidation(s: account.AccountSnapshot, spot: bigint | null): { price: bigint | null; distance: number | null } {
  if (!s.hasPosition) return { price: null, distance: null };
  const liq = previews.liquidationPrice(s.position, s.state.projectedFundingIndex, { imrBp: s.state.imrBp, mmrBp: s.state.mmrBp, laggedMmrBp: s.state.laggedMmrBp });
  if (liq === null || !spot || spot === 0n) return { price: liq, distance: null };
  return { price: liq, distance: Math.abs(toNumber18(spot - liq) / toNumber18(spot)) };
}

/** The confirmation for closing a whole position at market. */
function closeReview(s: account.AccountSnapshot, spot: bigint | null, pnl: bigint): TxReview {
  return {
    side: s.position.isLong ? "sell" : "buy",
    action: `${s.position.isLong ? "Sell" : "Buy"} ${amount(s.position.size)} ${baseOf(s.market.label)}`,
    detail: `At market, about ${spot ? price(spot) : "–"}: closes your ${s.position.isLong ? "long" : "short"}`,
    sections: [
      {
        title: "Order",
        rows: [
          { label: "Estimated P&L", value: <Pnl value={pnl}>{signedUsd(pnl)} before fees</Pnl> },
          { label: "Fills within", value: "1% of the oracle price" },
        ],
      },
      {
        title: "After this order",
        rows: [
          { label: "Position", value: "none, fully closed" },
          { label: "Collateral", value: `stays on ${s.market.label}` },
        ],
      },
    ],
  };
}

function ClosePosition({ s }: { s: account.AccountSnapshot }) {
  const tx = useTx();
  const w = useWallet();
  const { readBz } = useRead();
  const { prices } = useBoard();
  const live = prices?.price(s.market.address) ?? null;
  const spot = live?.spot ?? s.price?.spot ?? null;
  const pnl = (live ? account.accountHealth(s, live) : s.health)?.totalPnl ?? 0n;
  const reason = !w.canSign
    ? CONTRACT_WALLET_REASON
    : s.flags.marketOrdersDisabled
      ? (s.flags.reasons.marketOrdersDisabled ?? "Market orders are paused on this market right now.")
      : tx.busy(s.market.address)
        ? "Your last request on this market is still landing."
        : null;
  return (
    <ActionButton
      className="small"
      disabledReason={reason}
      onClick={() =>
        readBz &&
        void tx.run({
          title: `Close ${s.market.label} position`,
          summary: [],
          review: closeReview(s, spot, pnl),
          pair: s.market.address,
          parts: [orderPart(readBz, s.market.address, closeOrder(s.position.isLong, s.position.size), null, "Close position")],
        })
      }
    >
      Close
    </ActionButton>
  );
}

/** Take-profit and stop-loss on a held position, each closing the whole position when it fires. */
function TpSlDialog({ s, onClose }: { s: account.AccountSnapshot; onClose: () => void }) {
  const tx = useTx();
  const { readBz } = useRead();
  const { prices } = useBoard();
  const spot = prices?.spot(s.market.address) ?? s.price?.spot ?? null;
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [bountyText, setBountyText] = useState("0.25");
  const bounty = parseInput(bountyText);
  const sell = s.position.isLong;
  const make = (type: OrderType, text: string): orders.OrderInput | null => {
    const trigger = parseInput(text);
    if (trigger === null) return null;
    return { orderType: type, isLong: !sell, size: orders.CLOSE_POSITION, triggerPrice: trigger, bounty: bounty ?? 0n, maxSlippageBp: 100n };
  };
  const tpOrder = s.takeProfit ? null : make(OrderType.TakeProfit, tp);
  const slOrder = s.stopLoss ? null : make(OrderType.StopLoss, sl);
  const state: orders.AccountOrderState = {
    position: { isLong: s.position.isLong, size: s.position.size },
    activeLimitOrderIds: s.orders.filter((o) => !o.attached).map((o) => o.orderId),
    takeProfitOrderId: s.position.takeProfitOrderId,
    stopLossOrderId: s.position.stopLossOrderId,
  };
  const errOf = (o: orders.OrderInput | null) => {
    if (!o) return null;
    try {
      orders.buildOrderSpec(o, "0x0000000000000000000000000000000000000000", { price: spot ?? undefined, account: state });
      return null;
    } catch (e) {
      return e instanceof Error && "field" in e ? inputSentence(e as never) : explain(e);
    }
  };
  // A take-profit sits on the profitable side of the price, a stop-loss on the losing side.
  const sideErr = (o: orders.OrderInput | null, kind: "tp" | "sl") => {
    if (!o || !spot) return null;
    const above = o.triggerPrice! > spot;
    const wantAbove = (kind === "tp") === s.position.isLong;
    if (above !== wantAbove) return `A ${kind === "tp" ? "take-profit" : "stop-loss"} on a ${s.position.isLong ? "long" : "short"} goes ${wantAbove ? "above" : "below"} the current price (${price(spot)}); it would fire at once.`;
    return null;
  };
  const tpErr = errOf(tpOrder) ?? sideErr(tpOrder, "tp");
  const slErr = errOf(slOrder) ?? sideErr(slOrder, "sl");
  const ready = (tpOrder || slOrder) && !tpErr && !slErr && !tx.busy(s.market.address);

  const submit = () => {
    if (!readBz) return;
    const parts = [
      ...(tpOrder ? [orderPart(readBz, s.market.address, tpOrder, null, "Set take-profit")] : []),
      ...(slOrder ? [orderPart(readBz, s.market.address, slOrder, null, "Set stop-loss")] : []),
    ];
    const lines = [
      ...(tpOrder ? [`Take profit: close the whole position when the price reaches ${price(tpOrder.triggerPrice!)}.`] : []),
      ...(slOrder ? [`Stop loss: close the whole position when the price reaches ${price(slOrder.triggerPrice!)}.`] : []),
      `Each pays a ${usd(bounty ?? 0n)} keeper bounty from your wallet to whoever fires it; unused bounty comes back. Fills at most 1% from the oracle price.`,
    ];
    onClose();
    void tx.run({ title: `Protect ${s.market.label} position`, summary: lines, parts, pair: s.market.address });
  };

  return (
    <Modal title={`Take-profit & stop-loss · ${s.market.label}`} onClose={onClose}>
      <p className="small muted">
        Your {s.position.isLong ? "long" : "short"} of {amount(s.position.size)} {baseOf(s.market.label)}, entry {price(s.position.entryPrice)}, price now {spot ? price(spot) : "–"}.
      </p>
      <div className="stack">
        <label className="field">
          <Term t="takeProfit">Take-profit price</Term>
          {s.takeProfit ? (
            <span>Set at {price(s.takeProfit.triggerPrice)}. Cancel it in your open orders to change it.</span>
          ) : (
            <input className="num" inputMode="decimal" placeholder={s.position.isLong ? "above the price" : "below the price"} value={tp} onChange={(e) => setTp(e.target.value)} />
          )}
          {tpErr && <span className="field-error">{tpErr}</span>}
        </label>
        <label className="field">
          <Term t="stopLoss">Stop-loss price</Term>
          {s.stopLoss ? (
            <span>Set at {price(s.stopLoss.triggerPrice)}. Cancel it in your open orders to change it.</span>
          ) : (
            <input className="num" inputMode="decimal" placeholder={s.position.isLong ? "below the price" : "above the price"} value={sl} onChange={(e) => setSl(e.target.value)} />
          )}
          {slErr && <span className="field-error">{slErr}</span>}
        </label>
        <label className="field">
          <Term t="bounty">Keeper bounty (each)</Term>
          <input className="num" inputMode="decimal" value={bountyText} onChange={(e) => setBountyText(e.target.value)} />
        </label>
        <button className="primary" disabled={!ready} onClick={submit}>
          Set
        </button>
      </div>
    </Modal>
  );
}

/** Closes every open position at market, one request per market; markets that refuse market orders now are left out and named. */
function CloseAll({ rows }: { rows: readonly account.AccountSnapshot[] }) {
  const tx = useTx();
  const w = useWallet();
  const { readBz } = useRead();
  const { prices } = useBoard();
  const open = rows.filter((s) => !s.flags.marketOrdersDisabled);
  const held = rows.filter((s) => s.flags.marketOrdersDisabled);
  const reason = !w.canSign ? CONTRACT_WALLET_REASON : !open.length ? "Market orders are paused on every market you hold right now." : null;
  return (
    <ActionButton
      className="small"
      disabledReason={reason}
      onClick={() => {
        if (!readBz) return;
        for (const s of open) {
          void tx.run({
            title: `Close ${s.market.label} position`,
            summary: held.length ? [`Not closed now (market orders paused): ${held.map((x) => x.market.label).join(", ")}.`] : [],
            review: (() => {
              const live = prices?.price(s.market.address) ?? null;
              const pnl = (live ? account.accountHealth(s, live) : s.health)?.totalPnl ?? 0n;
              return closeReview(s, live?.spot ?? s.price?.spot ?? null, pnl);
            })(),
            pair: s.market.address,
            parts: [orderPart(readBz, s.market.address, closeOrder(s.position.isLong, s.position.size), null, "Close position")],
          });
        }
      }}
    >
      Close all ({open.length})
    </ActionButton>
  );
}

/** A TP/SL's trigger, or a dash. */
const trigger = (o: account.AccountOrder | null) => (o && o.triggerPrice > 0n ? price(o.triggerPrice) : "–");

export function PositionsTable({ snaps, showMarket = true, onChanged }: { snaps: readonly account.AccountSnapshot[]; showMarket?: boolean; onChanged?: () => void }) {
  const { prices } = useBoard();
  const { snaps: marketSnaps } = useMarketSnapshots();
  const w = useWallet();
  const [dialog, setDialog] = useState<null | { kind: "tpsl" | "deposit" | "withdraw"; s: account.AccountSnapshot }>(null);
  const rows = snaps.filter((s) => s.hasPosition);
  // Each position with what its columns show, worked out once for both the cells and the sort.
  const view = rows.map((s) => {
    const live = prices?.price(s.market.address);
    const h = live ? account.accountHealth(s, live) : s.health;
    const spot = live?.spot ?? s.price?.spot ?? null;
    const mark = marketSnaps.get(s.market.address)?.markPrice ?? 0n;
    return { s, h, spot, mark, liq: liquidation(s, spot), adl: positionAdl(s, h) };
  });
  const { sorted, th } = useSort(view, {
    market: (v) => v.s.market.label,
    side: (v) => (v.s.position.isLong ? "Long" : "Short"),
    size: (v) => v.s.position.size,
    value: (v) => v.h?.notional,
    entry: (v) => v.s.position.entryPrice,
    mark: (v) => (v.mark > 0n ? v.mark : null),
    pnl: (v) => v.h?.totalPnl,
    margin: (v) => v.s.position.collateral,
    funding: (v) => v.h?.fundingPnl,
    // How far the price is from liquidation, which compares across markets where the price itself doesn't.
    liquidation: (v) => v.liq.distance,
    adl: (v) => v.adl?.score,
    tpsl: (v) => v.s.takeProfit?.triggerPrice ?? v.s.stopLoss?.triggerPrice ?? null,
  });
  if (!rows.length) return <Empty title="No open positions">Open one from a market's page: pick an amount, buy or sell.</Empty>;
  return (
    <>
      {rows.length > 1 && (
        <div className="row" style={{ justifyContent: "flex-end", padding: "8px 10px" }}>
          <CloseAll rows={rows} />
        </div>
      )}
      <div className="table-wrap">
        <table className="rtable">
          <thead>
            <tr>
              {showMarket && <th {...th("market")}>Market</th>}
              <th {...th("side")}>Side</th>
              <th {...th("size", "num")}>Size</th>
              <th {...th("value", "num")}>Value</th>
              <th {...th("entry", "num")}>Entry</th>
              <th {...th("mark", "num")}>
                <Term t="mark">Mark</Term>
              </th>
              <th {...th("pnl", "num")}>
                <Term t="unrealized">P&L (ROE %)</Term>
              </th>
              <th {...th("margin", "num")}>
                <Term t="margin">Margin</Term>
              </th>
              <th {...th("funding", "num")}>
                <Term t="fundingPnl">Funding</Term>
              </th>
              <th {...th("liquidation", "num")}>
                <Term t="liquidationPrice">Liquidation</Term>
              </th>
              <th {...th("adl", "num")}>
                <Term t="adl">ADL</Term>
              </th>
              <th {...th("tpsl", "num")}>
                <Term t="takeProfit">TP / SL</Term>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ s, h, spot, mark, liq }) => {
              const risky = h && h.marginRatio < 1.5;
              const collateral = s.position.collateral;
              return (
                <tr key={s.market.address}>
                  {showMarket && (
                    <td data-main="">
                      <Link to={`/market/${s.market.address}`}>{s.market.label}</Link>
                    </td>
                  )}
                  <td data-label="Side">
                    <span className={`badge ${s.position.isLong ? "up" : "down"}`}>{s.position.isLong ? "Long" : "Short"}</span>
                    {h?.leverage && <span className="small muted"> {leverage(h.leverage)}</span>}
                  </td>
                  <td data-label="Size" className="num">
                    {amount(s.position.size)} {baseOf(s.market.label)}
                  </td>
                  <td data-label="Value" className="num">{h ? usd(h.notional) : "–"}</td>
                  <td data-label="Entry" className="num">{price(s.position.entryPrice)}</td>
                  <td data-label="Mark" className="num">
                    {mark > 0n ? price(mark) : "–"}
                    <div className="small muted">oracle {spot ? price(spot) : "–"}</div>
                  </td>
                  <td data-label="P&L (ROE %)" className="num">
                    {h ? (
                      <>
                        <Pnl value={h.totalPnl}>{signedUsd(h.totalPnl)}</Pnl>
                        {collateral > 0n && (
                          <div className="small">
                            <Pnl value={h.totalPnl}>{pct(Number((h.totalPnl * 10_000n) / collateral) / 10_000, 1)}</Pnl>
                          </div>
                        )}
                      </>
                    ) : (
                      "–"
                    )}
                  </td>
                  <td data-label="Margin" className="num">
                    {usd(collateral)}
                    <div className={`small ${risky ? "down" : "muted"}`}>{h ? `ratio ${h.marginRatio.toFixed(2)}` : ""}</div>
                  </td>
                  <td data-label="Funding" className="num">{h ? <Pnl value={h.fundingPnl}>{signedUsd(h.fundingPnl)}</Pnl> : "–"}</td>
                  <td data-label="Liquidation" className="num">
                    {liq.price !== null ? price(liq.price) : "none"}
                    {liq.distance !== null && <div className={`small ${liq.distance < 0.05 ? "down" : "muted"}`}>{pct(liq.distance, 1)} away</div>}
                  </td>
                  <td data-label="ADL rank" className="num">
                    <AdlMeter risk={positionAdl(s, h)} />
                  </td>
                  <td data-label="TP / SL" className="num">
                    <span className={s.takeProfit ? "up" : "muted"}>{trigger(s.takeProfit)}</span>
                    <span className="muted"> / </span>
                    <span className={s.stopLoss ? "down" : "muted"}>{trigger(s.stopLoss)}</span>
                  </td>
                  <td data-actions="">
                    <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <ClosePosition s={s} />
                      <ActionButton className="small" disabledReason={w.canSign ? null : CONTRACT_WALLET_REASON} onClick={() => setDialog({ kind: "tpsl", s })}>
                        TP/SL
                      </ActionButton>
                      <button className="small" onClick={() => setDialog({ kind: "deposit", s })}>
                        Deposit
                      </button>
                      <button className="small" onClick={() => setDialog({ kind: "withdraw", s })}>
                        Withdraw
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dialog?.kind === "tpsl" && <TpSlDialog s={dialog.s} onClose={() => setDialog(null)} />}
      {(dialog?.kind === "deposit" || dialog?.kind === "withdraw") && (
        <Modal title={`${dialog.s.market.label} collateral`} onClose={() => setDialog(null)}>
          <CollateralPanel market={dialog.s.market} snap={undefined} acct={dialog.s} defaultTab={dialog.kind} onDone={() => (setDialog(null), onChanged?.())} />
        </Modal>
      )}
    </>
  );
}

function AmendDialog({ s, o, onClose }: { s: account.AccountSnapshot; o: account.AccountOrder; onClose: () => void }) {
  const tx = useTx();
  const [priceText, setPriceText] = useState(toInput(o.limitPrice, 8));
  const [sizeText, setSizeText] = useState(toInput(o.remaining, 8));
  const p = parseInput(priceText);
  const remaining = parseInput(sizeText);
  const err = p === null || p <= 0n ? "Enter a price." : remaining === null || remaining <= 0n ? "Enter a size." : null;
  return (
    <Modal title={`Amend order #${o.orderId}`} onClose={onClose}>
      <p className="small muted">
        {o.isLong ? "Buy" : "Sell"} {baseOf(s.market.label)}. A new price or a larger size moves it to the back of its price level.
      </p>
      <div className="stack">
        <label className="field">
          Limit price
          <input className="num" inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
        </label>
        <label className="field">
          Size still to fill ({baseOf(s.market.label)})
          <input className="num" inputMode="decimal" value={sizeText} onChange={(e) => setSizeText(e.target.value)} />
        </label>
        {err && <div className="field-error">{err}</div>}
        <button
          className="primary"
          disabled={!!err || tx.busy(s.market.address)}
          onClick={() => {
            onClose();
            void tx.run({
              title: "Amend order",
              summary: [`Order #${o.orderId}: ${o.isLong ? "buy" : "sell"} ${amount(remaining!)} ${baseOf(s.market.label)} at ${price(p!)}.`],
              pair: s.market.address,
              // The pair takes the new total size, the filled part included.
              parts: [amendPart(s.market.address, [{ orderId: o.orderId, limitPrice: p!, size: o.filled + remaining! }])],
            });
          }}
        >
          Amend
        </button>
      </div>
    </Modal>
  );
}

const TYPE_TEXT: Record<string, string> = { Market: "Market", Limit: "Limit", StopLimit: "Stop-limit", TakeProfit: "Take-profit", StopLoss: "Stop-loss" };

export function OrdersTable({ snaps, showMarket = true }: { snaps: readonly account.AccountSnapshot[]; showMarket?: boolean }) {
  const tx = useTx();
  const w = useWallet();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [amend, setAmend] = useState<null | { s: account.AccountSnapshot; o: account.AccountOrder }>(null);
  const rows = useMemo(() => snaps.flatMap((s) => s.orders.map((o) => ({ s, o, key: `${s.market.address}-${o.orderId}` }))), [snaps]);
  const { sorted, th } = useSort(rows, {
    market: (r) => r.s.market.label,
    type: (r) => TYPE_TEXT[r.o.typeName] ?? r.o.typeName,
    side: (r) => (r.o.isLong ? "Buy" : "Sell"),
    size: (r) => (r.o.closesWholePosition ? null : r.o.remaining),
    original: (r) => (r.o.closesWholePosition ? null : r.o.size),
    value: (r) => (r.o.closesWholePosition ? null : orderValue(r.o.typeName, r.o.remaining, r.o.limitPrice, r.o.triggerPrice)),
    price: (r) => (r.o.limitPrice > 0n ? r.o.limitPrice : null),
    trigger: (r) => (triggerCondition(r.o.typeName, r.o.isLong, r.o.triggerPrice) ? r.o.triggerPrice : null),
    filled: (r) => (r.o.size > 0n && !r.o.closesWholePosition ? toNumber18(r.o.filled) / toNumber18(r.o.size) : null),
    // Never-expiring orders last when soonest-first, first when latest-first.
    expires: (r) => (r.o.neverExpires ? Number.MAX_SAFE_INTEGER : r.o.blocksLeft),
    order: (r) => r.o.orderId,
  });
  if (!rows.length) return <Empty title="No open orders">Limit, stop and take-profit orders you place show here until they fill.</Empty>;

  const cancel = (list: typeof rows) => {
    // One cancel per market, in batches of up to 34 ids.
    const byPair = new Map<string, typeof rows>();
    for (const r of list) byPair.set(r.s.market.address, [...(byPair.get(r.s.market.address) ?? []), r]);
    for (const [pair, rs] of byPair) {
      const ids = rs.map((r) => r.o.orderId);
      const parts = [];
      for (let i = 0; i < ids.length; i += orders.MAX_CANCELS_PER_CALL) parts.push(forAccount(cancelPart(pair as never, ids.slice(i, i + orders.MAX_CANCELS_PER_CALL)), w.canSign));
      void tx.run({
        title: ids.length === 1 ? "Cancel order" : `Cancel ${ids.length} orders`,
        summary: [`Cancel ${ids.length === 1 ? `order #${ids[0]}` : `${ids.length} orders`} on ${rs[0]!.s.market.label}. Any keeper bounty they hold comes back to your claimable balance.`],
        pair: pair as never,
        parts,
        onDone: () => setPicked(new Set()),
      });
    }
  };

  const chosen = rows.filter((r) => picked.has(r.key));
  return (
    <>
      <div className="row" style={{ padding: "8px 10px" }}>
        <button className="small" disabled={!chosen.length} onClick={() => cancel(chosen)}>
          Cancel selected ({chosen.length})
        </button>
        <button className="small ghost" onClick={() => cancel(rows)}>
          Cancel all
        </button>
      </div>
      <div className="table-wrap">
        <table className="rtable">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  style={{ width: "auto", minHeight: 0 }}
                  checked={chosen.length === rows.length}
                  onChange={(e) => setPicked(new Set(e.target.checked ? rows.map((r) => r.key) : []))}
                />
              </th>
              {showMarket && <th {...th("market")}>Market</th>}
              <th {...th("type")}>Type</th>
              <th {...th("side")}>Side</th>
              <th {...th("size", "num")}>Size</th>
              <th {...th("original", "num")}>Original size</th>
              <th {...th("value", "num")}>Order value</th>
              <th {...th("price", "num")}>Price</th>
              <th {...th("trigger", "num")}>Trigger condition</th>
              <th {...th("filled", "num")}>Filled</th>
              <th {...th("expires", "num hide-sm")}>Expires</th>
              <th {...th("order", "num hide-sm")}>Order</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ s, o, key }) => (
              <tr key={key}>
                <td data-select="">
                  <input
                    type="checkbox"
                    aria-label={`Select order ${o.orderId}`}
                    style={{ width: "auto", minHeight: 0 }}
                    checked={picked.has(key)}
                    onChange={(e) => setPicked((p) => {
                      const n = new Set(p);
                      if (e.target.checked) n.add(key);
                      else n.delete(key);
                      return n;
                    })}
                  />
                </td>
                {showMarket && (
                  <td data-main="">
                    <Link to={`/market/${s.market.address}`}>{s.market.label}</Link>
                  </td>
                )}
                <td data-label="Type">
                  {TYPE_TEXT[o.typeName] ?? o.typeName}
                  <div className="small muted">{o.attached ? "closes the position" : tifText(o.typeName, o.tif, o.isPostOnly)}</div>
                </td>
                <td data-label="Side" className={o.isLong ? "up" : "down"}>{o.isLong ? "Buy" : "Sell"}</td>
                <td data-label="Size" className="num">{o.closesWholePosition ? "whole position" : `${amount(o.remaining)} ${baseOf(s.market.label)}`}</td>
                <td data-label="Original size" className="num">{o.closesWholePosition ? "–" : amount(o.size)}</td>
                <td data-label="Order value" className="num">{(() => {
                  const v = o.closesWholePosition ? null : orderValue(o.typeName, o.remaining, o.limitPrice, o.triggerPrice);
                  return v === null ? "–" : usd(v);
                })()}</td>
                <td data-label="Price" className="num">{o.limitPrice > 0n ? price(o.limitPrice) : "market"}</td>
                <td data-label="Trigger condition" className="num">{triggerCondition(o.typeName, o.isLong, o.triggerPrice) ?? "–"}</td>
                <td data-label="Filled" className="num">{o.size > 0n && !o.closesWholePosition ? pct(toNumber18(o.filled) / toNumber18(o.size), 0) : "–"}</td>
                <td data-label="Expires" className="num hide-sm">{o.neverExpires ? "never" : o.blocksLeft !== null ? <Tip text={`Arbitrum block ${o.expiryBlock}`}><span>in {formatBlocks(o.blocksLeft)}</span></Tip> : "–"}</td>
                <td data-label="Order" className="num hide-sm muted">#{String(o.orderId)}</td>
                <td data-actions="">
                  <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    {o.orderType === OrderType.Limit && o.tif === 0 && (
                      <ActionButton className="small" disabledReason={!w.canSign ? CONTRACT_WALLET_REASON : tx.busy(s.market.address) ? "Your last request on this market is still landing." : null} onClick={() => setAmend({ s, o })}>
                        Amend
                      </ActionButton>
                    )}
                    <ActionButton className="small" disabledReason={tx.busy(s.market.address) ? "Your last request on this market is still landing." : null} onClick={() => cancel([{ s, o, key }])}>
                      Cancel
                    </ActionButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ padding: "0 10px" }}>
        Up to {orders.MAX_ACTIVE_LIMIT_ORDERS_PER_USER} resting limit and stop-limit orders per market, plus one take-profit and one stop-loss.
      </p>
      {amend && <AmendDialog s={amend.s} o={amend.o} onClose={() => setAmend(null)} />}
    </>
  );
}

function formatBlocks(blocks: number): string {
  const s = blocks / orders.L2_BLOCKS_PER_SECOND;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86_400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} days`;
}
