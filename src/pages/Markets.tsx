import { history, markets as mk } from "@liberta-labs/bazaar-sdk";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaucetButton } from "../components/Faucet";
import { AssetIcon } from "../components/AssetIcon";
import { NetworkHelpLink } from "../components/NetworkHelp";
import { MarketFilterChips, NoMarketMatch, matchesSearch, useMarketFilter } from "../components/MarketFilters";
import { StarButton } from "../components/StarButton";
import { TestUsdcHelpLink } from "../components/TestUsdcHelp";
import { Empty, Loading, PriceAge, StatusBadge, Term, Tip } from "../components/ui";
import { ACTIVE } from "../config/networks";
import { dayChange } from "../lib/board";
import { GLOSSARY } from "../lib/glossary";
import { fundingHoursPerYear, hoursLabel, tradingHours } from "../lib/hours";
import { pct, price, rate18, signedPct, usd } from "../lib/format";
import { openInterestNotional } from "../lib/openInterest";
import { HAS_PROJECT_ID } from "../state/appkit";
import { useBoard, useRead, useWallet } from "../state/connection";
import { useDayStats, useLiveAccount, useMarketSnapshots } from "../state/data";
import type { SortState } from "../lib/sort";
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
      // "Connect", never "Sign in": there's no account to sign up for. Email and social logins need the
      // Reown project id; without it, only a wallet of your own connects.
      title: "Connect",
      text: HAS_PROJECT_ID
        ? "Use your email or a Google, X or Apple account, or a wallet like MetaMask or Rabby."
        : `MetaMask, Rabby or any browser wallet. It needs to be on the ${ACTIVE.name} network.`,
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
      // An email or social login starts on the right network; only a wallet of your own needs adding it.
      help: <NetworkHelpLink label={HAS_PROJECT_ID ? `Using your own wallet? Add ${ACTIVE.name}` : undefined} />,
    },
    ...(ACTIVE.testnet
      ? [{ done: (usdc ?? 0n) > 0n || deposited, title: "Get test USDC", text: "Free test dollars to try Bazaar with. They have no real value.", action: w.address && <FaucetButton compact />, help: <TestUsdcHelpLink /> }]
      : []),
    { done: deposited, title: "Deposit on a market", text: "Collateral is held per market: open a market and deposit there.", action: first && <button className="small" onClick={() => navigate(`/market/${first.address}`)}>Open {first.label}</button> },
    { done: traded, title: "Buy or Sell", text: "Pick an amount and leverage. You'll see the fee and liquidation price before you sign. No ETH needed." },
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
  const when = h?.text ? ` Open ${h.text}, ${h.zone} time${h.holidays ? ", except market holidays" : ""}.` : "";
  return (
    <Tip text={`${h?.kind === "24/5" ? "Around the clock on weekdays." : ""}${when} ${GLOSSARY.tradingHours}`.trim()}>
      <span className="badge">{hoursLabel(m)}</span>
    </Tip>
  );
}

/** The markets table's opening sort: the most traded first. */
const MARKETS_SORT: SortState = { key: "volume", dir: "desc" };

export function MarketsPage() {
  const { markets: list, readBz } = useRead();
  const { snaps, loading } = useMarketSnapshots();
  const { prices } = useBoard();
  const day = useDayStats();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const show = useMarketFilter(list, "bazaar.marketsFilter");

  const needle = q.trim().toLowerCase();
  const rows = list.filter((m) => show.inFilter(m) && matchesSearch(m, needle));
  // Each market with what its columns show, worked out once for both the cells and the sort.
  const view = rows.map((m) => {
    const s = snaps.get(m.address);
    const live = prices?.price(m.address);
    const stored = s && s.price.updateTs > 0 && s.price.spot > 0n ? s.price : null;
    const spot = live?.spot ?? stored?.spot ?? null;
    const d = day.get(m.address);
    const change = dayChange(spot, prices?.dayAgo(m.address), d?.open)?.pct ?? null;
    const oi = s ? openInterestNotional(s) : null;
    return { m, s, live, stored, spot, d, change, oi };
  });
  // Opens sorted by 24-hour volume, highest first. Until the day's volumes arrive, and among markets
  // with the same volume, rows keep the factory's order.
  const { sorted, th } = useSort(
    view,
    {
      market: (v) => v.m.label,
      price: (v) => v.spot,
      change: (v) => v.change,
      volume: (v) => v.d?.volume,
      oi: (v) => v.oi,
      funding: (v) => v.s?.funding.currentRatePerHour,
      status: (v) => v.s?.status,
    },
    MARKETS_SORT,
  );

  return (
    <>
      <GettingStarted />
      <section className="panel tight">
        <div className="panel-head">
          <h2>Markets</h2>
          <input style={{ maxWidth: 260 }} placeholder="Search markets" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search markets" />
        </div>
        {list.length > 0 && <MarketFilterChips state={show} />}
        {!readBz || (loading && !snaps.size) ? (
          <Loading what="Loading markets" />
        ) : rows.length === 0 ? (
          !list.length ? (
            <Empty title="No markets yet">Markets appear here once listed. See Proposals to propose one.</Empty>
          ) : (
            <NoMarketMatch state={show} needle={needle} list={list} />
          )
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
                  <th className="star-col">
                    <span className="sr-only">Watchlist</span>
                  </th>
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
                      <td className="star-col">
                        <StarButton market={m} />
                      </td>
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
