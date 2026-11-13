/** The account on this market, under the ticket: equity, margin and what can be withdrawn, with Deposit and Withdraw. */
import { type account, fromUsdcUnits, type markets } from "@liberta-labs/bazaar-sdk";
import { useState } from "react";
import { signedUsd, usd } from "../lib/format";
import { useWallet } from "../state/connection";
import { useLiveHealth } from "../state/data";
import { AdlMeter, AdlWarning, positionAdl } from "./Adl";
import { CollateralPanel } from "./Collateral";
import { Modal } from "./Modal";
import { Pnl, Term } from "./ui";

export function AccountCard({ market, snap, acct, onDone }: { market: markets.MarketInfo; snap: markets.MarketSnapshot | undefined; acct: account.AccountSnapshot | undefined; onDone: () => void }) {
  const w = useWallet();
  const health = useLiveHealth(acct);
  const [dialog, setDialog] = useState<"deposit" | "withdraw" | null>(null);
  const collateral = acct?.position.collateral ?? 0n;
  const equity = collateral + (health?.totalPnl ?? 0n);
  return (
    <section className="panel account-card">
      <div className="spread">
        <span className="muted small">
          <Term t="equity">Equity</Term> on {market.label}
        </span>
        {health && <span className={`badge ${health.marginRatio < 1.5 ? "bad" : "mine"}`}>ratio {health.marginRatio.toFixed(2)}</span>}
      </div>
      <div className="big-num">{w.address ? usd(equity) : "$0.00"}</div>
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <button className="grow" onClick={() => setDialog("deposit")}>
          Deposit
        </button>
        <button className="grow" onClick={() => setDialog("withdraw")}>
          Withdraw
        </button>
      </div>
      <div className="kv small">
        <span>
          <Term t="collateral">Collateral</Term>
        </span>
        <span>{usd(collateral)}</span>
        <span>
          <Term t="unrealized">Unrealized P&L</Term>
        </span>
        <span>{health ? <Pnl value={health.totalPnl}>{signedUsd(health.totalPnl)}</Pnl> : "–"}</span>
        <span>
          <Term t="margin">Maintenance margin</Term>
        </span>
        <span>{health ? usd(health.maintenanceRequired) : "–"}</span>
        <span>
          <Term t="adl">ADL rank</Term>
        </span>
        <span>
          <AdlMeter risk={acct ? positionAdl(acct, health) : null} />
        </span>
        <span>Withdrawable</span>
        <span>{acct ? usd(acct.maxWithdrawable) : "–"}</span>
        <span>Wallet USDC</span>
        <span>{acct ? usd(fromUsdcUnits(acct.wallet.usdcBalance)) : "–"}</span>
      </div>
      {acct && <AdlWarning s={acct} health={health} onChanged={onDone} />}
      <p className="small muted" style={{ margin: 0 }}>
        Collateral is held per market; this is your {market.label} account.
      </p>
      {dialog && (
        <Modal title={`${market.label} collateral`} onClose={() => setDialog(null)}>
          <CollateralPanel
            market={market}
            snap={snap}
            acct={acct}
            defaultTab={dialog}
            onDone={() => {
              setDialog(null);
              onDone();
            }}
          />
        </Modal>
      )}
    </section>
  );
}
