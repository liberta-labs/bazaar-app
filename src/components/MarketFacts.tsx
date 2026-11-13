import { markets as mk, previews, toNumber18 } from "@liberta-labs/bazaar-sdk";
import { useMemo } from "react";
import { GLOSSARY } from "../lib/glossary";
import { type TradingHoursText, tradingHours } from "../lib/hours";
import { bp, dateTime, leverage, pct, price, rate18, relative, sizeText, usd } from "../lib/format";
import { StatusBadge, Term, Tip } from "./ui";

/** Hours a trading-hours market accrues funding in a year (about a US equity session's). */
const SESSION_HOURS = 1_700;

const HOURS_LABEL: Record<TradingHoursText["kind"], string> = { "24/7": "24/7", "24/5": "24/5", hours: "Market hours" };
/** Keeps a time range, or a time zone's name, on one line when the column is narrow. */
const NOWRAP = { whiteSpace: "nowrap" } as const;

export function MarketFacts({ snap, oracle }: { snap: mk.MarketSnapshot; oracle: bigint | null }) {
  const m = snap.market;
  // When Pyth prices the market's feeds, from its registry; null when the registry wasn't read.
  const hours = useMemo(() => (m.continuous ? null : tradingHours(m.legFeeds)), [m]);
  const maxLev = previews.maxLeverage(snap.margin.imrBp);
  const warmup = snap.warmup;
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
      {warmup?.active && (
        <>
          <span>
            <Term t="warmup">New-market cap</Term>
          </span>
          <span>
            {leverage(warmup.maxLeverage)} until both
            <div className="small muted">
              15 days old: {snap.timestamp >= warmup.ageClearsAt ? "done" : dateTime(warmup.ageClearsAt)}
            </div>
            <div className="small muted">
              Prices stored: {warmup.pricesStored.toLocaleString("en-US")} / {warmup.pricesNeeded.toLocaleString("en-US")}
            </div>
          </span>
        </>
      )}
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
          <>
            <Tip text={GLOSSARY.tradingHours}>
              <span className="term">
                {hours ? HOURS_LABEL[hours.kind] : "Venue hours"}
                {snap.venueClosed ? " (closed now)" : ""}
              </span>
            </Tip>
            {hours?.text && (
              <div className="small muted">
                <span style={NOWRAP}>{hours.text}</span> <span style={NOWRAP}>{hours.zone} time</span>
              </div>
            )}
            {hours?.local && (
              <div className="small muted">
                <span style={NOWRAP}>{hours.local}</span> <span style={NOWRAP}>your time</span>
              </div>
            )}
            {hours?.holidays && <div className="small muted">Closed or shorter on market holidays</div>}
          </>
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
