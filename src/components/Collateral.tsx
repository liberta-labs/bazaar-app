/**
 * Collateral on one market. Each market holds its own collateral, so deposits and withdrawals happen
 * here, on the market page, and the panel says so.
 */
import { fromUsdcUnits, type account, type markets, MIN_COLLATERAL_DEPOSIT } from "@liberta-labs/bazaar-sdk";
import { useEffect, useState } from "react";
import { ACTIVE } from "../config/networks";
import { explain } from "../lib/errors";
import { parseInput, toInput, usd, usdcUnits } from "../lib/format";
import { depositPart, forAccount, withdrawPart } from "../lib/jobs";
import { CONTRACT_WALLET_REASON } from "../lib/wallet";
import { useBoard, useRead, useWallet } from "../state/connection";
import { useTx } from "../state/tx";
import { FaucetButton } from "./Faucet";
import { TestUsdcHelpLink } from "./TestUsdcHelp";
import { ActionButton, Term } from "./ui";

export function CollateralPanel({
  market,
  snap,
  acct,
  defaultTab = "deposit",
  onDone,
}: {
  market: markets.MarketInfo;
  snap: markets.MarketSnapshot | undefined;
  acct: account.AccountSnapshot | undefined;
  defaultTab?: "deposit" | "withdraw";
  onDone?: () => void;
}) {
  const w = useWallet();
  const tx = useTx();
  const { readBz } = useRead();
  const { prices } = useBoard();
  const [tab, setTab] = useState(defaultTab);
  const [text, setText] = useState("");
  const [withdrawCheck, setWithdrawCheck] = useState<string | null>(null);
  const value = parseInput(text);
  const walletUsdc = acct ? fromUsdcUnits(acct.wallet.usdcBalance) : null;
  const collateral = acct?.position.collateral ?? 0n;
  const busy = tx.busy(market.address);

  useEffect(() => setTab(defaultTab), [defaultTab]);

  // A withdrawal is checked against the pair's own limits at the board's price.
  useEffect(() => {
    setWithdrawCheck(null);
    if (tab !== "withdraw" || !readBz || !w.address || !value || value <= 0n) return;
    let dead = false;
    const p = prices?.price(market.address);
    const t = setTimeout(() => {
      readBz.previews
        .previewWithdrawal(market.address, w.address!, value, p ? { price: p } : undefined)
        .then((r) => !dead && setWithdrawCheck(r.ok === false ? (r.blocker?.message ?? "This amount can't be withdrawn now.") : null))
        .catch((e) => !dead && setWithdrawCheck(explain(e)));
    }, 300);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [tab, readBz, w.address, value, market.address, prices]);

  let reason: string | null = null;
  if (!w.address) reason = null;
  else if (busy) reason = "Your last request on this market is still landing.";
  else if (value === null || value <= 0n) reason = "Enter an amount.";
  else if (tab === "deposit") {
    if (value < MIN_COLLATERAL_DEPOSIT) reason = "The minimum deposit is 5 USDC.";
    else if (walletUsdc !== null && value > walletUsdc) reason = `Your wallet holds ${usd(walletUsdc)}.`;
    else if (snap && (snap.status === "terminated" || snap.status === "settling" || snap.status === "limbo")) reason = "Deposits are closed: this market is ending.";
  } else {
    if (!w.canSign) reason = CONTRACT_WALLET_REASON;
    else if (acct?.withdrawalBlocked) reason = acct.withdrawalBlocked;
    else if (acct && value > acct.maxWithdrawable) reason = `You can withdraw up to ${usd(acct.maxWithdrawable)} now; the rest backs your position and orders.`;
    else if (withdrawCheck) reason = withdrawCheck;
  }

  const submit = () => {
    if (!w.address) return w.openConnect();
    if (!value) return;
    const part = tab === "deposit" ? forAccount(depositPart(market.address, value), w.canSign) : withdrawPart(market.address, value);
    void tx
      .run({
        title: tab === "deposit" ? `Deposit on ${market.label}` : `Withdraw from ${market.label}`,
        summary:
          tab === "deposit"
            ? [`Move ${usd(value)} USDC from your wallet into your ${market.label} collateral.`, "It backs your positions and orders on this market only."]
            : [`Move ${usd(value)} USDC from your ${market.label} collateral back to your wallet.`],
        parts: [part],
        pair: market.address,
        onDone: () => {
          setText("");
          onDone?.();
        },
      });
  };

  return (
    <div className="stack">
      <div className="seg" role="tablist">
        <button className={tab === "deposit" ? "on" : ""} onClick={() => setTab("deposit")} role="tab" aria-selected={tab === "deposit"}>
          Deposit
        </button>
        <button className={tab === "withdraw" ? "on" : ""} onClick={() => setTab("withdraw")} role="tab" aria-selected={tab === "withdraw"}>
          Withdraw
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        <Term t="collateral">Collateral</Term> is held per market. This is your {market.label} collateral; other markets have their own.
      </p>
      <div className="kv">
        <span>In your wallet</span>
        <span>{acct ? `${usdcUnits(acct.wallet.usdcBalance)} USDC` : "–"}</span>
        <span>On {market.label}</span>
        <span>{usd(collateral)}</span>
        <span>Withdrawable now</span>
        <span>{acct ? usd(acct.maxWithdrawable) : "–"}</span>
      </div>
      <label className="field">
        Amount (USDC)
        <div className="input-wrap">
          <input className="num" inputMode="decimal" placeholder="0.00" value={text} onChange={(e) => setText(e.target.value)} />
          <span className="suffix">USDC</span>
        </div>
      </label>
      <div className="row">
        {tab === "deposit" && walletUsdc !== null && walletUsdc > 0n && (
          <button className="small ghost" onClick={() => setText(toInput(walletUsdc, 6))}>
            Max
          </button>
        )}
        {tab === "withdraw" && acct && acct.maxWithdrawable > 0n && (
          <button className="small ghost" onClick={() => setText(toInput(acct.maxWithdrawable, 6))}>
            Max
          </button>
        )}
      </div>
      {w.address && reason && value !== null && value > 0n && <div className="field-error">{reason}</div>}
      {!w.address ? (
        <button className="primary wide" onClick={w.openConnect}>
          Connect wallet to {tab}
        </button>
      ) : (
        <ActionButton className="primary wide" disabledReason={reason} onClick={submit}>
          {tab === "deposit" ? "Deposit" : "Withdraw"}
        </ActionButton>
      )}
      {tab === "deposit" && w.address && walletUsdc === 0n && ACTIVE.testnet && (
        <div className="callout small">
          Your wallet has no USDC yet. <FaucetButton compact onDone={onDone} /> <TestUsdcHelpLink />
        </div>
      )}
    </div>
  );
}
