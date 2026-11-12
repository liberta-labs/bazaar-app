/** The account's tabs: positions, open orders and every history list, shared by the Portfolio and the market page. */
import { formatUnits18, history } from "@liberta-labs/bazaar-sdk";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Address } from "viem";
import { OrdersTable, PositionsTable } from "./AccountTables";
import { type HistoryColumn, HistoryList } from "./History";
import { Empty, Loading, Pnl, Term, TxLink } from "./ui";
import { amount, dateTime, price, signedUsd, usd } from "../lib/format";
import { useRead, useWallet } from "../state/connection";
import { useLiveAccount, usesMarket } from "../state/data";

type Tab = "positions" | "orders" | "trades" | "orderHistory" | "orderEvents" | "fees" | "transfers" | "liquidations";

const TABS: { id: Tab; label: string }[] = [
  { id: "positions", label: "Positions" },
  { id: "orders", label: "Open orders" },
  { id: "trades", label: "Trades" },
  { id: "orderHistory", label: "Order history" },
  { id: "orderEvents", label: "Order activity" },
  { id: "fees", label: "Fees & P&L" },
  { id: "transfers", label: "Deposits & withdrawals" },
  { id: "liquidations", label: "Liquidations" },
];

const TYPE_TEXT: Record<string, string> = { Market: "Market", Limit: "Limit", StopLimit: "Stop-limit", TakeProfit: "Take-profit", StopLoss: "Stop-loss" };

function useLabels() {
  const { markets: list } = useRead();
  return useMemo(() => {
    const m = new Map(list.map((x) => [x.address.toLowerCase(), x.label]));
    return (pair: Address) => m.get(pair.toLowerCase()) ?? pair.slice(0, 8);
  }, [list]);
}

