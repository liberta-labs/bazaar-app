import { history, type markets } from "@liberta-labs/bazaar-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AccountCard } from "../components/AccountCard";
import { AccountTabs } from "../components/AccountTabs";
import { MarketBar } from "../components/MarketBar";
import { type LiveFill, RecentTrades } from "../components/RecentTrades";
import { MarketFacts } from "../components/MarketFacts";
import { OrderBook } from "../components/OrderBook";
import { OrderTicket, type TicketPrefill } from "../components/OrderTicket";
import { type ChartCandle, PriceChart } from "../components/PriceChart";
import { Empty, Loading, Term, Tip } from "../components/ui";
import { GLOSSARY } from "../lib/glossary";
import { price } from "../lib/format";
import { useBoard, useMarketInfo, useRead } from "../state/connection";
import { useLiveAccount, useStablePrices } from "../state/data";
import { usePageActive } from "../state/activity";
import { usePoll } from "../state/poll";

const INTERVAL_LABEL: Record<number, string> = { 60: "1m", 300: "5m", 900: "15m", 3600: "1h", 14400: "4h", 86400: "1d" };
const CANDLES_SHOWN = 300;

function precisionOf(p: bigint | null): number {
  if (!p) return 2;
  const whole = p / 10n ** 18n;
  return whole >= 1000n ? 2 : whole >= 1n ? 4 : 6;
}

/** Candles from the subgraph, gaps filled, the last one updated from live trades. */
function useCandles(pair: string | undefined, interval: number) {
  const { readBz } = useRead();
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [trades, setTrades] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => setLoading(true), [readBz, pair, interval]);
  // Paused while the tab is hidden; live fills keep the last candle current in between.
  usePoll(
    async (isDead) => {
      if (!readBz || !pair) return;
      try {
        const now = Math.floor(Date.now() / 1000);
        const to = now - (now % interval) + interval;
        const from = to - CANDLES_SHOWN * interval;
        const rows: history.Candle[] = [];
        let after: string | null = null;
        for (let i = 0; i < 3; i++) {
          const page: history.Page<history.Candle> = await readBz.history.candles(pair as never, interval, { from, to, first: 1000, after });
          rows.push(...page.items);
          if (!page.next) break;
          after = page.next;
        }
        const before = await readBz.history.candles(pair as never, interval, { to: from, order: "desc", first: 1 });
        const filled = history.fillCandleGaps([...before.items, ...rows], interval, before.items.length ? from : undefined, to);
        if (isDead()) return;
        setTrades(rows.reduce((s, c) => s + c.tradeCount, 0));
        setCandles(filled.map((c) => ({ time: c.periodStart, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volumeSize })));
      } catch (e) {
        console.warn("candles", e);
        if (!isDead()) setCandles([]);
      } finally {
        if (!isDead()) setLoading(false);
      }
    },
    Math.max(60_000, interval * 1000),
    [readBz, pair, interval],
    Boolean(readBz && pair),
  );

  /** A fill seen live: fold it into the current period. */
  const onTrade = useCallback(
    (p: bigint, size: bigint) => {
      const now = Math.floor(Date.now() / 1000);
      const t = now - (now % interval);
      setTrades((n) => n + 1);
      setCandles((cs) => {
        const last = cs[cs.length - 1];
        if (last && last.time === t) {
          return [...cs.slice(0, -1), { ...last, high: p > last.high ? p : last.high, low: p < last.low ? p : last.low, close: p, volume: last.volume + size }];
        }
        const out = [...cs];
        // Periods between the last candle and this one are flat at the last close.
        if (last) for (let k = last.time + interval; k < t; k += interval) out.push({ time: k, open: last.close, high: last.close, low: last.close, close: last.close, volume: 0n });
        out.push({ time: t, open: last?.close ?? p, high: p, low: p, close: p, volume: size });
        return out;
      });
    },
    [interval],
  );
  return { candles, trades, loading, onTrade };
}

