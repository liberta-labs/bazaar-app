/**
 * A position's place in the auto-deleveraging queue: a five-bar meter, and a warning when the position
 * sits near the front while ADL could reach it, with the collateral or the close that moves it back.
 */
import { type account } from "@liberta-labs/bazaar-sdk";
import { useState } from "react";
import { ADL_WARN_SCORE, type AdlRisk, adlRemedy, adlRisk, scoreText } from "../lib/adlRisk";
import { amount, price, usd } from "../lib/format";
import { closeOrder, orderPart } from "../lib/jobs";
import { CONTRACT_WALLET_REASON } from "../lib/wallet";
import { useBoard, useRead, useWallet } from "../state/connection";
import { useTx } from "../state/tx";
import { CollateralPanel } from "./Collateral";
import { Modal } from "./Modal";
import { ActionButton, Tip } from "./ui";

const baseOf = (label: string) => label.split("/")[0] ?? "";
const CENT = 10n ** 16n;
const MIN_DEPOSIT = 5n * 10n ** 18n;

/** The position's ADL standing at its live health; null while flat or without a price. */
export function positionAdl(s: account.AccountSnapshot, health: account.PositionHealth | null): AdlRisk | null {
  if (!s.hasPosition || !health) return null;
  return adlRisk(s.position, health.totalPnl, s.state, Date.now() / 1000);
}

/** When in the 10-minute auction a position would qualify, in words. */
function whenText(after: number): string {
  if (after === 0) return "as soon as it starts";
  if (after < 60) return "within its first minute";
  const m = Math.round(after / 60);
  return `about ${m} minute${m === 1 ? "" : "s"} in`;
}

function meterText(r: AdlRisk): string {
  if (r.bars === 0) return "ADL rank: none. ADL only closes positions in profit.";
  const where = r.running
    ? `ADL is running here now${r.qualifiesNow ? ", and this position qualifies" : ""}.`
    : r.exposed
      ? `The vault holds liquidated ${r.against}, so ADL could reach this position.`
      : `The vault holds no liquidated ${r.against}, so ADL can't reach this position now.`;
  return `ADL rank ${r.bars} of 5: profit is ${scoreText(r.score)} the collateral. If ADL starts, this qualifies ${whenText(r.qualifiesAfter ?? 600)}. ${where} More collateral or taking profit lowers the rank.`;
}

/** Five bars, lit by how early in the ADL auction the position would qualify; the details on hover. */
export function AdlMeter({ risk }: { risk: AdlRisk | null }) {
  if (!risk) return <span className="muted">–</span>;
  return (
    <Tip text={meterText(risk)}>
      <span className={`adl-meter lvl-${risk.bars}${risk.exposed || risk.running ? "" : " calm"}`} role="img" aria-label={`ADL rank ${risk.bars} of 5`}>
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={i <= risk.bars ? "on" : undefined} />
        ))}
      </span>
    </Tip>
  );
}

/** Closes part of the position at market: its share of the profit moves into collateral. */
function ReduceButton({ s, size, profit }: { s: account.AccountSnapshot; size: bigint; profit: bigint }) {
  const tx = useTx();
  const w = useWallet();
  const { readBz } = useRead();
  const { prices } = useBoard();
  const spot = prices?.spot(s.market.address) ?? s.price?.spot ?? null;
  const base = baseOf(s.market.label);
  const taken = (profit * size) / s.position.size;
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
          title: `Take profit on ${s.market.label}`,
          summary: ["Moving profit into collateral lowers your profit-to-collateral ratio, which moves you back in the ADL queue."],
          review: {
            side: s.position.isLong ? "sell" : "buy",
            action: `${s.position.isLong ? "Sell" : "Buy"} ${amount(size)} ${base}`,
            detail: `At market, about ${spot ? price(spot) : "–"}`,
            sections: [
              {
                title: "Order",
                rows: [
                  { label: "Profit taken", value: `about ${usd(taken)} before fees` },
                  { label: "Fills within", value: "1% of the oracle price" },
                ],
              },
              {
                title: "After this order",
                rows: [{ label: "Position", value: `${s.position.isLong ? "Long" : "Short"} ${amount(s.position.size - size)} ${base}` }],
              },
            ],
          },
          pair: s.market.address,
          parts: [orderPart(readBz, s.market.address, closeOrder(s.position.isLong, size), null, "Take profit")],
        })
      }
    >
      Close {amount(size)} {base}
    </ActionButton>
  );
}

/**
 * A warning while ADL could reach the position: running now, or, before it starts, the position near
 * the front of the queue (four bars or more) with the vault holding liquidated positions on the other
 * side. Before it starts it says what moves the position back, and offers both; once it runs, nothing
 * can, so it only says so.
 */
export function AdlWarning({ s, health, showMarket = false, onChanged }: { s: account.AccountSnapshot; health: account.PositionHealth | null; showMarket?: boolean; onChanged?: () => void }) {
  const [depositing, setDepositing] = useState(false);
  const r = positionAdl(s, health);
  if (!r || !health || !r.exposed || r.score === 0n) return null;
  const on = showMarket ? ` on ${s.market.label}` : "";

  if (r.running) {
    return (
      <div className="callout bad small adl-warning" role="status">
        <b>
          ADL is running{on}
          {r.qualifiesNow ? ", and your position qualifies now." : "."}
        </b>{" "}
        Your profit is {scoreText(r.score)} your collateral{r.qualifiesNow ? "" : `; it would qualify ${whenText(r.qualifiesAfter ?? 600)}`}. Trading is paused until it clears, and
        collateral added now doesn't change your place in the queue.
      </div>
    );
  }
  if (r.score < ADL_WARN_SCORE) return null;

  const fix = adlRemedy(health.totalPnl, s.position.collateral, s.position.size);
  const add = fix ? (fix.addCollateral > MIN_DEPOSIT ? ((fix.addCollateral + CENT - 1n) / CENT) * CENT : MIN_DEPOSIT) : null;
  return (
    <div className="callout small adl-warning" role="status">
      <div>
        <b>You're near the front of the ADL queue{on}.</b> Your profit is {scoreText(r.score)} your collateral, and the vault holds liquidated {r.against} on the other side of your
        trade. If the insurance fund can't cover their loss, auto-deleveraging could close your position {whenText(r.qualifiesAfter ?? 600)}, at a price no better than the
        market's (never below break-even).
      </div>
      {fix && add !== null && (
        <>
          <div>
            Adding {usd(add)} of collateral, or closing {amount(fix.closeSize)} {baseOf(s.market.label)}, brings it under 4×.
          </div>
          <div className="row">
            <button className="small" onClick={() => setDepositing(true)}>
              Add {usd(add)}
            </button>
            <ReduceButton s={s} size={fix.closeSize} profit={health.totalPnl} />
          </div>
          {depositing && (
            <Modal title={`${s.market.label} collateral`} onClose={() => setDepositing(false)}>
              <CollateralPanel market={s.market} snap={undefined} acct={s} defaultTab="deposit" defaultAmount={add} onDone={() => (setDepositing(false), onChanged?.())} />
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
