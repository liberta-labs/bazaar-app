/**
 * Every place the account's money sits, one row each: the wallet's USDC, each market's collateral, each
 * insurance stake and each market's claimable fees, with what can be done there.
 */
import { account, formatUnits18, fromUsdcUnits, type markets } from "@liberta-labs/bazaar-sdk";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import type { Address } from "viem";
import { amount, pct, signedUsd, usd } from "../lib/format";
import { claimFeesPart } from "../lib/jobs";
import { useBoard, useRead, useWallet } from "../state/connection";
import { useInsuranceStakes } from "../state/insurance";
import { useTx } from "../state/tx";
import { AssetIcon } from "./AssetIcon";
import { CollateralPanel } from "./Collateral";
import { ExportCsv } from "./ExportCsv";
import { Modal } from "./Modal";
import { TableTools } from "./TableTools";
import { useSort } from "../state/sort";
import { ActionButton, Empty, Pnl, Term, Tip } from "./ui";

/** Under a dollar counts as small. */
const SMALL = 10n ** 18n;

type AssetType = "Wallet" | "Collateral" | "Insurance" | "Claimable";

interface Row {
  readonly key: string;
  readonly asset: ReactNode;
  /** The asset's name, to sort by. */
  readonly name: string;
  readonly type: AssetType;
  readonly total: ReactNode;
  readonly available: ReactNode;
  /** What Total and Available sort by: shares for a stake, dollars otherwise. */
  readonly totalAmount: bigint;
  readonly availableAmount: bigint | null;
  readonly value: bigint;
  readonly pnl: { readonly amount: bigint; readonly base: bigint } | null;
  readonly actions: ReactNode;
}

function Asset({ m }: { m: markets.MarketInfo }) {
  return (
    <span className="market-name">
      <AssetIcon market={m} size={18} />
      <Link to={`/market/${m.address}`}>{m.label}</Link>
    </span>
  );
}

const TYPE_TIP: Record<AssetType, string> = {
  Wallet: "USDC in your wallet, ready to deposit.",
  Collateral: "Collateral on one market: it backs your positions there and is withdrawable when they allow.",
  Insurance: "Shares in a market's insurance fund. Leaving takes a request, a 13-day cooldown and a window to collect.",
  Claimable: "Refunded bounties and rewards the market owes you. Claim them to your wallet.",
};

