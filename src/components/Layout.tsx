import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ACTIVE } from "../config/networks";
import { dayChange } from "../lib/board";
import { price, shortAddr, signedPct } from "../lib/format";
import { CONTRACT_WALLET_REASON } from "../lib/wallet";
import { IDLE_MINUTES, useActivity } from "../state/activity";
import { HAS_PROJECT_ID } from "../state/appkit";
import { useBoard, useNow, useRead, useWallet } from "../state/connection";
import { useDayStats } from "../state/data";
import { usePoll } from "../state/poll";
import { type ThemePref, useTheme } from "../state/theme";
import { FaucetButton } from "./Faucet";
import { AssetIcon } from "./AssetIcon";
import { Tip } from "./ui";

const LINKS = [
  { to: "/", label: "Markets", end: true },
  { to: "/earn", label: "Earn" },
  { to: "/proposals", label: "Proposals" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/leaderboard", label: "Leaderboard" },
];

function ConnectButton() {
  const w = useWallet();
  if (!w.address) {
    return (
      <button className="primary" onClick={w.openConnect}>
        Connect wallet
      </button>
    );
  }
  return (
    <button onClick={w.openAccount} title="Account">
      <span className="mono">{shortAddr(w.address)}</span>
      {w.kind === "contract" && <span className="badge warn">smart wallet</span>}
    </button>
  );
}

function Banners() {
  const w = useWallet();
  const board = useBoard();
  const read = useRead();
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem("bazaar.smartWalletNotice");
    } catch {
      return null;
    }
  });
  const dismissSmart = () => {
    if (!w.address) return;
    setDismissed(w.address);
    try {
      localStorage.setItem("bazaar.smartWalletNotice", w.address);
    } catch {
      /* storage blocked: the notice just shows again next time */
    }
  };

  return (
    <>
      {read.error && <div className="banner bad">{read.error}</div>}
      {w.wrongChain && (
        <div className="banner warn">
          <div className="grow">
            Your wallet is on another network. Bazaar runs on <b>{ACTIVE.name}</b>.
            {w.switchError && <div className="small" style={{ marginTop: 4 }}>{w.switchError}</div>}
          </div>
          <button className="primary small" onClick={() => w.ensureChain().catch(() => undefined)}>
            Switch to {ACTIVE.name}
          </button>
        </div>
      )}
      {w.kind === "contract" && w.address && dismissed !== w.address && (
        <div className="banner warn">
          <div className="grow">
            <b>This is a smart-contract wallet.</b> You can browse, deposit collateral, cancel orders and request an insurance withdrawal. You can't place or amend orders, withdraw collateral, deposit into insurance or finish leaving it: {CONTRACT_WALLET_REASON.split(". ")[0]}.
          </div>
          <button className="small" onClick={dismissSmart}>
            Got it
          </button>
        </div>
      )}
      {board.error && <div className="banner warn">{board.error}</div>}
      {!HAS_PROJECT_ID && import.meta.env.DEV && (
        <div className="banner warn small">VITE_REOWN_PROJECT_ID is not set: browser wallets connect, but phone wallets over WalletConnect can't until it is.</div>
      )}
    </>
  );
}

/** The market the Trade link opens: the last one viewed, else the first listed. */
export const LAST_MARKET_KEY = "bazaar.lastMarket";

function useTradeLink(): string {
  const { markets: list } = useRead();
  const loc = useLocation();
  const [last, setLast] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_MARKET_KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const m = /^\/market\/(0x[0-9a-fA-F]{40})/.exec(loc.pathname);
    if (!m) return;
    setLast(m[1]!);
    try {
      localStorage.setItem(LAST_MARKET_KEY, m[1]!);
    } catch {
      /* storage blocked: the link falls back to the first market */
    }
  }, [loc.pathname]);
  const known = last && list.some((x) => x.address.toLowerCase() === last.toLowerCase()) ? last : list[0]?.address;
  return known ? `/market/${known}` : "/";
}

/** Each market's price and 24-hour change, across the header. */
function TickerTape() {
  const { markets: list } = useRead();
  const { prices } = useBoard();
  // Trade candles only for the fallback: once the board has every market's price 24 h ago, the ticker
  // asks the subgraph for nothing.
  const day = useDayStats(prices !== null && list.some((m) => prices.dayAgo(m.address) === null));
  if (!list.length) return null;
  // Two copies side by side, the track moving left by one copy's width and starting over: a seamless
  // loop. The second copy is for the eye only, out of the tab order and hidden from screen readers.
  const group = (copy: boolean) => (
    <div className="ticker-group" aria-hidden={copy || undefined}>
      {list.map((m) => {
        const p = prices?.price(m.address);
        const ch = dayChange(p?.spot, prices?.dayAgo(m.address), day.get(m.address)?.open)?.pct ?? null;
        return (
          <NavLink key={m.address} to={`/market/${m.address}`} className="ticker-item" tabIndex={copy ? -1 : undefined}>
            <AssetIcon market={m} size={16} />
            <b>{m.label.split("/")[0]}</b>
            <span className="mono">{p ? price(p.spot) : "–"}</span>
            {ch !== null && <span className={`mono ${ch >= 0 ? "up" : "down"}`}>{signedPct(ch)}</span>}
          </NavLink>
        );
      })}
    </div>
  );
  return (
    <div className="ticker hide-sm" aria-label="Market prices">
      {/* About 6 seconds per market: a slow, steady crawl whatever the number of markets. */}
      <div className="ticker-track" style={{ "--ticker-duration": `${list.length * 6}s` } as CSSProperties}>
        {group(false)}
        {group(true)}
      </div>
    </div>
  );
}