function History({ tab, user }: { tab: Tab; user: Address }) {
  const { readBz } = useRead();
  const label = useLabels();
  if (!readBz) return <Loading />;
  const time = <T extends { timestamp: number }>(): HistoryColumn<T> => ({ header: "Time", csvHeader: "time", cell: (r) => dateTime(r.timestamp), csv: (r) => new Date(r.timestamp * 1000).toISOString() });
  const market = <T extends { pair: Address }>(): HistoryColumn<T> => ({ header: "Market", csvHeader: "market", cell: (r) => <Link to={`/market/${r.pair}`}>{label(r.pair)}</Link>, csv: (r) => label(r.pair) });
  const txCol = <T extends { transactionHash: string }>(): HistoryColumn<T> => ({ header: "", csvHeader: "transaction", cell: (r) => <TxLink hash={r.transactionHash}>tx ↗</TxLink>, csv: (r) => r.transactionHash });
  const lc = user.toLowerCase();

  switch (tab) {
    case "trades": {
      const isMaker = (t: history.Trade) => t.maker.toLowerCase() === lc;
      const buy = (t: history.Trade) => (isMaker(t) ? !t.takerIsLong : t.takerIsLong);
      return (
        <HistoryList<history.Trade>
          deps={[readBz, user]}
          filename="bazaar-trades.csv"
          load={(o) => readBz.history.trades({ account: user, ...o })}
          empty={{ title: "No trades yet", text: "Your fills show here once an order trades." }}
          columns={[
            time(),
            market(),
            { header: "Side", csvHeader: "side", cell: (t) => <span className={buy(t) ? "up" : "down"}>{buy(t) ? "Buy" : "Sell"}</span>, csv: (t) => (buy(t) ? "buy" : "sell") },
            { header: "Role", csvHeader: "role", cell: (t) => (isMaker(t) ? "maker" : "taker"), csv: (t) => (isMaker(t) ? "maker" : "taker") },
            { header: "Size", csvHeader: "size", num: true, cell: (t) => amount(t.size), csv: (t) => formatUnits18(t.size) },
            { header: "Price", csvHeader: "price", num: true, cell: (t) => price(t.price), csv: (t) => formatUnits18(t.price) },
            { header: "Value", csvHeader: "notional_usd", num: true, cell: (t) => usd(t.notional), csv: (t) => formatUnits18(t.notional) },
            { header: "Fee", csvHeader: "fee_usd", num: true, cell: (t) => usd(isMaker(t) ? t.makerFee : t.takerFee), csv: (t) => formatUnits18(isMaker(t) ? t.makerFee : t.takerFee) },
            txCol(),
          ]}
        />
      );
    }
    case "orderHistory":
      return (
        <HistoryList<history.HistoryOrder>
          deps={[readBz, user]}
          filename="bazaar-orders.csv"
          load={(o) => readBz.history.orders({ account: user, ...o })}
          empty={{ title: "No orders yet" }}
          columns={[
            { header: "Placed", csvHeader: "created", cell: (r) => dateTime(r.createdTimestamp), csv: (r) => new Date(r.createdTimestamp * 1000).toISOString() },
            market(),
            { header: "Type", csvHeader: "type", cell: (r) => TYPE_TEXT[r.orderType] ?? r.orderType, csv: (r) => r.orderType },
            { header: "Side", csvHeader: "side", cell: (r) => <span className={r.isLong ? "up" : "down"}>{r.isLong ? "Buy" : "Sell"}</span>, csv: (r) => (r.isLong ? "buy" : "sell") },
            { header: "Size", csvHeader: "size", num: true, cell: (r) => amount(r.size), csv: (r) => formatUnits18(r.size) },
            { header: "Filled", csvHeader: "filled", num: true, cell: (r) => amount(r.filledSize), csv: (r) => formatUnits18(r.filledSize) },
            { header: "Price", csvHeader: "limit_price", num: true, cell: (r) => (r.limitPrice > 0n ? price(r.limitPrice) : "market"), csv: (r) => formatUnits18(r.limitPrice) },
            { header: "Status", csvHeader: "status", cell: (r) => r.status, csv: (r) => r.status },
            {
              header: "Why it ended",
              csvHeader: "reason",
              cell: (r) => (r.status === "Canceled" ? <span className="small">{history.CANCEL_REASON_TEXT[r.cancelReason]}</span> : r.status === "Filled" ? "filled" : ""),
              csv: (r) => (r.status === "Canceled" ? history.CANCEL_REASON_TEXT[r.cancelReason] : ""),
            },
          ]}
        />
      );
    case "orderEvents":
      return (
        <HistoryList<history.OrderEvent>
          deps={[readBz, user]}
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
            txCol(),
          ]}
        />
      );
    case "fees":
      return (
        <>
          <p className="small muted" style={{ padding: "10px 10px 0" }}>
            Each trade's fee and the profit or loss it realized. <Term t="funding">Funding</Term> settles into your collateral continuously; your open position shows its funding P&L.
          </p>
          <HistoryList<history.PositionChange>
            deps={[readBz, user]}
            filename="bazaar-fees-pnl.csv"
            load={(o) => readBz.history.positionChanges({ account: user, ...o })}
            empty={{ title: "No trades yet" }}
            columns={[
              time(),
              market(),
              { header: "Price", csvHeader: "price", num: true, cell: (r) => price(r.executionPrice), csv: (r) => formatUnits18(r.executionPrice) },
              { header: "Position after", csvHeader: "size_after", num: true, cell: (r) => `${r.newSize > 0n ? (r.isLong ? "long " : "short ") : ""}${amount(r.newSize)}`, csv: (r) => formatUnits18(r.newSize) },
              { header: "Fee", csvHeader: "fee_usd", num: true, cell: (r) => usd(r.fee), csv: (r) => formatUnits18(r.fee) },
              { header: "Realized P&L", csvHeader: "realized_pnl_usd", num: true, cell: (r) => <Pnl value={r.realizedPnl}>{signedUsd(r.realizedPnl)}</Pnl>, csv: (r) => formatUnits18(r.realizedPnl) },
              txCol(),
            ]}
          />
          <h3 style={{ padding: "16px 10px 0" }}>Claims</h3>
          <HistoryList<history.FeeMovement>
            deps={[readBz, user]}
            filename="bazaar-claims.csv"
            load={(o) => readBz.history.feeClaims({ recipient: user, ...o })}
            empty={{ title: "No claims yet", text: "Refunded bounties and rewards you claim show here." }}
            columns={[time(), market(), { header: "Amount", csvHeader: "amount_usd", num: true, cell: (r) => usd(r.amount), csv: (r) => formatUnits18(r.amount) }, txCol()]}
          />
        </>
      );
    case "transfers":
      return (
        <HistoryList<history.CollateralTransfer>
          deps={[readBz, user]}
          filename="bazaar-deposits-withdrawals.csv"
          load={(o) => readBz.history.collateralTransfers({ account: user, ...o })}
          empty={{ title: "No deposits yet", text: "Deposit collateral on a market's page to start trading." }}
          columns={[
            time(),
            market(),
            { header: "Type", csvHeader: "type", cell: (r) => (r.isDeposit ? "Deposit" : "Withdrawal"), csv: (r) => (r.isDeposit ? "deposit" : "withdrawal") },
            { header: "Amount", csvHeader: "amount_usd", num: true, cell: (r) => usd(r.amount), csv: (r) => formatUnits18(r.amount) },
            txCol(),
          ]}
        />
      );
    case "liquidations":
      return (
        <HistoryList<history.Liquidation>
          deps={[readBz, user]}
          filename="bazaar-liquidations.csv"
          load={(o) => readBz.history.liquidations({ account: user, ...o })}
          empty={{ title: "No liquidations", text: "Good. Keep your margin ratio well above 1 to stay that way." }}
          columns={[
            time(),
            market(),
            { header: "Side", csvHeader: "side", cell: (r) => (r.isLong ? "Long" : "Short"), csv: (r) => (r.isLong ? "long" : "short") },
            { header: "Size", csvHeader: "size", num: true, cell: (r) => amount(r.size), csv: (r) => formatUnits18(r.size) },
            { header: "Price", csvHeader: "price", num: true, cell: (r) => price(r.price), csv: (r) => formatUnits18(r.price) },
            { header: "Collateral lost", csvHeader: "collateral_seized_usd", num: true, cell: (r) => usd(r.collateralSeized), csv: (r) => formatUnits18(r.collateralSeized) },
            txCol(),
          ]}
        />
      );
    default:
      return null;
  }
}

