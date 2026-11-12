import { account } from "@liberta-labs/bazaar-sdk";
import { useMemo } from "react";
import { AccountTabs } from "../components/AccountTabs";
import { HistoryLag } from "../components/HistoryLag";
import { Empty, Pnl, Term } from "../components/ui";
import { signedUsd, usd } from "../lib/format";
import { useBoard, useWallet } from "../state/connection";
import { useLiveAccount, usesMarket } from "../state/data";

export function PortfolioPage() {
  const w = useWallet();
  const acct = useLiveAccount();
  const { prices } = useBoard();
  const used = useMemo(() => [...acct.snaps.values()].filter(usesMarket).sort((a, b) => a.market.index - b.market.index), [acct.snaps]);

  const totals = useMemo(() => {
    let collateral = 0n;
    let equity = 0n;
    let upnl = 0n;
    let fpnl = 0n;
    for (const s of used) {
      collateral += s.position.collateral;
      const live = prices?.price(s.market.address);
      const h = s.hasPosition ? (live ? account.accountHealth(s, live) : s.health) : null;
      equity += s.position.collateral + (h?.totalPnl ?? 0n);
      upnl += h?.unrealizedPnl ?? 0n;
      fpnl += h?.fundingPnl ?? 0n;
    }
    return { collateral, equity, upnl, fpnl };
  }, [used, prices]);

  if (!w.address) {
    return <Empty title="Connect a wallet to see your portfolio" action={<button className="primary" onClick={w.openConnect}>Connect wallet</button>} />;
  }

  return (
    <>
      <h1>Portfolio</h1>
      <div className="cards" style={{ marginBottom: 12 }}>
        <div className="stat">
          <div className="label">
            <Term t="collateral">Collateral</Term>
          </div>
          <div className="value">{usd(totals.collateral)}</div>
        </div>
        <div className="stat">
          <div className="label">
            <Term t="equity">Equity</Term>
          </div>
          <div className="value">{usd(totals.equity)}</div>
        </div>
        <div className="stat">
          <div className="label">
            <Term t="unrealized">Unrealized P&L</Term>
          </div>
          <div className="value">
            <Pnl value={totals.upnl}>{signedUsd(totals.upnl)}</Pnl>
          </div>
        </div>
        <div className="stat">
          <div className="label">
            <Term t="fundingPnl">Funding P&L</Term>
          </div>
          <div className="value">
            <Pnl value={totals.fpnl}>{signedUsd(totals.fpnl)}</Pnl>
          </div>
        </div>
      </div>
      <HistoryLag />
      <AccountTabs />
    </>
  );
}