export function MarketPage() {
  const { address } = useParams();
  const info = useMarketInfo(address);
  const { readBz, markets: list } = useRead();
  const { prices } = useBoard();
  const stable = useStablePrices();
  const acct = useLiveAccount();
  const [snap, setSnap] = useState<markets.MarketSnapshot | undefined>(undefined);
  const [bookVersion, setBookVersion] = useState(0);
  const [interval, setInterval_] = useState(900);
  const [prefill, setPrefill] = useState<TicketPrefill | null>(null);
  const [bookTab, setBookTab] = useState<"book" | "trades">("book");
  const [fills, setFills] = useState<LiveFill[]>([]);
  const { candles, trades, loading: candlesLoading, onTrade } = useCandles(info?.address, interval);

  const inUse = usePageActive();
  // Another market: nothing shown belongs to it.
  useEffect(() => {
    setSnap(undefined);
    setFills([]);
  }, [readBz, info]);

  // Follow the market live: snapshots on events and every 15 s, and the book when it changes. Stopped
  // while nobody is using the page, keeping what it showed; started again (a fresh snapshot and book)
  // when they are back.
  useEffect(() => {
    if (!readBz || !info || !inUse) return;
    const h = readBz.live.watchMarket(
      info.address,
      (u) => {
        if (u.type === "snapshot") {
          setSnap(u.snapshot);
          if (u.bookChanged) setBookVersion((v) => v + 1);
        }
        if (u.type === "event" && u.event.source === "pair" && u.event.name === "Trade") {
          const a = u.event.args;
          onTrade(a.price, a.fillSize);
          const fill: LiveFill = { key: `${u.event.txHash}-${u.event.logIndex}`, price: a.price, size: a.fillSize, buy: a.takerIsLong, time: Math.floor(Date.now() / 1000), hash: u.event.txHash };
          setFills((f) => [fill, ...f].slice(0, 40));
        }
      },
      { prices: stable, fetchPrices: false },
    );
    // The book may have moved while the watch was stopped.
    setBookVersion((v) => v + 1);
    return () => h.stop();
  }, [readBz, info, stable, onTrade, inUse]);

  const live = info ? prices?.price(info.address) : null;
  const mine = info ? acct.snaps.get(info.address) : undefined;
  const spot = useMemo(
    () => live ?? (snap && snap.price.updateTs > 0 && snap.price.spot > 0n ? { spot: snap.price.spot, low: snap.price.low, high: snap.price.high, publishTime: snap.price.updateTs } : null),
    [live, snap],
  );

  if (!info) {
    if (!list.length) return <Loading what="Loading market" />;
    return <Empty title="This market doesn't exist" action={<Link to="/">See all markets</Link>} />;
  }
  const stored = !live && !!spot;
  const refreshAccount = () => acct.refresh();
  const quiet = !candlesLoading && trades === 0;

  return (
    <div className="terminal">
      <MarketBar info={info} snap={snap} spot={spot} stored={stored} />

      {snap && snap.status !== "live" && (
        <div className="banner warn" style={{ gridArea: "note", margin: 0 }}>
          <div className="grow">
            <b>
              <Term t={snap.status as "adl"}>{snap.status.toUpperCase()}</Term>:
            </b>{" "}
            {GLOSSARY[snap.status as "adl"]} {snap.reasons.marketOrdersDisabled ?? ""}
          </div>
        </div>
      )}

      <section className="panel tight t-chart">
        <div className="chart-toolbar">
          {history.CANDLE_INTERVALS.map((iv) => (
            <button key={iv} className={iv === interval ? "on" : ""} onClick={() => setInterval_(iv)}>
              {INTERVAL_LABEL[iv]}
            </button>
          ))}
          <span className="grow" />
          <Tip text="Candles are built from this market's fills. The dashed yellow line is the oracle price from Pyth.">
            <span className="small muted term">about this chart</span>
          </Tip>
        </div>
        <div className="chart-box">
          <PriceChart candles={candles} oracle={live?.spot ?? null} precision={precisionOf(spot?.spot ?? null)} />
          {quiet && (
            <div className="chart-empty">
              <div>
                <div>{candles.length ? "No trades in this period yet." : "No trades on this market yet."}</div>
                <div className="small">Candles are built from fills, so a quiet market has few. The oracle price is {spot ? price(spot.spot) : "–"}.</div>
              </div>
            </div>
          )}
        </div>
        {/* The chart library's licence (Apache 2.0) asks for credit and a link to TradingView on the page; the full NOTICE text rides in the title. */}
        <div className="chart-credit" title="TradingView Lightweight Charts™ · Copyright © 2025 TradingView, Inc.">
          Powered by{" "}
          <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
            TradingView
          </a>
        </div>
      </section>

      <section className="panel tight t-book">
        <div className="tabs" role="tablist">
          <button className={bookTab === "book" ? "on" : ""} onClick={() => setBookTab("book")} role="tab" aria-selected={bookTab === "book"}>
            Order book
          </button>
          <button className={bookTab === "trades" ? "on" : ""} onClick={() => setBookTab("trades")} role="tab" aria-selected={bookTab === "trades"}>
            Trades
          </button>
        </div>
        <div className="t-book-body">
          {bookTab === "book" ? (
            <OrderBook pair={info.address} version={bookVersion} mark={snap?.markPrice ?? null} onPick={(p) => setPrefill((x) => ({ price: p, n: (x?.n ?? 0) + 1 }))} />
          ) : (
            <RecentTrades pair={info.address} live={fills} base={info.label.split("/")[0] ?? "asset"} />
          )}
        </div>
      </section>

      <div className="t-side">
        <section className="panel">
          <OrderTicket market={info} snap={snap} acct={mine} spot={spot} prefill={prefill} onPlaced={refreshAccount} />
        </section>
        <AccountCard market={info} snap={snap} acct={mine} onDone={refreshAccount} />
        <details className="panel facts-panel">
          <summary>Market details</summary>
          {snap ? <MarketFacts snap={snap} oracle={spot?.spot ?? null} /> : <Loading />}
          {info.description && <p className="small muted" style={{ marginTop: 8 }}>{info.description}</p>}
        </details>
      </div>

      <AccountTabs className="panel tight t-tabs" />
    </div>
  );
}
