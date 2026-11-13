/**
 * The account's tabs, shared by the Portfolio and the market page: balances, positions, open orders,
 * and every history the subgraph keeps. Each history loads only when its tab is opened.
 */
import { type Bazaar, formatUnits18, history } from "@liberta-labs/bazaar-sdk";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Address, Hex } from "viem";
import { OrdersTable, PositionsTable } from "./AccountTables";
import { BalancesTable } from "./Balances";
import { type HistoryColumn, HistoryList } from "./History";
import { InsuranceStats } from "./InsuranceStats";
import { TableTools, TableToolsSlot } from "./TableTools";
import { Empty, Loading, Pnl, Term, TxLink } from "./ui";
import { amount, dateTime, price, signedUsd, usd } from "../lib/format";
import { type FundingPayment, fundingPayments, txPairKey } from "../lib/fundingHistory";
import { mergeByTime } from "../lib/mergePages";
import { orderValue, tifText, triggerCondition } from "../lib/orderText";
import { type TradeRow, tradeRows } from "../lib/tradeRows";
import { useRead, useWallet } from "../state/connection";
import { useLiveAccount, usesMarket } from "../state/data";

export type Tab = "balances" | "positions" | "orders" | "trades" | "funding" | "orderHistory" | "orderEvents" | "activity" | "insurance";

const TABS: { id: Tab; label: string }[] = [
  { id: "balances", label: "Balances" },
  { id: "positions", label: "Positions" },
  { id: "orders", label: "Open orders" },
  { id: "trades", label: "Trade history" },
  { id: "funding", label: "Funding history" },
  { id: "orderHistory", label: "Order history" },
  { id: "orderEvents", label: "Order activity" },
  { id: "activity", label: "Account activity" },
  { id: "insurance", label: "Insurance" },
];

const TYPE_TEXT: Record<string, string> = { Market: "Market", Limit: "Limit", StopLimit: "Stop-limit", TakeProfit: "Take-profit", StopLoss: "Stop-loss" };
const SNAPSHOT_PAGES = 5;

function useLabels() {
  const { markets: list } = useRead();
  return useMemo(() => {
    const m = new Map(list.map((x) => [x.address.toLowerCase(), x.label]));
    return (pair: Address) => m.get(pair.toLowerCase()) ?? pair.slice(0, 8);
  }, [list]);
}

const baseOf = (label: string) => label.split("/")[0] ?? "";

/** Columns every history shares: when, which market, which transaction. */
function useCommonColumns() {
  const label = useLabels();
  return {
    label,
    time: <T extends { timestamp: number }>(header = "Time"): HistoryColumn<T> => ({ header, csvHeader: "time", cell: (r) => dateTime(r.timestamp), csv: (r) => new Date(r.timestamp * 1000).toISOString() }),
    market: <T extends { pair: Address }>(): HistoryColumn<T> => ({ header: "Market", csvHeader: "market", cell: (r) => <Link to={`/market/${r.pair}`}>{label(r.pair)}</Link>, csv: (r) => label(r.pair) }),
    tx: <T extends { transactionHash: string }>(): HistoryColumn<T> => ({ header: "", csvHeader: "transaction", cell: (r) => <TxLink hash={r.transactionHash}>tx ↗</TxLink>, csv: (r) => r.transactionHash }),
  };
}