export function BalancesTable({ snaps }: { snaps: readonly account.AccountSnapshot[] }) {
  const w = useWallet();
  const tx = useTx();
  const { markets: list } = useRead();
  const { prices } = useBoard();
  const stakes = useInsuranceStakes(w.address);
  const [hideSmall, setHideSmall] = useState(false);
  const [dialog, setDialog] = useState<null | { kind: "deposit" | "withdraw"; s: account.AccountSnapshot }>(null);
  const market = (p: Address) => list.find((m) => m.address.toLowerCase() === p.toLowerCase());

  const rows: Row[] = [];
  const walletUsdc = snaps[0] ? fromUsdcUnits(snaps[0].wallet.usdcBalance) : null;
  if (walletUsdc !== null) {
    rows.push({
      key: "wallet",
      asset: <b>USDC</b>,
      name: "USDC",
      type: "Wallet",
      total: usd(walletUsdc),
      available: usd(walletUsdc),
      totalAmount: walletUsdc,
      availableAmount: walletUsdc,
      value: walletUsdc,
      pnl: null,
      actions: null,
    });
  }
  for (const s of snaps) {
    if (s.position.collateral === 0n && !s.hasPosition) continue;
    const live = prices?.price(s.market.address);
    const h = s.hasPosition ? (live ? account.accountHealth(s, live) : s.health) : null;
    rows.push({
      key: `c-${s.market.address}`,
      asset: <Asset m={s.market} />,
      name: s.market.label,
      type: "Collateral",
      total: usd(s.position.collateral),
      available: usd(s.maxWithdrawable),
      totalAmount: s.position.collateral,
      availableAmount: s.maxWithdrawable,
      value: s.position.collateral + (h?.totalPnl ?? 0n),
      pnl: h ? { amount: h.totalPnl, base: s.position.collateral } : null,
      actions: (
        <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
          <button className="small" onClick={() => setDialog({ kind: "deposit", s })}>
            Deposit
          </button>
          <button className="small" onClick={() => setDialog({ kind: "withdraw", s })}>
            Withdraw
          </button>
        </div>
      ),
    });
  }
  for (const k of stakes.data ?? []) {
    const m = market(k.pair);
    if (!m) continue;
    rows.push({
      key: `i-${k.pair}`,
      asset: <Asset m={m} />,
      name: m.label,
      type: "Insurance",
      total: `${amount(k.shares, 4)} shares`,
      available: k.requestedShares > 0n ? `${amount(k.requestedShares, 4)} requested` : "after a withdrawal",
      totalAmount: k.shares,
      availableAmount: k.requestedShares > 0n ? k.requestedShares : null,
      value: k.value,
      pnl: { amount: k.value + k.withdrawn - k.deposited, base: k.deposited },
      actions: (
        <Link to="/earn" className="btn small">
          Manage
        </Link>
      ),
    });
  }
  for (const s of snaps) {
    if (s.claimableFees === 0n) continue;
    rows.push({
      key: `f-${s.market.address}`,
      asset: <Asset m={s.market} />,
      name: s.market.label,
      type: "Claimable",
      total: usd(s.claimableFees),
      available: usd(s.claimableFees),
      totalAmount: s.claimableFees,
      availableAmount: s.claimableFees,
      value: s.claimableFees,
      pnl: null,
      actions: (
        <ActionButton
          className="small"
          onClick={() =>
            void tx.run({
              title: `Claim on ${s.market.label}`,
              summary: [`Send ${usd(s.claimableFees)} you're owed on ${s.market.label} to your wallet.`, "Sent from your wallet: it needs a little ETH for gas."],
              parts: [claimFeesPart(s.market.address)],
            })
          }
        >
          Claim
        </ActionButton>
      ),
    });
  }

  const visible = hideSmall ? rows.filter((r) => r.value >= SMALL) : rows;
  const { sorted: shown, th } = useSort(visible, {
    asset: (r) => r.name,
    type: (r) => r.type,
    total: (r) => r.totalAmount,
    available: (r) => r.availableAmount,
    value: (r) => r.value,
    pnl: (r) => r.pnl?.amount,
  });
  const total = rows.reduce((t, r) => t + r.value, 0n);
  if (!rows.length) return <Empty title="Nothing here yet">Get test USDC, then deposit on a market to trade or insure it.</Empty>;
  return (
    <>
      <TableTools>
        <span className="small muted">
          Total value <b className="mono">{usd(total)}</b>
          {stakes.loading && !stakes.data ? " (reading insurance…)" : ""}
        </span>
        <label className="check small">
          <input type="checkbox" checked={hideSmall} onChange={(e) => setHideSmall(e.target.checked)} /> Hide balances under $1
        </label>
        <ExportCsv
          filename="bazaar-balances.csv"
          rows={shown}
          columns={[
            { header: "asset", value: (r) => r.name },
            { header: "type", value: (r) => r.type.toLowerCase() },
            // Shares for an insurance stake, US dollars for the rest.
            { header: "total", value: (r) => formatUnits18(r.totalAmount) },
            { header: "total_unit", value: (r) => (r.type === "Insurance" ? "shares" : "usd") },
            { header: "available", value: (r) => (r.availableAmount === null ? "" : formatUnits18(r.availableAmount)) },
            { header: "value_usd", value: (r) => formatUnits18(r.value) },
            { header: "pnl_usd", value: (r) => (r.pnl ? formatUnits18(r.pnl.amount) : "") },
            { header: "roe", value: (r) => (r.pnl && r.pnl.base > 0n ? Number((r.pnl.amount * 1_000_000n) / r.pnl.base) / 1_000_000 : "") },
          ]}
        />
      </TableTools>
      <div className="table-wrap">
        <table className="rtable">
          <thead>
            <tr>
              <th {...th("asset")}>Asset</th>
              <th {...th("type")}>Type</th>
              <th {...th("total", "num")}>Total</th>
              <th {...th("available", "num")}>Available</th>
              <th {...th("value", "num")}>Value (USD)</th>
              <th {...th("pnl", "num")}>
                <Term t="unrealized">P&L (ROE %)</Term>
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key}>
                <td data-main="">{r.asset}</td>
                <td data-label="Type">
                  <Tip text={TYPE_TIP[r.type]}>
                    <span className={`badge${r.type === "Insurance" ? " mine" : ""}`}>{r.type}</span>
                  </Tip>
                </td>
                <td data-label="Total" className="num">{r.total}</td>
                <td data-label="Available" className="num">{r.available}</td>
                <td data-label="Value" className="num">{usd(r.value)}</td>
                <td data-label="P&L (ROE %)" className="num">
                  {r.pnl ? (
                    <Pnl value={r.pnl.amount}>
                      {signedUsd(r.pnl.amount)}
                      {r.pnl.base > 0n && <span className="small"> ({pct(Number((r.pnl.amount * 10_000n) / r.pnl.base) / 10_000, 1)})</span>}
                    </Pnl>
                  ) : (
                    <span className="muted">–</span>
                  )}
                </td>
                <td data-actions="" className="right">
                  {r.actions}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length && <p className="small muted" style={{ padding: "0 10px" }}>Every balance is under $1.</p>}
      {dialog && (
        <Modal title={`${dialog.s.market.label} collateral`} onClose={() => setDialog(null)}>
          <CollateralPanel market={dialog.s.market} snap={undefined} acct={dialog.s} defaultTab={dialog.kind} onDone={() => setDialog(null)} />
        </Modal>
      )}
    </>
  );
}
