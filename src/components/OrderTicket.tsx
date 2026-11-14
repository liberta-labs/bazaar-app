/**
 * The order ticket. Simple by default (buy or sell, an amount in dollars, leverage, market or limit);
 * "Advanced" adds stop-limit, take-profit and stop-loss, time in force, post-only, slippage, expiry
 * and the keeper bounty. The order is checked as the user types with the SDK's own buildOrderSpec
 * (the pair's rules, against the board's price), and previewed with previewOrder before anything is
 * signed. When the market's collateral falls short, one button deposits the difference and then
 * places the order. With no collateral on the market and no amount typed, the button opens the deposit
 * window instead ("Deposit to Get Started").
 */
import {
  type account,
  bucketState,
  EBP_SCALE,
  effectiveMmrBp,
  fromUsdcUnits,
  InputError,
  type markets,
  MAX_WALK_STEPS,
  MIN_COLLATERAL_DEPOSIT,
  OrderType,
  orders,
  previews as previewsNs,
  ZERO_ADDRESS,
} from "@liberta-labs/bazaar-sdk";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { ACTIVE } from "../config/networks";
import { explain, inputSentence } from "../lib/errors";
import { amount, ceilDiv, leverage as fmtLev, parseInput, price as fmtPrice, toInput, usd } from "../lib/format";
import { depositPart, orderPart } from "../lib/jobs";
import { GATE_ROOM_BP, MAX_ROOM_BP, maxGateSize, maxOrderSize, orderLev10, takerFeeEbp } from "../lib/maxOrder";
import { effectLabel, orderEffect } from "../lib/orderEffect";
import { type FarSide, unfilledText } from "../lib/unfilled";
import { CONTRACT_WALLET_REASON } from "../lib/wallet";
import { useBoard, useRead, useWallet } from "../state/connection";
import { type TxReview, useTx } from "../state/tx";
import { CollateralPanel } from "./Collateral";
import { FaucetButton } from "./Faucet";
import { Modal } from "./Modal";
import { ActionButton, Term, Tip } from "./ui";

type Kind = "market" | "limit" | "stopLimit" | "takeProfit" | "stopLoss";

const KIND_TYPE: Record<Kind, OrderType> = {
  market: OrderType.Market,
  limit: OrderType.Limit,
  stopLimit: OrderType.StopLimit,
  takeProfit: OrderType.TakeProfit,
  stopLoss: OrderType.StopLoss,
};

const EXPIRIES = [
  { label: "1 hour", s: 3_600 },
  { label: "1 day", s: 86_400 },
  { label: "7 days", s: 7 * 86_400 },
  { label: "30 days", s: 30 * 86_400 },
];

const E18 = 10n ** 18n;
/** The keeper bounty on a take-profit or stop-loss attached to a market order: $0.25. */
const ATTACHED_BOUNTY = E18 / 4n;
const CENT = 10n ** 16n;

/** Round an 18-decimal dollar amount up to whole cents. */
const upToCent = (x: bigint) => ceilDiv(x, CENT) * CENT;

export interface TicketPrefill {
  readonly price: bigint;
  readonly n: number;
}

