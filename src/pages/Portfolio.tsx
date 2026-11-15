import { account } from "@liberta-labs/bazaar-sdk";
import { useMemo } from "react";
import { AccountTabs } from "../components/AccountTabs";
import { AdlWarning } from "../components/Adl";
import { HistoryLag } from "../components/HistoryLag";
import { PortfolioSummary } from "../components/PortfolioSummary";
import { Empty } from "../components/ui";
import { useBoard, useWallet } from "../state/connection";
import { useLiveAccount, usesMarket } from "../state/data";

/** Everything about the account in one place: the summary up top, then its balances, positions, orders and history. */
export function PortfolioPage() {
  const w = useWallet();
  const acct = useLiveAccount();
  const { prices } = useBoard();
  const used = useMemo(() => [...acct.snaps.values()].filter(usesMarket).sort((a, b) => a.market.index - b.market.index), [acct.snaps]);

  if (!w.address) {
    return <Empty title="Connect to see your portfolio" action={<button className="primary" onClick={w.openConnect}>Connect</button>} />;
  }

  return (
    <>
      <h1>Portfolio</h1>
      {used.map((s) => {
        const live = prices?.price(s.market.address);
        const h = s.hasPosition ? (live ? account.accountHealth(s, live) : s.health) : null;
        return <AdlWarning key={s.market.address} s={s} health={h} showMarket onChanged={acct.refresh} />;
      })}
      <HistoryLag />
      <PortfolioSummary user={w.address} />
      <AccountTabs defaultTab="balances" />
    </>
  );
}
