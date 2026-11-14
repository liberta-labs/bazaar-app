import { history, markets as mk } from "@liberta-labs/bazaar-sdk";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaucetButton } from "../components/Faucet";
import { AssetIcon } from "../components/AssetIcon";
import { NetworkHelpLink } from "../components/NetworkHelp";
import { TestUsdcHelpLink } from "../components/TestUsdcHelp";
import { Empty, Loading, PriceAge, StatusBadge, Term, Tip } from "../components/ui";
import { ACTIVE } from "../config/networks";
import { dayChange } from "../lib/board";
import { GLOSSARY } from "../lib/glossary";
import { fundingHoursPerYear, hoursLabel, tradingHours } from "../lib/hours";
import { pct, price, rate18, signedPct, usd } from "../lib/format";
import { useBoard, useRead, useWallet } from "../state/connection";
import { useDayStats, useLiveAccount, useMarketSnapshots } from "../state/data";
import { useSort } from "../state/sort";

function GettingStarted() {
  const w = useWallet();
  const acct = useLiveAccount();
  const navigate = useNavigate();
  const { markets: list } = useRead();
  const [usdc, setUsdc] = useState<bigint | null>(null);
  const { readBz } = useRead();
  useEffect(() => {
    if (!readBz || !w.address) return setUsdc(null);
    readBz.allowance.usdcBalance(w.address).then(setUsdc, () => setUsdc(null));
  }, [readBz, w.address, acct.snaps]);
  const deposited = [...acct.snaps.values()].some((s) => s.position.collateral > 0n);
  const traded = [...acct.snaps.values()].some((s) => s.hasPosition || s.orders.length > 0);
  if (w.address && deposited && traded) return null;
  const first = list[0];
  const onNetwork = !!w.address && !w.wrongChain;
  const steps = [
    {
      done: onNetwork,
      title: "Connect a wallet",
      text: `MetaMask, Rabby or any browser wallet, or a phone wallet by QR code. It needs to be on the ${ACTIVE.name} network.`,
      action: !w.address ? (
        <button className="primary small" onClick={w.openConnect}>
          Connect
        </button>
      ) : (
        w.wrongChain && (
          <button className="primary small" onClick={() => w.ensureChain().catch(() => undefined)}>
            Switch to {ACTIVE.name}
          </button>
        )
      ),
      // Shown once done too, so a guide open when the switch lands stays open to say so.
      help: <NetworkHelpLink />,
    },
    ...(ACTIVE.testnet
      ? [{ done: (usdc ?? 0n) > 0n || deposited, title: "Get test USDC", text: "Free test dollars to try Bazaar with. They have no real value.", action: w.address && <FaucetButton compact />, help: <TestUsdcHelpLink /> }]
      : []),
    { done: deposited, title: "Deposit on a market", text: "Collateral is held per market: open a market and deposit there.", action: first && <button className="small" onClick={() => navigate(`/market/${first.address}`)}>Open {first.label}</button> },
    { done: traded, title: "Buy or sell", text: "Pick an amount and leverage. You'll see the fee and liquidation price before you sign. No ETH needed." },
  ];
  return (
    <section className="hero">
      <h1>Trade perpetual futures on Arbitrum</h1>
      <p className="muted">
        Go <Term t="long">long</Term> or <Term t="short">short</Term> with leverage. Every market has its own <Term t="insurance">insurance fund</Term>,
        which you can also join to earn fees.
      </p>
      <div className="steps-inline">
        {steps.map((s, i) => (
          <div key={i} className={`step-card${s.done ? " done" : ""}`}>
            <div className="spread">
              <b>
                <span className="n">{s.done ? "✓" : i + 1}</span>
                {s.title}
              </b>
            </div>
            <div className="small muted" style={{ margin: "6px 0" }}>
              {s.text}
            </div>
            {!s.done && s.action}
            {"help" in s && s.help && <div style={{ marginTop: 6 }}>{s.help}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** "24/7", "24/5" (around the clock on weekdays) or "trading hours", with the hours themselves on hover. */
function HoursBadge({ m }: { m: mk.MarketInfo }) {
  if (m.continuous) {
    return (
      <Tip text="Trades around the clock, every day: its price never pauses for a closed venue.">
        <span className="badge">24/7</span>
      </Tip>
    );
  }
  const h = tradingHours(m.legFeeds);
  const when = h?.text ? ` Open ${h.text}, ${h.zone} time${h.holidays ? ", closed or shorter on market holidays" : ""}.` : "";
  return (
    <Tip text={`${h?.kind === "24/5" ? "Trades around the clock on weekdays." : ""}${when} ${GLOSSARY.tradingHours}`.trim()}>
      <span className="badge">{hoursLabel(m)}</span>
    </Tip>
  );
}

export function MarketsPage() {
  const { markets: list, readBz } = useRead();
  const { snaps, loading } = useMarketSnapshots();
  const { prices } = useBoard();
  const day = useDayStats();
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((m) => !needle || m.label.toLowerCase().includes(needle) || m.description.toLowerCase().includes(needle) || m.address.toLowerCase().includes(needle));
  }, [list, q]);
  // Each market with what its columns show, worked out once for both the cells and the sort.
  const view = rows.map((m) => {
    const s = snaps.get(m.address);
    const live = prices?.price(m.address);
    const stored = s && s.price.updateTs > 0 && s.price.spot > 0n ? s.price : null;
    const spot = live?.spot ?? stored?.spot ?? null;
    const d = day.get(m.address);
    const change = dayChange(spot, prices?.dayAgo(m.address), d?.open)?.pct ?? null;
    const oi = s ? s.openInterest.longNotional + s.openInterest.shortNotional : null;
    return { m, s, live, stored, spot, d, change, oi };
  });
  const { sorted, th } = useSort(view, {
    market: (v) => v.m.label,
    price: (v) => v.spot,
    change: (v) => v.change,
    volume: (v) => v.d?.volume,
    oi: (v) => v.oi,
    funding: (v) => v.s?.funding.currentRatePerHour,
    status: (v) => v.s?.status,
  });

  return (
    <>
      <GettingStarted />
      <section className="panel tight">
        <div className="panel-head">
          <h2>Markets</h2>
          <input style={{ maxWidth: 260 }} placeholder="Search markets" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
        </div>
        {!readBz || (loading && !snaps.size) ? (
          <Loading what="Loading markets" />
        ) : rows.length === 0 ? (
          <Empty title={list.length ? "No market matches your search" : "No markets yet"}>{list.length ? "Try another name, like BTC or ETH." : "Markets appear here once listed. See Proposals to propose one."}</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th {...th("market")}>Market</th>
                  <th {...th("price", "num")}>Price</th>
                  <th {...th("change", "num")}>24h change</th>
                  <th {...th("volume", "num hide-sm")}>24h volume</th>
                  <th {...th("oi", "num hide-sm")}>
                    <Term t="openInterest">Open interest</Term>
                  </th>
                  <th {...th("funding", "num hide-sm")}>
                    <Term t="funding">Funding / h</Term>
                  </th>
                  <th {...th("status")}>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ m, s, live, stored, spot, d, change, oi }) => {
                  return (
                    <tr key={m.address} className="clickable" onClick={() => navigate(`/market/${m.address}`)}>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="market-name">
                            <AssetIcon market={m} size={22} />
                            <b>{m.label}</b>
                          </span>
                          <HoursBadge m={m} />
                          {s?.venueClosed === true && (
                            <Tip text={GLOSSARY.venueClosed}>
                              <span className="badge warn">venue closed</span>
                            </Tip>
                          )}
                        </div>
                      </td>
                      <td className="num">
                        {/* The price's warnings sit on its line, left of it, so the row stays one line. A closed venue shows beside the market's name instead. */}
                        <div className="row" style={{ gap: 14, justifyContent: "flex-end" }}>
                          <PriceAge publishTime={live?.publishTime ?? stored?.updateTs ?? null} confidenceOk={prices?.confidenceOk(m.address)} stored={!live && !!stored} />
                          <span>{spot !== null ? price(spot) : "–"}</span>
                        </div>
                      </td>
                      <td className={`num ${change === null ? "" : change >= 0 ? "up" : "down"}`}>{change === null ? "–" : signedPct(change)}</td>
                      <td className="num hide-sm">{d ? usd(d.volume) : "–"}</td>
                      <td className="num hide-sm">{oi !== null ? usd(oi) : "–"}</td>
                      <td className="num hide-sm">
                        {s ? (
                          <Tip text={`Annualized: ${pct(mk.annualizedFunding(s.funding.currentRatePerHour, fundingHoursPerYear(m)))}`}>
                            <span>{rate18(s.funding.currentRatePerHour)}</span>
                          </Tip>
                        ) : (
                          "–"
                        )}
                      </td>
                      <td>{s ? <StatusBadge status={s.status} /> : <span className="muted">–</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="small muted" style={{ marginTop: 12 }}>
        Prices refresh every 10 seconds from Pyth Pro. 24-hour change is measured against Pyth's price 24 hours earlier. {history.CANDLE_INTERVALS.length ? "24-hour volume comes from fills, so a quiet market shows none." : ""}
      </p>
    </>
  );
}
