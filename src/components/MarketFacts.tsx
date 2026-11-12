import { markets as mk, previews, toNumber18 } from "@liberta-labs/bazaar-sdk";
import { GLOSSARY } from "../lib/glossary";
import { bp, dateTime, leverage, pct, price, rate18, relative, sizeText, usd } from "../lib/format";
import { StatusBadge, Term, Tip } from "./ui";

/** Hours a trading-hours market accrues funding in a year (about a US equity session's). */
const SESSION_HOURS = 1_700;

export function MarketFacts({ snap, oracle }: { snap: mk.MarketSnapshot; oracle: bigint | null }) {
  const m = snap.market;
  const maxLev = previews.maxLeverage(snap.margin.imrBp);
  const funding = snap.funding.currentRatePerHour;
  const annual = mk.annualizedFunding(funding, m.continuous ? undefined : SESSION_HOURS);
  const oi = snap.openInterest;
  const targetFund = ((oi.longNotional + oi.shortNotional) * snap.insurance.targetRatioBp) / 10_000n;
  const markVsOracle = snap.markPrice > 0n && oracle ? toNumber18(snap.markPrice - oracle) / toNumber18(oracle) : null;
  return (
    <div className="kv">
      <span>Status</span>
      <span>
        <StatusBadge status={snap.status} />
      </span>
      <span>
        <Term t="leverage">Max leverage</Term>
      </span>
      <span>{leverage(maxLev)}</span>
      <span>
        <Term t="openInterest">Open interest</Term>
      </span>
      <span>
        <span className="up">{sizeText(oi.long)}</span> / <span className="down">{sizeText(oi.short)}</span>
        <div className="small muted">{usd(oi.longNotional + oi.shortNotional)}</div>
      </span>
      <span>
        <Term t="funding">Funding</Term>
      </span>
      <span>
        <span className={funding > 0n ? "down" : funding < 0n ? "up" : ""}>{rate18(funding)} / h</span>
        <div className="small muted">{pct(annual)} a year {funding > 0n ? "(longs pay)" : funding < 0n ? "(shorts pay)" : ""}</div>
      </span>
      <span>
        <Term t="mark">Mark</Term> vs <Term t="oracle">oracle</Term>
      </span>
      <span>
        {snap.markPrice > 0n ? price(snap.markPrice) : "–"} / {oracle ? price(oracle) : "–"}
        {markVsOracle !== null && <div className="small muted">{pct(markVsOracle, 3)}</div>}
      </span>
      <span>
        <Term t="insurance">Insurance fund</Term>
      </span>
      <span>
        {usd(snap.insurance.fund)}
        <div className="small muted">target {targetFund > 0n ? usd(targetFund) : bp(snap.insurance.targetRatioBp)} of open interest</div>
      </span>
      <span>
        <Term t="margin">Margin</Term>
      </span>
      <span>
        {bp(snap.margin.imrBp)} initial · {bp(snap.margin.effectiveMmrBp)} maintenance
      </span>
      <span>Trading hours</span>
      <span>
        {m.continuous ? (
          "24/7"
        ) : (
          <Tip text={GLOSSARY.tradingHours}>
            <span className="term">Venue hours{snap.venueClosed ? " (closed now)" : ""}</span>
          </Tip>
        )}
      </span>
      {snap.termination.scheduledTs > 0 && (
        <>
          <span>Scheduled end</span>
          <span>
            {dateTime(snap.termination.scheduledTs)}
            <div className="small muted">{relative(snap.termination.scheduledTs)}</div>
          </span>
        </>
      )}
      {snap.adl.pending && (
        <>
          <span>
            <Term t="adl">ADL</Term>
          </span>
          <span className="small">window open since {dateTime(snap.adl.pendingSince)}</span>
        </>
      )}
    </div>
  );
}