/**
 * After 15 minutes without input, the page stops updating and says so, at the bottom of the screen
 * where it cannot be missed. Any input (a click, a key, the mouse moving, a scroll) resumes it; the
 * button is there to make that plain.
 */
function PausedBar() {
  const { idle, resume } = useActivity();
  if (!idle) return null;
  return (
    <div className="paused-bar" role="status">
      <span>
        Updates paused after {IDLE_MINUTES} minutes without activity. Prices and positions shown may be out of date.
      </span>
      <button className="primary small" onClick={resume}>
        Resume
      </button>
    </div>
  );
}

/** Connection health along the bottom: network, live prices, wallet and the chain's head. */
function StatusBar() {
  const { readBz, error } = useRead();
  const board = useBoard();
  const w = useWallet();
  const now = useNow(2000);
  const { idle } = useActivity();
  const [block, setBlock] = useState<number | null>(null);
  usePoll(
    async (isDead) => {
      if (!readBz) return;
      const b = await readBz.ctx.chain.blockNumber().catch(() => null);
      if (b !== null && !isDead()) setBlock(b);
    },
    5000,
    [readBz],
    Boolean(readBz),
  );
  const pricesLive = board.fetchedAt !== null && now * 1000 - board.fetchedAt < 30_000;
  return (
    <footer className="status-bar">
      <span className="status">
        <i className={`dot-s ${readBz && !error ? "ok" : "bad"}`} /> {ACTIVE.name}
      </span>
      <span className="status">
        <i className={`dot-s ${idle ? "warn" : pricesLive ? "ok" : "bad"}`} /> {idle ? "Updates paused" : pricesLive ? "Live prices" : "Prices offline"}
      </span>
      <span className="status">
        <i className={`dot-s ${w.address ? (w.wrongChain ? "warn" : "ok") : "bad"}`} /> {w.address ? (w.wrongChain ? "Wallet on another network" : "Wallet connected") : "Wallet disconnected"}
      </span>
      {block !== null && (
        <span className="status mono" title="Latest Arbitrum block">
          ◇ {block.toLocaleString()}
        </span>
      )}
      <a className="status-link" href="https://docs.bazaar.finance/" target="_blank" rel="noopener noreferrer">
        Docs ↗
      </a>
    </footer>
  );
}

const THEME_LABEL: Record<ThemePref, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };
const THEME_ICON: Record<ThemePref, string> = { system: "◐", light: "☀", dark: "☾" };

/** System, light or dark; each click moves to the next. */
function ThemeButton() {
  const { pref, cycle } = useTheme();
  const next = pref === "system" ? "light" : pref === "light" ? "dark" : "system";
  return (
    <Tip text={`${THEME_LABEL[pref]}. Click for ${next}.`}>
      <button className="icon-btn" onClick={cycle} aria-label={`${THEME_LABEL[pref]}; switch to ${next}`}>
        {THEME_ICON[pref]}
      </button>
    </Tip>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  const trade = useTradeLink();
  const loc = useLocation();
  const onTrade = loc.pathname.startsWith("/market/");
  const links = [{ to: trade, label: "Trade", end: false, active: onTrade }, ...LINKS.map((l) => ({ ...l, active: undefined as boolean | undefined }))];
  return (
    <div className="app">
      <header className="header">
        <NavLink to="/" className="brand" aria-label="Bazaar home">
          <img src={theme === "light" ? "./bazaar-logo-black.png" : "./bazaar-logo-yellow.png"} alt="Bazaar" />
        </NavLink>
        {ACTIVE.testnet && (
          <Tip text={`You're on ${ACTIVE.name}, a test network. Everything here uses test USDC with no real value.`}>
            <span className="badge testnet">Testnet</span>
          </Tip>
        )}
        <nav className="nav" aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.label} to={l.to} end={l.end} className={({ isActive }) => ((l.active ?? isActive) ? "active" : "")}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <TickerTape />
        <div className="header-right">
          {ACTIVE.testnet && <FaucetButton header hideOnPhone />}
          <ThemeButton />
          <ConnectButton />
        </div>
      </header>
      <main className={onTrade ? "full" : ""}>
        <Banners />
        {children}
      </main>
      <nav className="mobile-nav" aria-label="Main">
        {links.map((l) => (
          <NavLink key={l.label} to={l.to} end={l.end} className={({ isActive }) => ((l.active ?? isActive) ? "active" : "")}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <div className="bottom-bars">
        <PausedBar />
        <StatusBar />
      </div>
    </div>
  );
}
