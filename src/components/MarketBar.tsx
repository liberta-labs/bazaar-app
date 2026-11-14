/**
 * The bar above the chart: a market switcher, then the market's numbers at a glance. Funding on
 * Bazaar accrues continuously with every stored price, so it shows the hourly rate and its yearly
 * equivalent rather than a countdown to a payment.
 */
import { markets as mk, previews } from "@liberta-labs/bazaar-sdk";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dayChange } from "../lib/board";
import { leverage, pct, price, rate18, signedPct, usd } from "../lib/format";
import { assetName } from "../lib/assetName";
import { fundingHoursPerYear, hoursLabel } from "../lib/hours";
import { useBoard, useRead } from "../state/connection";
import { useDayStats } from "../state/data";
import { PriceAge, StatusBadge, Term, Tip } from "./ui";
import { AssetIcon } from "./AssetIcon";


export function MarketBar({ info, snap, spot, stored }: { info: mk.MarketInfo; snap: mk.MarketSnapshot | undefined; spot: { spot: bigint; publishTime: number } | null; stored: boolean }) {
  const { markets: list } = useRead();
  const { prices } = useBoard();
  const day = useDayStats();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const name = assetName(info);
  const d = day.get(info.address);
  const day24 = dayChange(spot?.spot, prices?.dayAgo(info.address), d?.open);
  const change = day24?.change ?? null;
  const changePct = day24?.pct ?? null;
  const maxLev = snap ? previews.maxLeverage(snap.margin.imrBp) : null;
  const funding = snap?.funding.currentRatePerHour ?? null;
  const oi = snap ? snap.openInterest.longNotional + snap.openInterest.shortNotional : null;

  return (
    <div className="market-bar">
      <div className="market-pick" ref={box}>
        <button className="market-pick-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
          <span className="market-name">
            <AssetIcon market={info} size={24} />
            <span className="market-title">
              <b>{info.label}</b>
              {/* What it trades, under the ticker: from the listing's description, shown as text. */}
              {name && (
                <span className="market-sub" title={name}>
                  {name}
                </span>
              )}
            </span>
          </span>
          {maxLev !== null && <span className="badge">{leverage(maxLev).replace(".00", "")}</span>}
          <span className="muted">▾</span>
        </button>
        {open && (
          <div className="menu market-menu" role="listbox">
            {list.map((m) => {
              const p = prices?.price(m.address);
              const ch = dayChange(p?.spot, prices?.dayAgo(m.address), day.get(m.address)?.open)?.pct ?? null;
              return (
                <button
                  key={m.address}
                  role="option"
                  aria-selected={m.address === info.address}
                  onClick={() => {
                    setOpen(false);
                    navigate(`/market/${m.address}`);
                  }}
                >
                  <span className="spread" style={{ width: "100%" }}>
                    <span className="market-name">
                      <AssetIcon market={m} size={18} />
                      <b>{m.label}</b>
                    </span>
                    <span className="mono">{p ? price(p.spot) : "–"}</span>
                  </span>
                  <span className="spread small" style={{ width: "100%" }}>
                    <span className="muted">{hoursLabel(m)}</span>
                    <span className={ch === null ? "muted" : ch >= 0 ? "up" : "down"}>{ch === null ? "–" : signedPct(ch)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="bar-stat">
        <span className="label">
          <Term t="mark">Mark</Term>
        </span>
        <span className="mono">{snap && snap.markPrice > 0n ? price(snap.markPrice) : "–"}</span>
      </div>
      <div className="bar-stat">
        <span className="label">
          <Term t="oracle">Oracle</Term>
        </span>
        <span className="mono">{spot ? price(spot.spot) : "–"}</span>
        <PriceAge publishTime={spot?.publishTime ?? null} confidenceOk={prices?.confidenceOk(info.address)} venueClosed={snap?.venueClosed === true} stored={stored} />
      </div>
      <div className="bar-stat">
        <span className="label">24h change</span>
        <span className={`mono ${change === null ? "" : change >= 0n ? "up" : "down"}`}>
          {change === null ? "–" : `${change >= 0n ? "+" : "-"}${price(change < 0n ? -change : change).replace("$", "")} / ${signedPct(changePct)}`}
        </span>
      </div>
      <div className="bar-stat">
        <span className="label">24h volume</span>
        <span className="mono">{d ? usd(d.volume) : "–"}</span>
      </div>
      <div className="bar-stat">
        <span className="label">
          <Term t="openInterest">Open interest</Term>
        </span>
        <span className="mono">{oi !== null ? usd(oi) : "–"}</span>
      </div>
      <div className="bar-stat">
        <span className="label">
          <Term t="funding">Funding (1h)</Term>
        </span>
        {funding !== null ? (
          <Tip text={`Annualized: ${pct(mk.annualizedFunding(funding, fundingHoursPerYear(info)))}`}>
            <span className={`mono ${funding > 0n ? "down" : funding < 0n ? "up" : ""}`}>{rate18(funding)}</span>
          </Tip>
        ) : (
          <span className="mono">–</span>
        )}
      </div>
      <div className="bar-stat">
        <span className="label">
          <Term t="insurance">Insurance</Term>
        </span>
        <span className="mono">{snap ? usd(snap.insurance.fund) : "–"}</span>
      </div>
      {snap && (
        <div className="bar-stat">
          <span className="label">Status</span>
          <StatusBadge status={snap.status} />
        </div>
      )}
    </div>
  );
}