function TradeHistory({ readBz, user }: { readBz: Bazaar; user: Address }) {
  const { historyVersion } = useLiveAccount();
  const { label, time, market, tx } = useCommonColumns();
  const [grouped, setGrouped] = useState(true);
  return (
    <>
      <TableTools>
        <label className="check small">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group fills by order
        </label>
      </TableTools>
      <HistoryList<TradeRow>
        deps={[readBz, user, grouped]}
        refreshKey={historyVersion}
        filename="bazaar-trades.csv"
        load={async (o) => {
          const p = await readBz.history.trades({ account: user, ...o });
          if (!p.items.length) return { items: [], next: p.next };
          // The position changes of the same transactions: what each fill closed.
          const from = Math.min(...p.items.map((t) => t.timestamp));
          const to = Math.max(...p.items.map((t) => t.timestamp)) + 1;
          const changes = await readBz.history.positionChanges({ account: user, from, to, first: 1000 }).catch(() => ({ items: [] }));
          return { items: tradeRows(user, p.items, changes.items, grouped), next: p.next };
        }}
        empty={{ title: "No trades yet", text: "Your fills show here once an order trades." }}
        columns={[
          time(),
          market(),
          { header: "Side", csvHeader: "side", cell: (t) => <span className={t.buy ? "up" : "down"}>{t.buy ? "Buy" : "Sell"}</span>, csv: (t) => (t.buy ? "buy" : "sell") },
          { header: "Role", csvHeader: "role", cell: (t) => (t.maker ? "maker" : "taker"), csv: (t) => (t.maker ? "maker" : "taker") },
          { header: "Size", csvHeader: "size", num: true, cell: (t) => `${amount(t.size)} ${baseOf(label(t.pair))}`, csv: (t) => formatUnits18(t.size) },
          {
            header: "Price",
            csvHeader: "price",
            num: true,
            cell: (t) => (
              <>
                {price(t.price)}
                {t.fills > 1 && <div className="small muted">avg of {t.fills} fills</div>}
              </>
            ),
            csv: (t) => formatUnits18(t.price),
          },
          { header: "Value", csvHeader: "notional_usd", num: true, cell: (t) => usd(t.notional), csv: (t) => formatUnits18(t.notional) },
          { header: "Fee", csvHeader: "fee_usd", num: true, cell: (t) => usd(t.fee), csv: (t) => formatUnits18(t.fee) },
          {
            header: <Term t="realizedPnl">Closed P&L</Term>,
            csvHeader: "closed_pnl_usd",
            num: true,
            cell: (t) => (t.closedPnl === null ? <span className="muted small">see grouped</span> : t.closedPnl === 0n ? <span className="muted">–</span> : <Pnl value={t.closedPnl}>{signedUsd(t.closedPnl)}</Pnl>),
            csv: (t) => (t.closedPnl === null ? "" : formatUnits18(t.closedPnl)),
          },
          {
            header: "Position after",
            csvHeader: "position_after",
            num: true,
            cell: (t) => (t.after === null ? <span className="muted">–</span> : t.after.size === 0n ? "flat" : `${t.after.isLong ? "long" : "short"} ${amount(t.after.size)}`),
            csv: (t) => (t.after === null ? "" : `${t.after.size === 0n ? "" : t.after.isLong ? "" : "-"}${formatUnits18(t.after.size)}`),
          },
          { header: "Order", csvHeader: "order_id", num: true, cell: (t) => (t.orderId === null ? "–" : <span className="muted">#{String(t.orderId)}</span>), csv: (t) => (t.orderId === null ? "" : String(t.orderId)) },
          tx(),
        ]}
      />
    </>
  );
}

/** Every funding payment, worked out from the account's position snapshots (lib/fundingHistory.ts). */
function FundingHistory({ readBz, user }: { readBz: Bazaar; user: Address }) {
  const { historyVersion } = useLiveAccount();
  const { label, time, market, tx } = useCommonColumns();
  const load = useMemo(() => {
    let all: Promise<FundingPayment[]> | null = null;
    const read = async () => {
      const snaps: history.PositionSnapshot[] = [];
      let after: string | null = null;
      for (let i = 0; i < SNAPSHOT_PAGES; i++) {
        const p: history.Page<history.PositionSnapshot> = await readBz.history.positionSnapshots({ account: user, order: "asc", first: 1000, after });
        snaps.push(...p.items);
        if (!p.next) break;
        after = p.next;
      }
      const [liqs, adls] = await Promise.all([readBz.history.liquidations({ account: user, first: 1000 }), readBz.history.adlFills({ account: user, first: 1000 })]);
      return fundingPayments(
        snaps,
        new Set(liqs.items.map((l) => txPairKey(l.transactionHash, l.pair))),
        new Map(adls.items.map((a) => [txPairKey(a.transactionHash, a.pair), a.withheldFunding])),
      );
    };
    return async ({ first, after }: { first: number; after: string | null }): Promise<history.Page<FundingPayment>> => {
      if (after === null || !all) all = read();
      const list = await all;
      const start = after === null ? 0 : Number(after);
      return { items: list.slice(start, start + first), next: start + first < list.length ? String(start + first) : null };
    };
  }, [readBz, user]);
  return (
    <>
      <p className="small muted" style={{ padding: "10px 10px 0", margin: 0 }}>
        <Term t="funding">Funding</Term> builds up while a position is open and settles into your collateral when you reduce or close it: each row is one settlement. Funding still building up shows
        under Positions.
      </p>
      <HistoryList<FundingPayment>
        deps={[load]}
        refreshKey={historyVersion}
        filename="bazaar-funding.csv"
        load={load}
        empty={{ title: "No funding settled yet", text: "It settles when you reduce or close a position." }}
        columns={[
          time(),
          market(),
          {
            header: "Position",
            csvHeader: "position",
            cell: (r) => (
              <>
                <span className={r.isLong ? "up" : "down"}>{r.isLong ? "Long" : "Short"}</span> {amount(r.sizeBefore)} {baseOf(label(r.pair))}
              </>
            ),
            csv: (r) => `${r.isLong ? "" : "-"}${formatUnits18(r.sizeBefore)}`,
          },
          { header: "Closed", csvHeader: "closed_size", num: true, cell: (r) => amount(r.closed), csv: (r) => formatUnits18(r.closed) },
          { header: "Payment", csvHeader: "payment_usd", num: true, cell: (r) => <Pnl value={r.amount}>{signedUsd(r.amount)}</Pnl>, csv: (r) => formatUnits18(r.amount) },
          { header: "On", csvHeader: "via", cell: (r) => (r.via === "adl" ? "auto-deleverage" : r.via === "settlement" ? "market settlement" : "trade"), csv: (r) => r.via },
          tx(),
        ]}
      />
    </>
  );
}

function OrderHistory({ readBz, user }: { readBz: Bazaar; user: Address }) {
  const { historyVersion } = useLiveAccount();
  const { market } = useCommonColumns();
  return (
    <HistoryList<history.HistoryOrder>
      deps={[readBz, user]}
      refreshKey={historyVersion}
      filename="bazaar-orders.csv"
      load={(o) => readBz.history.orders({ account: user, ...o })}
      empty={{ title: "No orders yet" }}
      columns={[
        { header: "Updated", csvHeader: "updated", cell: (r) => dateTime(r.updatedTimestamp), csv: (r) => new Date(r.updatedTimestamp * 1000).toISOString() },
        { header: "Placed", csvHeader: "created", cell: (r) => dateTime(r.createdTimestamp), csv: (r) => new Date(r.createdTimestamp * 1000).toISOString() },
        market(),
        {
          header: "Type",
          csvHeader: "type",
          cell: (r) => (
            <>
              {TYPE_TEXT[r.orderType] ?? r.orderType}
              <div className="small muted">{tifText(r.orderType, r.timeInForce, r.isPostOnly)}</div>
            </>
          ),
          csv: (r) => [r.orderType, tifText(r.orderType, r.timeInForce, r.isPostOnly)].filter(Boolean).join(" "),
        },
        { header: "Side", csvHeader: "side", cell: (r) => <span className={r.isLong ? "up" : "down"}>{r.isLong ? "Buy" : "Sell"}</span>, csv: (r) => (r.isLong ? "buy" : "sell") },
        { header: "Size", csvHeader: "size", num: true, cell: (r) => amount(r.size), csv: (r) => formatUnits18(r.size) },
        { header: "Filled", csvHeader: "filled", num: true, cell: (r) => amount(r.filledSize), csv: (r) => formatUnits18(r.filledSize) },
        {
          header: "Order value",
          csvHeader: "order_value_usd",
          num: true,
          cell: (r) => {
            const v = orderValue(r.orderType, r.size, r.limitPrice, r.triggerPrice);
            return v === null ? "–" : usd(v);
          },
          csv: (r) => {
            const v = orderValue(r.orderType, r.size, r.limitPrice, r.triggerPrice);
            return v === null ? "" : formatUnits18(v);
          },
        },
        { header: "Price", csvHeader: "limit_price", num: true, cell: (r) => (r.limitPrice > 0n ? price(r.limitPrice) : "market"), csv: (r) => formatUnits18(r.limitPrice) },
        {
          header: "Trigger condition",
          csvHeader: "trigger",
          num: true,
          cell: (r) => triggerCondition(r.orderType, r.isLong, r.triggerPrice) ?? "–",
          csv: (r) => triggerCondition(r.orderType, r.isLong, r.triggerPrice) ?? "",
          sort: (r) => (triggerCondition(r.orderType, r.isLong, r.triggerPrice) ? r.triggerPrice : null),
        },
        { header: "Status", csvHeader: "status", cell: (r) => r.status, csv: (r) => r.status },
        {
          header: "Why it ended",
          csvHeader: "reason",
          cell: (r) => (r.status === "Canceled" ? <span className="small">{history.CANCEL_REASON_TEXT[r.cancelReason]}</span> : r.status === "Filled" ? "filled" : ""),
          csv: (r) => (r.status === "Canceled" ? history.CANCEL_REASON_TEXT[r.cancelReason] : ""),
        },
        { header: "Order", csvHeader: "order_id", num: true, cell: (r) => <span className="muted">#{String(r.orderId)}</span>, csv: (r) => String(r.orderId) },
      ]}
    />
  );
}

/** One line of account activity, from whichever list it came. */
interface Activity {
  readonly key: string;
  readonly timestamp: number;
  readonly pair: Address;
  readonly what: string;
  readonly detail: string;
  /** USD moved, where the activity moves any. */
  readonly amount: bigint | null;
  readonly transactionHash: Hex;
}

type ActivityFilter = "all" | "collateral" | "insurance" | "claims" | "forced";
const ACTIVITY_FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "collateral", label: "Deposits & withdrawals" },
  { id: "insurance", label: "Insurance" },
  { id: "claims", label: "Claims" },
  { id: "forced", label: "Liquidations & ADL" },
];

const INSURANCE_TEXT: Record<history.InsuranceEventKind, string> = {
  Deposit: "Insured",
  WithdrawalRequested: "Insurance withdrawal requested",
  WithdrawalLocked: "Insurance withdrawal locked",
  WithdrawalExecuted: "Insurance withdrawal collected",
  LevyCharged: "Insurer levy charged",
  LevyReceived: "Insurer levy received",
};

function AccountActivity({ readBz, user }: { readBz: Bazaar; user: Address }) {
  const { historyVersion } = useLiveAccount();
  const { label, time, market, tx } = useCommonColumns();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const load = useMemo(() => {
    const want = (f: ActivityFilter) => filter === "all" || filter === f;
    type Opts = { first: number; to?: number };
    const sources = [
      ...(want("collateral")
        ? [async (o: Opts) => {
            const p = await readBz.history.collateralTransfers({ account: user, ...o });
            return { next: p.next, items: p.items.map((r): Activity => ({ key: r.id, timestamp: r.timestamp, pair: r.pair, what: r.isDeposit ? "Collateral deposit" : "Collateral withdrawal", detail: "", amount: r.amount, transactionHash: r.transactionHash })) };
          }]
        : []),
      ...(want("insurance")
        ? [async (o: Opts) => {
            const p = await readBz.history.insuranceEvents({ account: user, ...o });
            return {
              next: p.next,
              items: p.items.map((r): Activity => ({
                key: r.id,
                timestamp: r.timestamp,
                pair: r.pair,
                what: INSURANCE_TEXT[r.kind] ?? r.kind,
                detail: r.shares > 0n ? `${amount(r.shares, 4)} shares` : "",
                amount: r.amount > 0n ? r.amount : null,
                transactionHash: r.transactionHash,
              })),
            };
          }]
        : []),
      ...(want("claims")
        ? [async (o: Opts) => {
            const p = await readBz.history.feeClaims({ recipient: user, ...o });
            return { next: p.next, items: p.items.map((r): Activity => ({ key: r.id, timestamp: r.timestamp, pair: r.pair, what: "Fees claimed", detail: "", amount: r.amount, transactionHash: r.transactionHash })) };
          }]
        : []),
      ...(want("forced")
        ? [
            async (o: Opts) => {
              const p = await readBz.history.liquidations({ account: user, ...o });
              return {
                next: p.next,
                items: p.items.map((r): Activity => ({
                  key: r.id,
                  timestamp: r.timestamp,
                  pair: r.pair,
                  what: "Liquidated",
                  detail: `${r.isLong ? "Long" : "Short"} ${amount(r.size)} ${baseOf(label(r.pair))} at ${price(r.price)}; collateral lost`,
                  amount: r.collateralSeized,
                  transactionHash: r.transactionHash,
                })),
              };
            },
            async (o: Opts) => {
              const p = await readBz.history.adlFills({ account: user, ...o });
              return {
                next: p.next,
                items: p.items.map((r): Activity => ({
                  key: r.id,
                  timestamp: r.timestamp,
                  pair: r.pair,
                  what: "Auto-deleveraged",
                  detail: `${r.isLong ? "Long" : "Short"} ${amount(r.closedSize)} ${baseOf(label(r.pair))} closed at ${price(r.settlementPrice)}; credited`,
                  amount: r.credit,
                  transactionHash: r.transactionHash,
                })),
              };
            },
          ]
        : []),
    ];
    return mergeByTime<Activity>(sources);
  }, [readBz, user, filter, label]);
  return (
    <>
      <TableTools>
        <div className="row" style={{ gap: 4 }}>
          {ACTIVITY_FILTERS.map((f) => (
            <button key={f.id} className={`chip${filter === f.id ? " on" : ""}`} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
              {f.label}
            </button>
          ))}
        </div>
      </TableTools>
      <HistoryList<Activity>
        deps={[load]}
        refreshKey={historyVersion}
        filename="bazaar-account-activity.csv"
        load={load}
        empty={{ title: "Nothing here yet", text: "Deposits, withdrawals, insurance, claims, liquidations and auto-deleveraging show here." }}
        columns={[
          time(),
          market(),
          { header: "Activity", csvHeader: "activity", cell: (r) => r.what, csv: (r) => r.what },
          { header: "Details", csvHeader: "details", cell: (r) => <span className="small muted">{r.detail}</span>, csv: (r) => r.detail },
          { header: "Amount", csvHeader: "amount_usd", num: true, cell: (r) => (r.amount === null ? "–" : usd(r.amount)), csv: (r) => (r.amount === null ? "" : formatUnits18(r.amount)) },
          tx(),
        ]}
      />
    </>
  );
}

function OrderActivity({ readBz, user }: { readBz: Bazaar; user: Address }) {
  const { historyVersion } = useLiveAccount();
  const { time, market, tx } = useCommonColumns();
  return (
    <HistoryList<history.OrderEvent>
      deps={[readBz, user]}
      refreshKey={historyVersion}
      filename="bazaar-order-activity.csv"
      load={(o) => readBz.history.orderEvents({ account: user, ...o })}
      empty={{ title: "No order activity yet" }}
      columns={[
        time(),
        market(),
        { header: "Order", csvHeader: "order_id", cell: (r) => `#${r.orderId}`, csv: (r) => String(r.orderId) },
        { header: "What happened", csvHeader: "action", cell: (r) => r.action, csv: (r) => r.action },
        {
          header: "Why",
          csvHeader: "reason",
          cell: (r) => <span className="small">{r.action === "Canceled" ? history.CANCEL_REASON_TEXT[r.cancelReason] : r.amendSkipReason ?? ""}</span>,
          csv: (r) => (r.action === "Canceled" ? history.CANCEL_REASON_TEXT[r.cancelReason] : (r.amendSkipReason ?? "")),
        },
        { header: "Size", csvHeader: "size", num: true, cell: (r) => amount(r.size), csv: (r) => formatUnits18(r.size) },
        { header: "Price", csvHeader: "limit_price", num: true, cell: (r) => (r.limitPrice > 0n ? price(r.limitPrice) : "–"), csv: (r) => formatUnits18(r.limitPrice) },
        tx(),
      ]}
    />
  );
}

function History({ tab, user }: { tab: Tab; user: Address }) {
  const { readBz } = useRead();
  if (!readBz) return <Loading />;
  switch (tab) {
    case "trades":
      return <TradeHistory readBz={readBz} user={user} />;
    case "funding":
      return <FundingHistory readBz={readBz} user={user} />;
    case "orderHistory":
      return <OrderHistory readBz={readBz} user={user} />;
    case "orderEvents":
      return <OrderActivity readBz={readBz} user={user} />;
    case "activity":
      return <AccountActivity readBz={readBz} user={user} />;
    case "insurance":
      // A summary and three tables, each with its own tools: they stay above their tables.
      return (
        <TableToolsSlot.Provider value={null}>
          <InsuranceStats readBz={readBz} user={user} />
        </TableToolsSlot.Provider>
      );
    default:
      return null;
  }
}

/** Balances, positions, orders and history across every market, as tabs. */
export function AccountTabs({ className = "panel tight", defaultTab = "positions" }: { className?: string; defaultTab?: Tab }) {
  const w = useWallet();
  const acct = useLiveAccount();
  const [tab, setTab] = useState<Tab>(defaultTab);
  const used = useMemo(() => [...acct.snaps.values()].filter(usesMarket).sort((a, b) => a.market.index - b.market.index), [acct.snaps]);
  const all = useMemo(() => [...acct.snaps.values()].sort((a, b) => a.market.index - b.market.index), [acct.snaps]);
  const openOrders = used.reduce((n, s) => n + s.orders.length, 0);
  const openPositions = used.filter((s) => s.hasPosition).length;
  // The open table's tools render into this slot, on the tab bar's row.
  const [tools, setTools] = useState<HTMLElement | null>(null);
  return (
    <section className={className}>
      <div className="tabs-bar">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)} role="tab" aria-selected={tab === t.id}>
              {t.label}
              {t.id === "positions" && openPositions ? ` (${openPositions})` : t.id === "orders" && openOrders ? ` (${openOrders})` : ""}
            </button>
          ))}
        </div>
        <div className="tabs-tools" ref={setTools} />
      </div>
      <TableToolsSlot.Provider value={tools}>
      {!w.address ? (
        <Empty title="Connect a wallet to see your balances, positions, orders and history" action={<button className="primary" onClick={w.openConnect}>Connect wallet</button>} />
      ) : tab === "balances" ? (
        !acct.loaded ? <Loading /> : <BalancesTable snaps={all} />
      ) : tab === "positions" ? (
        !acct.loaded ? <Loading /> : <PositionsTable snaps={used} onChanged={acct.refresh} />
      ) : tab === "orders" ? (
        !acct.loaded ? <Loading /> : <OrdersTable snaps={used} />
      ) : (
        <History tab={tab} user={w.address} />
      )}
      </TableToolsSlot.Provider>
    </section>
  );
}
