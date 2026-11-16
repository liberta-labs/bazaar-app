/**
 * The bar above the chart: a market switcher, then the market's numbers at a glance. Funding on
 * Bazaar accrues continuously with every stored price, so it shows the hourly rate and its yearly
 * equivalent rather than a countdown to a payment.
 */
import { markets as mk, previews } from "@liberta-labs/bazaar-sdk";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { dayChange } from "../lib/board";
import { leverageShort, pct, price, rateTone, signedPct, signedRate18, usd } from "../lib/format";
import { assetName } from "../lib/assetName";
import { fundingHoursPerYear, hoursLabel } from "../lib/hours";
import { openInterestNotional } from "../lib/openInterest";
import { useBoard, useRead } from "../state/connection";
import { useDayStats, useMarketSnapshots } from "../state/data";
import { PriceAge, StatusBadge, Term, Tip } from "./ui";
import { AssetIcon } from "./AssetIcon";
import { LeverageBadge } from "./LeverageBadge";
import { MarketFilterChips, matchesSearch, useMarketFilter } from "./MarketFilters";
import { StarButton, StarIcon } from "./StarButton";

/**
 * The switcher's markets, each with its price, max leverage, trading hours and day's change. Mounted only
 * while the list is open, so every market's snapshot is read only then.
 */
function MarketMenuRows({ rows, current, onPick }: { rows: readonly mk.MarketInfo[]; current: mk.MarketInfo; onPick: (m: mk.MarketInfo) => void }) {
  const { prices } = useBoard();
  const day = useDayStats();
  const { snaps } = useMarketSnapshots();
  return rows.map((m) => {
    const p = prices?.price(m.address);
    const ch = dayChange(p?.spot, prices?.dayAgo(m.address), day.get(m.address)?.open)?.pct ?? null;
    const here = m.address === current.address;
    return (
      <div key={m.address} className={`market-menu-row${here ? " current" : ""}`}>
        <button type="button" className="market-menu-item" aria-current={here ? "page" : undefined} onClick={() => onPick(m)}>
          <span className="spread">
            <span className="market-name">
              <AssetIcon market={m} size={18} />
              <b>{m.label}</b>
              <LeverageBadge snap={snaps.get(m.address)} tip={false} />
            </span>
            <span className="mono">{p ? price(p.spot) : "–"}</span>
          </span>
          <span className="spread small">
            <span className="muted">{hoursLabel(m)}</span>
            <span className={ch === null ? "muted" : ch >= 0 ? "up" : "down"}>{ch === null ? "–" : signedPct(ch)}</span>
          </span>
        </button>
        <StarButton market={m} />
      </div>
    );
  });
}

/**
 * The market switcher: the current market's button, opening a search box, the filter chips the markets
 * page has (with their own remembered pick) and every market, each with its watchlist star. Typing
 * filters as you go and Enter opens the first match; the arrow keys move down the list and Escape closes.
 */
function MarketPicker({ info, maxLev }: { info: mk.MarketInfo; maxLev: number | null }) {
  const { markets: list } = useRead();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const show = useMarketFilter(list, "bazaar.pickerFilter");
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const items = useRef<HTMLDivElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    setQ("");
    if (refocus) btn.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setQ("");
      }
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);
  // On a computer the search box takes the keyboard at once; on a phone that would raise the
  // on-screen keyboard over the list, so it waits for a tap.
  useEffect(() => {
    if (open && window.matchMedia("(pointer: fine)").matches) search.current?.focus();
  }, [open]);

  const name = assetName(info);
  const needle = q.trim().toLowerCase();
  const rows = list.filter((m) => show.inFilter(m) && matchesSearch(m, needle));
  // Matches the search finds outside the picked filter, offered when it finds none inside it.
  const elsewhere = show.filter !== "all" && needle ? list.filter((m) => matchesSearch(m, needle)).length : 0;
  const go = (m: mk.MarketInfo) => {
    close(false);
    navigate(`/market/${m.address}`);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = [...(items.current?.querySelectorAll<HTMLElement>(".market-menu-row") ?? [])];
    if (!all.length) return;
    e.preventDefault();
    const at = all.findIndex((r) => r.contains(document.activeElement));
    const to = (i: number) => all[i]?.querySelector<HTMLButtonElement>(".market-menu-item")?.focus();
    if (at < 0) {
      if (e.key === "ArrowDown") to(0);
    } else if (e.key === "ArrowUp" && at === 0) {
      search.current?.focus();
    } else {
      to(Math.min(all.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
    }
  };

  return (
    <div className="market-pick" ref={box} onKeyDown={open ? onKeyDown : undefined}>
      <button ref={btn} className="market-pick-btn" onClick={() => (open ? close(false) : setOpen(true))} aria-haspopup="dialog" aria-expanded={open}>
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
        {maxLev !== null && <span className="badge">{leverageShort(maxLev)}</span>}
        <span className="muted">▾</span>
      </button>
      {open && (
        <div className="menu market-menu" role="dialog" aria-label="Markets">
          <div className="market-menu-head">
            <input
              ref={search}
              type="search"
              placeholder={`Search ${list.length} markets`}
              aria-label="Search markets"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && rows[0]) {
                  e.preventDefault();
                  go(rows[0]);
                }
              }}
            />
          </div>
          <MarketFilterChips state={show} />
          <div className="market-menu-list" ref={items}>
            <MarketMenuRows rows={rows} current={info} onPick={go} />
            {rows.length === 0 && (
              <div className="market-menu-empty small muted">
                {needle ? (
                  elsewhere > 0 ? (
                    <>
                      No match in {show.label}.{" "}
                      <button type="button" className="link" onClick={() => show.pick("all")}>
                        Search all markets ({elsewhere})
                      </button>
                    </>
                  ) : (
                    "No market matches your search."
                  )
                ) : show.filter === "watchlist" ? (
                  <>
                    Your watchlist is empty. Star a market with <StarIcon filled={false} size={12} /> to keep it here.
                  </>
                ) : (
                  "No markets yet."
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function MarketBar({ info, snap, spot, stored }: { info: mk.MarketInfo; snap: mk.MarketSnapshot | undefined; spot: { spot: bigint; publishTime: number } | null; stored: boolean }) {
  const { prices } = useBoard();
  const day = useDayStats();
  const d = day.get(info.address);
  const day24 = dayChange(spot?.spot, prices?.dayAgo(info.address), d?.open);
  const change = day24?.change ?? null;
  const changePct = day24?.pct ?? null;
  const maxLev = snap ? previews.maxLeverage(snap.margin.imrBp) : null;
  const funding = snap?.funding.currentRatePerHour ?? null;
  const oi = snap ? openInterestNotional(snap) : null;

  return (
    <div className="market-bar">
      <MarketPicker info={info} maxLev={maxLev} />

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
            <span className={`mono ${rateTone(funding)}`}>{signedRate18(funding)}</span>
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