export function OrderTicket({
  market,
  snap,
  acct,
  spot,
  prefill,
  onPlaced,
}: {
  market: markets.MarketInfo;
  snap: markets.MarketSnapshot | undefined;
  acct: account.AccountSnapshot | undefined;
  /** The board's price, or the stored one. */
  spot: { spot: bigint; low: bigint; high: bigint; publishTime: number } | null;
  prefill: TicketPrefill | null;
  onPlaced: () => void;
}) {
  const w = useWallet();
  const tx = useTx();
  const { readBz } = useRead();
  const { prices } = useBoard();
  const base = market.label.split("/")[0] ?? "units";

  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [proOpen, setProOpen] = useState(false);
  const proRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!proOpen) return;
    const close = (e: PointerEvent) => proRef.current && !proRef.current.contains(e.target as Node) && setProOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [proOpen]);
  const [attach, setAttach] = useState(false);
  // Reduce-only, for market orders: held by the app to the position as it stands when the order is sent.
  const [reduceOnly, setReduceOnly] = useState(false);
  const [tpText, setTpText] = useState("");
  const [slText, setSlText] = useState("");
  const [kind, setKind] = useState<Kind>("market");
  const [unit, setUnit] = useState<"usd" | "base">("usd");
  const [amountText, setAmountText] = useState("");
  /** Leverage in tenths (50 is 5.0×), so the slider moves in 0.1× steps without floating-point money math. */
  const [lev10, setLev10] = useState(50);
  const lev = lev10 / 10;
  const [limitText, setLimitText] = useState("");
  const [triggerText, setTriggerText] = useState("");
  const [postOnly, setPostOnly] = useState(false);
  const [tif, setTif] = useState<0 | 1 | 2>(0);
  const [slippageText, setSlippageText] = useState("0.5");
  const [expiry, setExpiry] = useState(EXPIRIES[3]!.s);
  const [bountyText, setBountyText] = useState("0.25");
  const [closeAll, setCloseAll] = useState(true);
  /** The deposit window, opened by the button while the market holds none of the user's collateral. */
  const [depositing, setDepositing] = useState(false);
  const [orderState, setOrderState] = useState<orders.AccountOrderState | undefined>(undefined);
  const [preview, setPreview] = useState<previewsNs.OrderPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // A click on a book level fills in its price.
  useEffect(() => {
    if (!prefill) return;
    if (kind === "market") setKind("limit");
    if (kind === "stopLimit" || kind === "limit" || kind === "market") setLimitText(toInput(prefill.price, 8));
    else setTriggerText(toInput(prefill.price, 8));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);


  // The market's exact maximum, rounded down to the slider's 0.1× step.
  const maxLev10 = Math.max(10, Math.floor((snap?.margin.maxLeverage ?? 10) * 10));
  useEffect(() => setLev10((l) => Math.min(l, maxLev10)), [maxLev10]);

  // The account's order slots and position, for the caps and the TP/SL rules.
  useEffect(() => {
    setOrderState(undefined);
    if (!readBz || !w.address) return;
    readBz.orders.readOrderState(market.address, w.address).then(setOrderState, () => setOrderState(undefined));
  }, [readBz, w.address, market.address, acct?.block]);

  const isLong = side === "buy";
  const position = acct?.position;
  const hasPosition = !!acct?.hasPosition;
  const isTpSl = kind === "takeProfit" || kind === "stopLoss";
  const refPrice = spot?.spot ?? (snap && snap.price.spot > 0n ? snap.price.spot : null);
  const limitPrice = parseInput(limitText);
  const triggerPrice = parseInput(triggerText);
  const sizingPrice = kind === "limit" || kind === "stopLimit" ? (limitPrice ?? refPrice) : kind === "market" ? refPrice : (triggerPrice ?? refPrice);
  const amt = parseInput(amountText);

  // TP/SL close the position from its opposite side.
  useEffect(() => {
    if (isTpSl && position && hasPosition) setSide(position.isLong ? "sell" : "buy");
  }, [isTpSl, position, hasPosition]);

  // A size set exactly by Max (the whole position, to the last unit), while the field shows it rounded.
  // Editing the amount drops it, and so does anything that changes what it closes; switching the unit
  // keeps it.
  const [exactSize, setExactSize] = useState<bigint | null>(null);
  // Whether the slider or Max set the amount (sized at the chosen leverage) rather than the user typing it.
  const [slid, setSlid] = useState(false);
  useEffect(() => {
    setExactSize(null);
    setSlid(false);
  }, [side, market.address, position?.size]);

  const size: bigint | null = useMemo(() => {
    if (isTpSl && closeAll) return orders.CLOSE_POSITION;
    if (exactSize !== null) return exactSize;
    if (amt === null || amt <= 0n) return null;
    if (unit === "base") return amt;
    if (!sizingPrice || sizingPrice <= 0n) return null;
    return (amt * E18) / sizingPrice;
  }, [amt, unit, sizingPrice, isTpSl, closeAll, exactSize]);

  const slippageBp = useMemo(() => {
    const s = parseInput(slippageText);
    return s === null ? null : (s * 100n) / E18;
  }, [slippageText]);
  const bounty = parseInput(bountyText);

  const order: orders.OrderInput | null = useMemo(() => {
    if (size === null) return null;
    const t = KIND_TYPE[kind];
    return {
      orderType: t,
      isLong,
      size,
      ...(kind === "limit" || kind === "stopLimit" ? { limitPrice: limitPrice ?? 0n } : {}),
      ...(kind === "stopLimit" || isTpSl ? { triggerPrice: triggerPrice ?? 0n, bounty: bounty ?? 0n } : {}),
      ...(kind === "market" || isTpSl ? { maxSlippageBp: slippageBp ?? 0n } : {}),
      ...(kind === "limit" ? { tif: tif as orders.TimeInForce, isPostOnly: postOnly && tif === 0 } : {}),
      ...(kind === "market" ? { tif: (tif === 2 ? 2 : 0) as orders.TimeInForce } : {}),
    };
  }, [size, kind, isLong, limitPrice, triggerPrice, bounty, slippageBp, tif, postOnly, isTpSl]);

  // The SDK's own checks, as the pair will run them, with no read.
  const currentBlock = snap?.block;
  const check: { field: string; message: string } | null = useMemo(() => {
    if (!order) return amt !== null && amt <= 0n ? { field: "size", message: "Enter an amount greater than zero." } : null;
    try {
      const rests = orders.canRest(order.orderType, order.tif ?? 0);
      orders.buildOrderSpec(
        rests && currentBlock !== undefined ? { ...order, expirationBlock: currentBlock + orders.blocksIn(expiry) } : order,
        ZERO_ADDRESS,
        { currentBlock, price: refPrice ?? undefined, account: orderState },
      );
      return null;
    } catch (e) {
      return e instanceof InputError ? { field: e.field, message: inputSentence(e) } : { field: "", message: explain(e) };
    }
  }, [order, amt, currentBlock, refPrice, orderState, expiry]);

  // What the order will do, from the pair's own arithmetic at the board's price. A new price alone
  // re-runs it but keeps the last answer on screen until the new one arrives, so the deposit note and
  // the button don't blink on every price tick; any change the user makes clears it at once.
  const previewKey = [market.address, w.address, kind, side, unit, amountText, String(exactSize), limitText, triggerText, tif, postOnly, slippageText, bountyText, closeAll, expiry].join("|");
  const lastPreviewKey = useRef(previewKey);
  useEffect(() => {
    if (lastPreviewKey.current !== previewKey) {
      lastPreviewKey.current = previewKey;
      setPreview(null);
      setPreviewError(null);
    }
    if (!readBz || !order || check || !spot) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let dead = false;
    const t = setTimeout(() => {
      readBz.previews
        // The board's price as the relayed call will see the venue (lib/board.ts previewPrice).
        .previewOrder(market.address, (w.address ?? ZERO_ADDRESS) as Address, order, { price: prices?.previewPrice(market.address) ?? spot })
        .then((p) => {
          if (dead) return;
          setPreview(p);
          setPreviewError(null);
        })
        .catch((e) => {
          if (dead) return;
          setPreview(null);
          setPreviewError(explain(e));
        });
    }, 350);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [readBz, order, check, spot, prices, market.address, w.address, previewKey]);

  // A market order the book would cut short: the far side, to say why (past the max slippage, or the
  // book ran out) and where the nearest price is. As deep as the pair's walk reaches, read again with
  // each new preview.
  const cutShort = kind === "market" && preview?.cancelReason === "Unfilled" && preview.canceledSize > 0n ? preview : null;
  const farKey = `${market.address}|${side}`;
  const [far, setFar] = useState<{ key: string; side: FarSide } | null>(null);
  useEffect(() => {
    if (!cutShort || !readBz) return;
    let dead = false;
    readBz.markets.getBookDepth(market.address, isLong ? "asks" : "bids", MAX_WALK_STEPS + 1).then(
      (d) => !dead && setFar({ key: farKey, side: d }),
      () => !dead && setFar(null),
    );
    return () => {
      dead = true;
    };
  }, [cutShort, readBz, market.address, isLong, farKey]);

  // How much to deposit first. Simple mode: enough for the chosen leverage. Always: the shortfall.
  const notional = preview ? (preview.fills.reduce((s, f) => s + f.notional, 0n) || (size && sizingPrice ? (size * sizingPrice) / E18 : 0n)) : 0n;
  // Whether the order only trades the held position down. The preview knows exactly; while a new one is
  // worked out (any change to the ticket clears it, a slippage drag included), the order's own effect
  // stands in, so the leverage slider and the TP/SL option don't blink in and out.
  const sizedEffect = size !== null && !isTpSl ? orderEffect(isLong, size, hasPosition && position ? position : null) : null;
  const reduces = preview ? preview.reduces && !preview.flips && !preview.opens : sizedEffect === "reduce" || sizedEffect === "close";
  const free = acct?.maxWithdrawable ?? 0n;

  // The Max shortcut: the largest order this market's collateral allows at the chosen leverage, after
  // the taker fee at the fund's current rate, with room for a market order's slippage
  // (lib/maxOrder.ts); for a take-profit or stop-loss, the whole position.
  // Two limits, the smaller wins: the ticket's own leverage rule (so Max never calls for a deposit), and
  // the pair's creation check on the position the order leaves, searched with the SDK's own copy.
  const maxMark = snap && snap.markPrice > 0n ? snap.markPrice : refPrice;
  const feeEbp = snap
    ? takerFeeEbp({ freeCapital: snap.insurance.freeCapital, targetRatioBp: snap.insurance.targetRatioBp }, snap.openInterest.longNotional + snap.openInterest.shortNotional)
    : previewsNs.TAKER_INSURANCE_FEE_CAP_EBP;
  // The held position valued at the mark, for the creation check and for what a flip leaves.
  const held = acct && maxMark
    ? bucketState(acct.position.isLong, acct.position.size, acct.position.entryValue, acct.position.collateral, acct.position.entryFundingIndex, maxMark, acct.state.projectedFundingIndex, effectiveMmrBp(acct.state.mmrBp, acct.state.laggedMmrBp))
    : null;
  // An order against a held position closes it first; past its size it flips it.
  const opposite = !isTpSl && !!position && hasPosition && position.isLong !== isLong;
  // What backs new exposure: the free collateral, or on a flip everything the closed position leaves
  // (its equity, less the fee on closing it).
  const backing = opposite && held ? held.equity - (held.currentNotional * feeEbp) / EBP_SCALE : free;
  // Two limits, the smaller wins: the leverage rule above, and the pair's own creation check on the
  // position the order leaves, searched with the SDK's copy of it. At leverage `l10` (in tenths).
  const largestAt = (l10: number): bigint | null => {
    const openMax = sizingPrice
      ? maxOrderSize({ free: backing, lev10: l10, price: maxMark && maxMark > sizingPrice ? maxMark : sizingPrice, takerEbp: feeEbp, roomBp: (kind === "market" ? (slippageBp ?? 0n) : 0n) + MAX_ROOM_BP })
      : null;
    const upTo = (opposite && position ? position.size : 0n) + (openMax ?? 0n);
    if (upTo === 0n) return null;
    if (!acct || !maxMark || !held) return upTo;
    const g = maxGateSize({
      order: { orderType: KIND_TYPE[kind], isLong, limitPrice: limitPrice ?? 0n, triggerPrice: triggerPrice ?? 0n, maxSlippageBp: slippageBp ?? 0n },
      position: acct.position,
      state: held,
      mark: maxMark,
      imrBp: acct.state.imrBp,
      resting: previewsNs.restingReserve(
        acct.orders.filter((o) => !o.attached),
        maxMark,
      ),
      upTo,
      roomBp: GATE_ROOM_BP,
    });
    return g > 0n ? g : null;
  };
  const gateMax = largestAt(lev10);
  // The leverage a typed amount uses: its notional (on a flip, the part past the held position) over the
  // collateral that backs it, by the same rule as Max. Below the chosen leverage the slider shows it,
  // since nothing in the order raises it; above, the deposit brings it down to the chosen one.
  const opening = size !== null && size !== orders.CLOSE_POSITION ? (opposite && position ? size - position.size : size) : 0n;
  const typedLev10 =
    !isTpSl && !reduces && opening > 0n && sizingPrice && backing > 0n ? orderLev10({ notional: (opening * sizingPrice) / E18, backing, takerEbp: feeEbp }) : null;
  // An amount the slider or Max set was sized at the chosen leverage, so the slider keeps showing that.
  const shownLev10 = !slid && typedLev10 !== null && typedLev10 < lev10 ? typedLev10 : lev10;
  // Close: the whole held position, exactly. Max: the largest order (on the far side, a flip into the
  // largest opposite position), except where only closing is allowed: a take-profit or stop-loss, or a
  // reduce-only order.
  const closeSize = (opposite || isTpSl) && position && hasPosition ? position.size : null;
  const closeOnly = isTpSl || (reduceOnly && kind === "market");
  const maxSize = closeOnly ? closeSize : gateMax;
  const maxIsClose = maxSize !== null && maxSize === closeSize;
  const maxReason = !w.address
    ? "Connect a wallet first."
    : !sizingPrice
      ? "Waiting for a price."
      : maxSize === null
        ? closeOnly
          ? isTpSl
            ? "Take-profit and stop-loss need an open position on this market."
            : `Reduce-only needs a position to reduce: ${hasPosition ? `switch to ${position?.isLong ? "Sell" : "Buy"}` : "you have none on this market"}.`
          : "There's no collateral on this market yet. Deposit some first, or type an amount and the ticket deposits from your wallet."
        : null;
  const fillSize = (s: bigint, exact: boolean) => {
    if (!sizingPrice) return;
    // In the field's current unit (dollars unless switched), rounded down, so the amount never asks for
    // more than the collateral backs. A close keeps the exact size behind it, so nothing is left over
    // whatever the field shows.
    if (unit === "base") setAmountText(toInput((s / 10n ** 12n) * 10n ** 12n, 6));
    else setAmountText(toInput(((s * sizingPrice) / E18 / CENT) * CENT, 2));
    setExactSize(exact ? s : null);
    setSlid(!exact);
  };
  // Dragging the slider. An amount the slider or Max set follows it, as the most the collateral backs at
  // the new leverage. A typed amount stays when the slider goes down (the deposit lowers its leverage),
  // and grows the same way when it goes past the amount's own leverage, which only a larger order reaches.
  const slide = (l10: number) => {
    setLev10(l10);
    if (size === null || size === orders.CLOSE_POSITION || typedLev10 === null || (!slid && l10 <= typedLev10)) return;
    const s = largestAt(l10);
    if (s !== null) fillSize(s, false);
  };
  const shortfall = preview?.margin.shortfall ?? 0n;
  let deposit = 0n;
  if (preview && w.address && !reduces && !isTpSl) {
    // Enough for the chosen leverage. On a flip only the new side needs margin, and everything the
    // closed position leaves (its collateral after the realized P&L and the fees) backs it: so it's the
    // position the order leaves at that leverage, against the collateral it leaves.
    // A book too thin to fill the order leaves the preview without the flip, so the order's own size
    // decides it too: past the held position it flips, and the part past it is what opens.
    const flipIntent = opposite && !!position && size !== null && size !== orders.CLOSE_POSITION && size > position.size;
    const forLeverage =
      (kind === "market" || kind === "limit") && notional > 0n
        ? preview.flips
          ? (preview.after.notional * 10n) / BigInt(lev10) - preview.after.collateral
          : flipIntent && held && sizingPrice
            ? ((((size! - position!.size) * sizingPrice) / E18) * 10n) / BigInt(lev10) + preview.fees.total - held.equity
            : (notional * 10n) / BigInt(lev10) + preview.fees.total - free
        : 0n;
    const need = shortfall > forLeverage ? shortfall : forLeverage;
    if (need > 0n) {
      deposit = upToCent(need + need / 100n);
      if (deposit < MIN_COLLATERAL_DEPOSIT) deposit = MIN_COLLATERAL_DEPOSIT;
    }
  }
  const walletUsdc = acct ? fromUsdcUnits(acct.wallet.usdcBalance) : null;
  const walletShort = deposit > 0n && walletUsdc !== null && deposit > walletUsdc;
  const bountyPull = isTpSl || kind === "stopLimit" ? (bounty ?? 0n) : 0n;

  const blockers = (preview?.blockers ?? []).filter((b) => !/Margin|Collateral/i.test(b.error) || deposit === 0n);
  const statusReason = snap && snap.status !== "live" ? (snap.reasons.marketOrdersDisabled ?? `Trading is paused: the market is ${snap.status}.`) : null;
  const marketClosedReason = kind === "market" && snap?.marketOrdersDisabled ? (snap.reasons.marketOrdersDisabled ?? "Market orders are paused right now.") : null;
  const busy = tx.busy(market.address);

  // A take-profit and stop-loss attached to a market order, placed once it fills. They protect the
  // position the order leaves, so they sit on its profitable and losing sides of the price.
  const canAttach = kind === "market" && !reduces;
  const tp = attach && canAttach ? parseInput(tpText) : null;
  const sl = attach && canAttach ? parseInput(slText) : null;
  const attachErr = (() => {
    if (!attach || !canAttach || !refPrice) return null;
    if (tp === null && sl === null) return "Enter a take-profit price, a stop-loss price, or both.";
    if (tp !== null && (isLong ? tp <= refPrice : tp >= refPrice)) return `A take-profit on a ${isLong ? "long" : "short"} goes ${isLong ? "above" : "below"} the price (${fmtPrice(refPrice)}).`;
    if (sl !== null && (isLong ? sl >= refPrice : sl <= refPrice)) return `A stop-loss on a ${isLong ? "long" : "short"} goes ${isLong ? "below" : "above"} the price (${fmtPrice(refPrice)}).`;
    return null;
  })();

  // The app caps slippage below the protocol's 10%: a market order that may fill 5% away is already
  // far worse than a newcomer would expect.
  const slippageCapped = (kind === "market" || isTpSl) && slippageBp !== null && slippageBp > APP_MAX_SLIPPAGE_BP;

  // A reduce-only market order may only shrink or close the position: the same side would add to it,
  // and more than the position would flip it.
  const reduceOnlyErr =
    reduceOnly && kind === "market" && size !== null
      ? !position || !hasPosition
        ? "Reduce-only needs a position to reduce, and you have none on this market."
        : position.isLong === isLong
          ? `Reduce-only: this would add to your ${position.isLong ? "long" : "short"}. Switch to ${position.isLong ? "Sell" : "Buy"}.`
          : size > position.size
            ? `Reduce-only: at most ${amount(position.size, 6)} ${base}, your whole position. Max fills it exactly.`
            : null
      : null;

  let disabled: string | null = null;
  if (!w.canSign) disabled = CONTRACT_WALLET_REASON;
  else if (statusReason) disabled = statusReason;
  else if (marketClosedReason) disabled = marketClosedReason;
  else if (busy) disabled = "Your last request on this market is still landing.";
  else if (!order) disabled = isTpSl && !closeAll ? "Enter a size." : "Enter an amount.";
  else if (reduceOnlyErr) disabled = reduceOnlyErr;
  else if (check) disabled = check.message;
  else if (slippageCapped) disabled = SLIPPAGE_CAP_TEXT;
  else if (!spot) disabled = "There's no price for this market right now (the live price board is unreachable), so orders can't be checked. Try again shortly.";
  else if (!preview) disabled = previewError ?? "Checking the order…";
  else if (blockers.length) disabled = blockers[0]!.message;
  else if (walletShort) disabled = `This needs ${usd(deposit)} more collateral and your wallet holds ${usd(walletUsdc!)}.`;
  else if (isTpSl && !hasPosition) disabled = "Take-profit and stop-loss need an open position on this market.";
  else if (attachErr) disabled = attachErr;

  // No collateral on this market yet and no amount typed: the button opens the same deposit window as
  // the account card's Deposit. Once an amount is typed, the order button deposits what it needs itself.
  const startWithDeposit = !!w.address && !!acct && acct.position.collateral === 0n && !hasPosition && (!order || isTpSl);

  const sideWord = isLong ? "Buy" : "Sell";
  // The button names what the order does to the position, not just its side.
  const action = effectLabel(orderEffect(isLong, size, hasPosition && position ? position : null), isLong, base);
  const sizeText = size === orders.CLOSE_POSITION ? "the whole position" : size !== null ? `${amount(size, 6)} ${base}` : "";
  const title = isTpSl ? (kind === "takeProfit" ? "Take profit" : "Stop loss") : `${sideWord} ${market.label}`;

  const submit = () => {
    if (!w.address) return w.openConnect();
    if (!order || !preview || !readBz) return;
    const protect = (type: OrderType, trigger: bigint): orders.OrderInput => ({
      orderType: type,
      isLong: !isLong,
      size: orders.CLOSE_POSITION,
      triggerPrice: trigger,
      bounty: ATTACHED_BOUNTY,
      maxSlippageBp: 100n,
    });
    const extra = [
      ...(tp !== null ? [{ label: "Set take-profit", order: protect(OrderType.TakeProfit, tp) }] : []),
      ...(sl !== null ? [{ label: "Set stop-loss", order: protect(OrderType.StopLoss, sl) }] : []),
    ];
    // The confirmation: the order in a line, its figures, and the position it leaves.
    const review: TxReview = {
      side: isLong ? "buy" : "sell",
      action: `${sideWord} ${sizeText}`,
      detail:
        kind === "market"
          ? `At market, about ${refPrice ? fmtPrice(refPrice) : "–"}`
          : kind === "limit"
            ? `At ${limitPrice ? fmtPrice(limitPrice) : "–"} or better`
            : kind === "stopLimit"
              ? `At ${limitPrice ? fmtPrice(limitPrice) : "–"} once the price reaches ${triggerPrice ? fmtPrice(triggerPrice) : "–"}`
              : `When the price reaches ${triggerPrice ? fmtPrice(triggerPrice) : "–"}`,
      sections: [
        {
          title: "Order",
          rows: [
            ...(deposit > 0n ? [{ label: "Deposit first", value: `${usd(deposit)} from your wallet` }] : []),
            ...(notional > 0n ? [{ label: "Order value", value: usd(notional) }] : []),
            { label: "Trading fee", value: `about ${usd(preview.fees.total)}` },
            ...(bountyPull > 0n ? [{ label: "Keeper bounty", value: `${usd(bountyPull)} from your wallet` }] : []),
            ...(tp !== null ? [{ label: "Then take-profit at", value: fmtPrice(tp) }] : []),
            ...(sl !== null ? [{ label: "Then stop-loss at", value: fmtPrice(sl) }] : []),
          ],
        },
        ...(preview.after.size > 0n
          ? [
              {
                title: "After this order",
                rows: [
                  { label: "Position", value: `${preview.after.isLong ? "Long" : "Short"} ${amount(preview.after.size, 6)} ${base}` },
                  { label: "Leverage", value: fmtLev(preview.after.leverage) },
                  { label: "Liquidation price", value: preview.after.liquidationPrice ? fmtPrice(preview.after.liquidationPrice) : "none" },
                ],
              },
            ]
          : preview.closes
            ? [{ title: "After this order", rows: [{ label: "Position", value: "none, fully closed" }] }]
            : []),
      ],
    };
    const summary: ReactNode[] = [];
    if (deposit > 0n) summary.push(`The deposit becomes ${market.label} collateral before the order is placed.`);
    if (bountyPull > 0n) summary.push("The keeper bounty pays whoever fires the order; any unused part comes back to you.");
    if (extra.length) summary.push(`The take-profit and stop-loss each pay a ${usd(ATTACHED_BOUNTY)} keeper bounty from your wallet when they fire; unused bounty comes back.`);
    const rests = orders.canRest(order.orderType, order.tif ?? 0);
    void tx.run({
      title,
      summary,
      review,
      pair: market.address,
      parts: [
        ...(deposit > 0n ? [depositPart(market.address, deposit, `Deposit ${usd(deposit)}`)] : []),
        orderPart(readBz, market.address, order, rests ? expiry : null, isTpSl ? title : `${sideWord} ${base}`),
        ...extra.map((x) => orderPart(readBz, market.address, x.order, null, x.label)),
      ],
      onDone: () => {
        setAmountText("");
        setExactSize(null);
        setTpText("");
        setSlText("");
        onPlaced();
      },
    });
  };

  const isPro = kind === "stopLimit" || isTpSl;
  const posText = position && hasPosition ? `${position.isLong ? "" : "-"}${amount(position.size, 6)} ${base}` : `0 ${base}`;
  const takerBp = preview ? Number(preview.feeRates.takerEbp) / 100 : null;
  const markRef = snap && snap.markPrice > 0n ? snap.markPrice : refPrice;

  return (
    <div className="ticket stack" style={{ gap: 10 }}>
      <div className="seg big-seg" role="radiogroup" aria-label="Side">
        <button className={isLong ? "on buy-on" : ""} onClick={() => setSide("buy")} aria-pressed={isLong} disabled={isTpSl}>
          Buy / Long
        </button>
        <button className={!isLong ? "on sell-on" : ""} onClick={() => setSide("sell")} aria-pressed={!isLong} disabled={isTpSl}>
          Sell / Short
        </button>
      </div>

      <div className="seg" ref={proRef} style={{ position: "relative", overflow: "visible" }}>
        <button className={kind === "market" ? "on" : ""} onClick={() => setKind("market")}>
          Market
        </button>
        <button className={kind === "limit" ? "on" : ""} onClick={() => setKind("limit")}>
          Limit
        </button>
        <button className={isPro ? "on" : ""} onClick={() => setProOpen((o) => !o)} aria-haspopup="menu" aria-expanded={proOpen}>
          {isPro ? PRO_LABEL[kind] : "Pro"} ▾
        </button>
        {proOpen && (
          <div className="menu" role="menu">
            {(["stopLimit", "takeProfit", "stopLoss"] as Kind[]).map((k) => (
              <button
                key={k}
                role="menuitem"
                onClick={() => {
                  setKind(k);
                  setProOpen(false);
                }}
              >
                <b>{PRO_LABEL[k]}</b>
                <span className="small muted">{PRO_TEXT[k]}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!isTpSl && !reduces && (
        <div className="lev-row">
          <Term t="leverage">Leverage</Term>
          <input type="range" min={10} max={maxLev10} step={1} value={Math.max(10, shownLev10)} onChange={(e) => slide(Number(e.target.value))} aria-label="Leverage" />
          <span className="mono accent">{shownLev10 > 0 ? (shownLev10 / 10).toFixed(1) : "<0.1"}×</span>
        </div>
      )}
      <div className="spread small">
        <span className="muted">Current position</span>
        <span className="mono">{posText}</span>
      </div>
      {isPro && (
        <p className="small muted" style={{ margin: 0 }}>
          <Term t={kind === "stopLimit" ? "stopLimit" : kind === "takeProfit" ? "takeProfit" : "stopLoss"}>{PRO_LABEL[kind]}</Term>
          {isTpSl ? (hasPosition ? `: closes your ${position!.isLong ? "long" : "short"} when the price reaches the trigger.` : ": needs an open position on this market.") : ": becomes a limit order once the price reaches the trigger."}
        </p>
      )}

      {(kind === "stopLimit" || isTpSl) && (
        <div className="input-row">
          <span className="muted">Trigger</span>
          <input className="num" inputMode="decimal" placeholder={refPrice ? toInput(refPrice, 2) : "0.00"} value={triggerText} onChange={(e) => setTriggerText(e.target.value)} aria-label="Trigger price" />
          <span className="muted small">USD</span>
        </div>
      )}
      {check?.field === "triggerPrice" && <span className="field-error">{check.message}</span>}
      {(kind === "limit" || kind === "stopLimit") && (
        <div className="input-row">
          <span className="muted">{kind === "stopLimit" ? "Limit" : "Price"}</span>
          <input className="num" inputMode="decimal" placeholder={refPrice ? toInput(refPrice, 2) : "0.00"} value={limitText} onChange={(e) => setLimitText(e.target.value)} aria-label="Limit price" />
          <span className="muted small">USD</span>
          {markRef !== null && markRef > 0n && (
            <button className="chip" onClick={() => setLimitText(toInput(markRef, 2))} title="Use the mark price">
              Mark
            </button>
          )}
        </div>
      )}
      {check?.field === "limitPrice" && <span className="field-error">{check.message}</span>}

      {isTpSl && (
        <label className="check small">
          <input type="checkbox" checked={closeAll} onChange={(e) => setCloseAll(e.target.checked)} /> Close the whole position
        </label>
      )}
      {!(isTpSl && closeAll) && (
        <div className="input-row">
          <span className="muted">Amount</span>
          <input
            className="num"
            inputMode="decimal"
            placeholder="0"
            value={amountText}
            onChange={(e) => {
              setExactSize(null);
              setSlid(false);
              setAmountText(e.target.value);
            }}
            aria-label="Amount"
          />
          {closeSize !== null && !closeOnly && position && (
            <Tip text={`Close your whole ${position.isLong ? "long" : "short"}: ${amount(closeSize, 6)} ${base}.`}>
              <button className="chip" onClick={() => fillSize(closeSize, true)}>
                Close
              </button>
            </Tip>
          )}
          <Tip
            text={
              maxReason ??
              (maxIsClose && position
                ? `Close your whole ${position.isLong ? "long" : "short"}: ${amount(position.size, 6)} ${base}.`
                : opposite && position
                  ? `Close your ${position.isLong ? "long" : "short"} and open the largest ${position.isLong ? "short" : "long"} what it leaves backs at ${lev.toFixed(1)}×, after fees, with room for the price to move.`
                  : `The most your ${usd(free)} of collateral on this market covers at ${lev.toFixed(1)}×, after fees, with room for the price to move.`)
            }
          >
            <button className="chip" disabled={maxReason !== null} onClick={() => maxSize !== null && fillSize(maxSize, maxIsClose)}>
              Max
            </button>
          </Tip>
          <button
            className="chip"
            onClick={() => {
              // The same order in the other unit: the amount converts at the price it's sized at, rounded
              // down. A size Max or Close set exactly stays exact, so a close still closes everything.
              const next = unit === "usd" ? "base" : "usd";
              if (size !== null && size !== orders.CLOSE_POSITION && sizingPrice) {
                setAmountText(next === "usd" ? toInput(((size * sizingPrice) / E18 / CENT) * CENT, 2) : toInput((size / 10n ** 12n) * 10n ** 12n, 6));
              }
              setUnit(next);
            }}
            title={`Enter in ${unit === "usd" ? base : "USD"}`}
          >
            {unit === "usd" ? "USD" : base} ⇄
          </button>
        </div>
      )}
      {!(isTpSl && closeAll) && size !== null && size !== orders.CLOSE_POSITION && sizingPrice ? (
        <span className="small muted" style={{ marginTop: -6 }}>
          {unit === "usd" ? `≈ ${amount(size, 6)} ${base}` : `≈ ${usd((size * sizingPrice) / E18)}`}
        </span>
      ) : null}
      {check?.field === "size" && <span className="field-error">{check.message}</span>}

      {(kind === "limit" || kind === "market") && (
      <div className="spread small" style={{ flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 12 }}>
          {kind === "limit" && (
            <label className="check">
              <input type="checkbox" checked={postOnly && tif === 0} disabled={tif !== 0} onChange={(e) => setPostOnly(e.target.checked)} />
              <Term t="postOnly">Post-only</Term>
            </label>
          )}
          {canAttach && (
            <label className="check">
              <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> Take profit / Stop loss
            </label>
          )}
          {kind === "market" && (
            <label className="check">
              <input type="checkbox" checked={tif === 2} onChange={(e) => setTif(e.target.checked ? 2 : 0)} /> All or nothing
            </label>
          )}
          {kind === "market" && (
            <label className="check">
              <input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />
              <Term t="reduceOnly">Reduce only</Term>
            </label>
          )}
        </div>
        {kind === "limit" && (
          <label className="row" style={{ gap: 6 }}>
            <Term t="tif">TIF</Term>
            <select className="compact" value={tif} onChange={(e) => setTif(Number(e.target.value) as 0 | 1 | 2)}>
              <option value={0}>GTC</option>
              <option value={1}>IOC</option>
              <option value={2}>FOK</option>
            </select>
          </label>
        )}
      </div>
      )}

      {attach && canAttach && (
        <div className="field-row">
          <label className="field">
            <Term t="takeProfit">Take-profit price</Term>
            <input className="num" inputMode="decimal" value={tpText} onChange={(e) => setTpText(e.target.value)} placeholder={isLong ? "above the price" : "below the price"} />
          </label>
          <label className="field">
            <Term t="stopLoss">Stop-loss price</Term>
            <input className="num" inputMode="decimal" value={slText} onChange={(e) => setSlText(e.target.value)} placeholder={isLong ? "below the price" : "above the price"} />
          </label>
        </div>
      )}
      {attachErr && (tpText || slText) && <span className="field-error">{attachErr}</span>}

      {(kind === "market" || isTpSl) && (
        <>
          <div className="lev-row">
            <Term t="slippage">Max slippage</Term>
            <input
              type="range"
              min={0}
              max={Number(APP_MAX_SLIPPAGE_BP)}
              step={SLIPPAGE_STEP_BP}
              value={slippageBp === null ? 0 : Math.min(Number(slippageBp), Number(APP_MAX_SLIPPAGE_BP))}
              onChange={(e) => setSlippageText((Number(e.target.value) / 100).toFixed(1))}
              aria-label="Max slippage"
            />
            <span className="slip-box">
              <input className="num" inputMode="decimal" value={slippageText} onChange={(e) => setSlippageText(e.target.value)} aria-label="Max slippage, exact" />
              <span className="muted small">%</span>
            </span>
          </div>
          {slippageBp !== null && slippageBp > 0n && slippageBp <= TIGHT_SLIPPAGE_BP && (
            <span className="small muted" style={{ marginTop: -6 }}>
              A limit this tight protects your price, but the order may fill only partly, or not at all, if the book is thin or the price is moving.
            </span>
          )}
        </>
      )}
      {check?.field === "maxSlippageBp" && <span className="field-error">{check.message}</span>}
      {slippageCapped && <span className="field-error">{SLIPPAGE_CAP_TEXT}</span>}
      {(kind === "limit" && tif === 0) || kind === "stopLimit" ? (
        <div className="input-row">
          <span className="muted">Expires</span>
          <select className="compact" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} aria-label="Expires after">
            {EXPIRIES.map((x) => (
              <option key={x.s} value={x.s}>
                in {x.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {check?.field === "expirationBlock" && <span className="field-error">{check.message}</span>}
      {(kind === "stopLimit" || isTpSl) && (
        <div className="input-row">
          <Term t="bounty">
            <span className="muted">Keeper bounty</span>
          </Term>
          <input className="num" inputMode="decimal" value={bountyText} onChange={(e) => setBountyText(e.target.value)} aria-label="Keeper bounty" />
          <span className="muted small">USDC</span>
        </div>
      )}
      {check?.field === "bounty" && <span className="field-error">{check.message}</span>}
      {check && !["limitPrice", "triggerPrice", "size", "maxSlippageBp", "expirationBlock", "bounty"].includes(check.field) && <div className="field-error">{check.message}</div>}

      {deposit > 0n && !disabled && (
        <div className="callout small">
          {shortfall > 0n ? `You need ${usd(shortfall)} more collateral on ${market.label} for this order.` : `For ${lev.toFixed(1)}× leverage you'll add collateral on ${market.label}.`} Your wallet will
          ask you to approve a {usd(deposit)} deposit first{deposit === MIN_COLLATERAL_DEPOSIT ? ` (the ${usd(MIN_COLLATERAL_DEPOSIT)} minimum)` : ""}, then the order.
        </div>
      )}
      {walletShort && (
        <div className="callout bad small">
          Deposit {usd(deposit - (walletUsdc ?? 0n))} more USDC to your wallet for this, or trade a smaller amount. {ACTIVE.testnet && <FaucetButton compact />}
        </div>
      )}
      {preview && preview.canceledSize > 0n && preview.cancelReason && (
        <p className="small accent" style={{ margin: 0 }}>
          {preview.cancelReason !== "Unfilled"
            ? `Part of it would be cancelled (${preview.cancelReason}).`
            : kind === "limit"
              ? unfilledText({ kind: "limit", isLong, limitPrice: limitPrice ?? 0n }, preview.takerSize > 0n)
              : unfilledText(
                  { kind: "market", isLong, oracle: preview.mark, slippageBp: slippageBp ?? 0n, maxSlippageBp: APP_MAX_SLIPPAGE_BP, far: far?.key === farKey ? far.side : null },
                  preview.takerSize > 0n,
                )}
        </p>
      )}

      {!w.address ? (
        <button className="primary wide big-btn" onClick={w.openConnect}>
          Connect wallet
        </button>
      ) : startWithDeposit ? (
        <button className="primary wide big-btn" onClick={() => setDepositing(true)}>
          Deposit to Get Started
        </button>
      ) : (
        <ActionButton className={`wide big-btn ${isTpSl ? "primary" : isLong ? "buy" : "sell"}`} disabledReason={disabled} onClick={submit}>
          {isTpSl ? `Set ${title.toLowerCase()}` : deposit > 0n ? `Deposit ${usd(deposit)} & ${action[0]!.toLowerCase()}${action.slice(1)}` : action}
        </ActionButton>
      )}
      {disabled && order && w.address && !startWithDeposit && <div className="small muted">{disabled}</div>}
      {depositing && (
        <Modal title={`${market.label} collateral`} onClose={() => setDepositing(false)}>
          <CollateralPanel
            market={market}
            snap={snap}
            acct={acct}
            defaultTab="deposit"
            onDone={() => {
              setDepositing(false);
              onPlaced();
            }}
          />
        </Modal>
      )}

      <div className="kv small ticket-facts">
        <span>
          <Term t="liquidationPrice">Est. liquidation price</Term>
        </span>
        <span>{preview && preview.after.size > 0n ? (preview.after.liquidationPrice ? fmtPrice(preview.after.liquidationPrice) : "none") : "–"}</span>
        <span>Order value</span>
        <span>{notional > 0n ? usd(notional) : size !== null && size !== orders.CLOSE_POSITION && sizingPrice ? usd((size * sizingPrice) / E18) : "$0.00"}</span>
        <span>
          <Term t="margin">Margin required</Term>
        </span>
        <span>{preview ? usd(preview.margin.requiredCollateral) : "$0.00"}</span>
        {preview?.takerAvgPrice ? (
          <>
            <span>Average fill</span>
            <span>{fmtPrice(preview.takerAvgPrice)}</span>
          </>
        ) : null}
        {preview && preview.restingSize > 0n ? (
          <>
            <span>Rests in the book</span>
            <span>
              {amount(preview.restingSize, 6)} {base}
            </span>
          </>
        ) : null}
        <span>Leverage after</span>
        <span>{preview ? fmtLev(preview.after.leverage) : "–"}</span>
        <span>
          <Tip text="Trading fees: taker (fills now) / maker (rests in the book). The taker rate rises while the insurance fund is below its target.">
            <span className="term">Fees</span>
          </Tip>
        </span>
        <span>
          {preview ? usd(preview.fees.total) : "$0.00"}
          <span className="muted">
            {" "}
            · {takerBp !== null ? `${(takerBp / 100).toFixed(4)}%` : "–"} / {(Number(previewsNs.MAKER_INSURANCE_FEE_EBP) / 10_000).toFixed(4)}%
          </span>
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        <Tip text="You sign; Bazaar's relayer sends the transaction and pays the gas. You need no ETH.">
          <span className="term">Gasless</span>
        </Tip>{" "}
        · {ACTIVE.testnet ? "no network fee on testnet" : "a small USDC network fee"}
      </p>
    </div>
  );
}

/** The most slippage this app lets an order allow: 5%, half the protocol's own cap (orders.MAX_SLIPPAGE_BP, 10%). */
const APP_MAX_SLIPPAGE_BP = 500n;
const SLIPPAGE_CAP_TEXT = "Set a slippage limit of 5% or less.";
/** The slippage slider's step: 0.1%, shown to one decimal. The box beside it takes any value from 0.01% up to the cap. */
const SLIPPAGE_STEP_BP = 10;
/** At or under this (0.1%), say plainly that the order may not fill. */
const TIGHT_SLIPPAGE_BP = 10n;

const PRO_LABEL: Record<string, string> = { stopLimit: "Stop-limit", takeProfit: "Take-profit", stopLoss: "Stop-loss" };
const PRO_TEXT: Record<string, string> = {
  stopLimit: "A limit order that activates at a trigger price",
  takeProfit: "Close your position at a profit",
  stopLoss: "Close your position to limit a loss",
};