/** Positions, open orders and history across every market, as tabs. */
export function AccountTabs({ className = "panel tight" }: { className?: string }) {
  const w = useWallet();
  const acct = useLiveAccount();
  const [tab, setTab] = useState<Tab>("positions");
  const used = useMemo(() => [...acct.snaps.values()].filter(usesMarket).sort((a, b) => a.market.index - b.market.index), [acct.snaps]);
  const openOrders = used.reduce((n, s) => n + s.orders.length, 0);
  const openPositions = used.filter((s) => s.hasPosition).length;
  return (
    <section className={className}>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)} role="tab" aria-selected={tab === t.id}>
            {t.label}
            {t.id === "positions" && openPositions ? ` (${openPositions})` : t.id === "orders" && openOrders ? ` (${openOrders})` : ""}
          </button>
        ))}
      </div>
      {!w.address ? (
        <Empty title="Connect a wallet to see your positions, orders and history" action={<button className="primary" onClick={w.openConnect}>Connect wallet</button>} />
      ) : tab === "positions" ? (
        !acct.loaded ? <Loading /> : <PositionsTable snaps={used} onChanged={acct.refresh} />
      ) : tab === "orders" ? (
        !acct.loaded ? <Loading /> : <OrdersTable snaps={used} />
      ) : (
        <History tab={tab} user={w.address} />
      )}
    </section>
  );
}
