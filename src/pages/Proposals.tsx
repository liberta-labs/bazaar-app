/**
 * Proposals: market listings, market terminations (UMA claims and insurer votes), and the UMA
 * identifier. Every builder returns a CostedCall; its costs, approvals, requirements and notes are
 * all shown before the wallet is asked. These calls are sent from the wallet and need ETH for gas.
 * Text from the chain or the subgraph (descriptions, reasons) is rendered as text only.
 */
import {
  type Bazaar,
  type history,
  listings,
  type markets,
  ORACLE_DEAD_THRESHOLD,
  PYTH_PRO,
  type ProSymbol,
  formatDecimal,
  isRawFeedId,
  parseUnits18,
  proFeedId,
  termination as term,
  uma,
} from "@liberta-labs/bazaar-sdk";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Address, Hex } from "viem";
import { HistoryList } from "../components/History";
import { FaucetButton } from "../components/Faucet";
import { HistoryLag } from "../components/HistoryLag";
import { TestUsdcHelpLink } from "../components/TestUsdcHelp";
import { Modal } from "../components/Modal";
import { YourActivity } from "../components/YourActivity";
import { Empty, Loading, StatusBadge, Term, Tip, TxLink, useAsync } from "../components/ui";
import { ACTIVE, addressUrl } from "../config/networks";
import { explain, isKeeperOnly } from "../lib/errors";
import { STATUS_TEXT } from "../lib/glossary";
import { amount, dateTime, parseInput, relative, shortAddr } from "../lib/format";
import { costedPart } from "../lib/jobs";
import { mergeByTime } from "../lib/mergePages";
import {
  continuousMismatch,
  descriptionMismatch,
  feedIsLive,
  feedLabelOf,
  listingShortfall,
  registryClient,
  scheduleIs247,
  searchSymbols,
  suggestCompositeDescription,
  suggestDescription,
} from "../lib/listing";
import { useRead, useWallet } from "../state/connection";
import { useMarketSnapshots } from "../state/data";
import { useSort } from "../state/sort";
import { useTx } from "../state/tx";

type Costed = uma.CostedCall;

function costText(c: uma.Cost): string {
  const amt = c.unit === "USDC" ? uma.usdcText(c.amount) : c.unit === "ETH" ? uma.ethText(c.amount) : c.unit === "shares" ? uma.sharesText(c.amount) : formatDecimal(c.amount, c.decimals ?? 18);
  return `${c.label}: ${amt}${c.contingent ? " (worst case)" : ""}. ${c.returned}`;
}

/** Everything a CostedCall says, for the confirmation. */
function costedSummary(c: Costed): ReactNode[] {
  return [
    <b key="s">{c.summary}</b>,
    ...c.costs.map((x, i) => <div key={`c${i}`}>{costText(x)}</div>),
    ...(c.approvals.length ? [<div key="a">First, {c.approvals.length === 1 ? "one approval" : `${c.approvals.length} approvals`}: {c.approvals.map((a) => a.summary).join("; ")}.</div>] : []),
    ...c.requires.map((r, i) => (
      <div key={`r${i}`} className="accent">
        {r}
      </div>
    )),
    ...c.notes.map((n, i) => (
      <div key={`n${i}`} className="muted small">
        {n}
      </div>
    )),
    <div key="g" className="muted small">
      Sent from your wallet: it needs a little {ACTIVE.name} ETH for gas.
    </div>,
  ];
}

/** Build a costed call with the wallet's connection, then confirm and send it. */
function useCosted() {
  const w = useWallet();
  const tx = useTx();
  const [notice, setNotice] = useState<string | null>(null);
  const run = async (title: string, build: (bz: Bazaar, user: Address) => Promise<Costed | null>, onDone?: () => void) => {
    setNotice(null);
    let ctx: Awaited<ReturnType<typeof w.requireWallet>>;
    try {
      ctx = await w.requireWallet();
    } catch {
      return;
    }
    let c: Costed | null;
    try {
      c = await build(ctx.walletBz, ctx.address);
    } catch (e) {
      setNotice(isKeeperOnly(e) ? "A keeper completes this step: it needs Pyth's archived prices, which only a keeper with a Pyth key can fetch." : explain(e));
      return;
    }
    if (!c) return;
    const built = c;
    await tx.run({ title, summary: costedSummary(built), parts: [costedPart(title, async () => built)], onDone });
  };
  return { run, notice, clear: () => setNotice(null) };
}

/**
 * Whether the connected wallet can settle claims before their dispute window ends. Only the owner of
 * the testnet's stand-in UMA oracle can, which is the deployer; UMA's own oracle has no owner, so on
 * mainnet nobody sees the button.
 */
function useCanSettleEarly(): boolean {
  const { readBz } = useRead();
  const w = useWallet();
  const owner = useAsync(async () => (readBz ? readBz.uma.earlySettler() : null), [readBz]);
  return Boolean(owner.data && w.address && owner.data.toLowerCase() === w.address.toLowerCase());
}

const SETTLE_EARLY_TIP = "Only the deployer sees this. It settles the claim now as accepted, without waiting for the dispute window to end.";

function Notice({ text, onClose }: { text: string | null; onClose: () => void }) {
  if (!text) return null;
  return (
    <div className="banner warn small">
      <div className="grow">{text}</div>
      <button className="small ghost" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

function AssertionLine({ id, home }: { id: Hex; home: "factory" | "terminator" }) {
  const { readBz } = useRead();
  const st = useAsync(async () => (readBz ? readBz.uma.assertionStatus(id, { home }) : null), [readBz, id]);
  const s = st.data;
  if (!s) return <span className="small muted">reading UMA…</span>;
  return (
    <>
      <Tip text={uma.ASSERTION_PHASE_TEXT[s.phase]}>
        <span className="small term">
          UMA: {s.phase}
          {s.disputableUntil ? ` · disputable ${relative(s.disputableUntil, s.now)}` : ""}
        </span>
      </Tip>
      {s.phase === "liveness" && s.assertion && <DisputeStake bond={s.assertion.bond} oo={s.assertion.oo} />}
    </>
  );
}

/** UMA's burn share per oracle: it doesn't change between claims, so it's read once. */
const burnedShare = new Map<string, Promise<bigint | null>>();

/**
 * What disputing a claim stakes and what it can win: the disputer matches the bond; if UMA's voters side
 * with them they get both bonds back less the share UMA burns as its fee, and if not, the bond is gone.
 */
function DisputeStake({ bond, oo }: { bond: bigint; oo: Address }) {
  const { readBz } = useRead();
  const burned = useAsync(async () => {
    if (!readBz) return null;
    const k = oo.toLowerCase();
    if (!burnedShare.has(k)) burnedShare.set(k, readBz.uma.burnedBondPercentage({ oo }).catch(() => null));
    return burnedShare.get(k)!;
  }, [readBz, oo]);
  // An oracle that doesn't report its burn share (the testnet one doesn't) is taken at UMA's standard
  // half, and the figure is marked as an estimate.
  const reported = burned.data ?? null;
  const share = reported ?? UMA_STANDARD_BURN;
  const back = bond * 2n - (bond * share) / 10n ** 18n;
  const est = reported === null ? "≈" : "";
  return (
    <Tip
      text={`A dispute bonds ${uma.usdcText(bond)}, like the proposer's. UMA's voters decide in a few days: win and get ${est}${uma.usdcText(back)} back, lose and the bond is gone.${reported === null ? " Estimated with UMA's standard fee." : ""}`}
    >
      <div className="small term">
        Dispute stake {uma.usdcText(bond)} · wins {est}+{uma.usdcText(back - bond)}
      </div>
    </Tip>
  );
}

/** UMA's standard burn on a disputed bond, 1e18 = 100%: half, as the live OOv3 is set. */
const UMA_STANDARD_BURN = 5n * 10n ** 17n;

// ---------------------------------------------------------------------------------------------
// How it works
// ---------------------------------------------------------------------------------------------

const DOCS = "https://docs.bazaar.finance/protocol";

/** What differs between the kinds of proposal: the bond, the window, what UMA checks, where to read more. */
const GUIDE: Record<ProposalTab, { bond: string; window: string; checks: string; after: string; docs: string }> = {
  listings: {
    bond: "At least 1,000 USDC, plus an insurance seed of at least 3,000 USDC that becomes the new market's insurance fund (returned if the listing fails).",
    window: "48 hours.",
    checks:
      "A live Pyth Pro feed for an eligible asset (a company's shares, an FX rate, a commodity, a cryptocurrency, or an ETF holding a broad stock index), the right trading hours, and a description that names that asset. Wording and price moves are never grounds.",
    after: "The market is deployed with the seed as its insurance fund, and the proposer holds those insurance shares.",
    docs: `${DOCS}/listing.html`,
  },
  terminations: {
    bond: "At least 1,000 USDC.",
    window: "12 hours.",
    checks:
      "An event that has happened or is scheduled for a fixed date: the asset is delisted, the feed is decommissioned, a structural change (a split, a spinoff, a special dividend over 5%), or a Pyth migration. Price moves are never grounds.",
    after:
      "Trading stops at the cutoff and every position settles at Pyth's price then; the proposer earns 0.1% of the insurance fund (up to $100). A market's insurers can also end it by voting: 60% of matured shares.",
    docs: `${DOCS}/termination.html`,
  },
  identifier: {
    bond: "At least 5,000 USDC.",
    window: "2 days, then a 7-day timelock before the new identifier takes over.",
    checks: "The new identifier must be on UMA's whitelist and named ASSERT_TRUTH…: it decides how UMA's voters judge every future listing and termination.",
    after: "It queues behind the timelock, so anyone who distrusts it has time to leave first; then anyone activates it.",
    docs: `${DOCS}/listing.html#the-only-governance-swapping-the-uma-identifier`,
  },
};

const GUIDE_KEY = "bazaar.proposalsGuide";

/**
 * The steps every proposal goes through, the specifics for the tab in view, and a link to the docs.
 * Folded until opened; once opened it stays open on later visits, until folded again.
 */
function HowItWorks({ tab }: { tab: ProposalTab }) {
  const [open] = useState(() => {
    try {
      return localStorage.getItem(GUIDE_KEY) === "open";
    } catch {
      return false;
    }
  });
  const g = GUIDE[tab];
  return (
    <details
      className="panel how-it-works"
      open={open}
      onToggle={(e) => {
        try {
          localStorage.setItem(GUIDE_KEY, e.currentTarget.open ? "open" : "closed");
        } catch {
          /* storage blocked: it opens again next time */
        }
      }}
    >
      <summary>How it works</summary>
      <ol className="small">
        <li>
          <b>Propose.</b> Anyone can make a claim to UMA, posting a USDC bond with it.
        </li>
        <li>
          <b>Dispute window.</b> Anyone who can show the claim is false may dispute it by posting the same bond.
        </li>
        <li>
          <b>Not disputed?</b> It passes when the window ends. Anyone can settle it, and the proposer gets their bond back.
        </li>
        <li>
          <b>Disputed?</b> UMA's voters decide, which takes a few days. The winner gets their bond back plus the loser's, less UMA's fee; the loser's bond is gone. Each open
          proposal shows what a dispute stakes and what it wins.
        </li>
      </ol>
      <div className="kv small">
        <span>Bond</span>
        <span>{g.bond}</span>
        <span>Dispute window</span>
        <span>{g.window}</span>
        <span>What's checked</span>
        <span>{g.checks}</span>
        <span>If it passes</span>
        <span>{g.after}</span>
      </div>
      <a className="small" href={g.docs} target="_blank" rel="noopener noreferrer">
        Learn more in the docs ↗
      </a>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------------------------

/** One fact in a proposal's details; null, false or undefined leaves it out. */
type Fact = { readonly k: string; readonly v: ReactNode } | null | false | undefined;

/**
 * A proposal's details, folded under it until opened: every fact the chain and the history record
 * about it, in full. Nothing inside is drawn, or read, until it is opened. Text in it (descriptions,
 * reasons, registry names) comes from the chain, the subgraph or Pyth, and is shown as text only.
 */
function ProposalDetails({ facts, txHash, note, label = "Details" }: { facts: readonly Fact[]; txHash?: Hex | null; note?: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="proposal-details" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label}</summary>
      {open && (
        <>
          <div className="kv">
            {facts.map(
              (f) =>
                f && (
                  <Fragment key={f.k}>
                    <span>{f.k}</span>
                    <span>{f.v}</span>
                  </Fragment>
                ),
            )}
            {txHash && (
              <>
                <span>Transaction</span>
                <span>
                  <TxLink hash={txHash}>{shortAddr(txHash)} ↗</TxLink>
                </span>
              </>
            )}
          </div>
          {note && <p className="small muted">{note}</p>}
        </>
      )}
    </details>
  );
}

/** An address in full, linked to the explorer. */
function Addr({ a }: { a: string }) {
  return (
    <a className="mono" href={addressUrl(a)} target="_blank" rel="noopener noreferrer">
      {a}
    </a>
  );
}

const Mono = ({ children }: { children: ReactNode }) => <span className="mono">{children}</span>;
const yesNo = (b: boolean) => (b ? "yes" : "no");

/** "feed 1234" for a Pyth Pro feed; a composite's id is a hash, shortened. */
const feedText = (id: Hex) => (isRawFeedId(id) ? `feed ${proFeedId(id)}` : `composite feed ${id.slice(0, 10)}…`);

/** A feed by its Pyth Pro number and what Pyth's registry calls it; a composite as its two legs. */
function FeedName({ feedId }: { feedId: Hex }) {
  const { readBz } = useRead();
  const registry = useAsync(() => loadRegistry(), []);
  const raw = isRawFeedId(feedId);
  const comp = useAsync(async () => (readBz && !raw ? readBz.listings.getComposite(feedId) : null), [readBz, feedId, raw]);
  const leg = (id: Hex) => {
    if (!isRawFeedId(id)) return <Mono>{id}</Mono>;
    const s = registry.data?.find((x) => x.feedId.toLowerCase() === id.toLowerCase());
    const name = s ? ` · ${s.symbol} · ${s.description}` : registry.loading ? " · looking it up…" : registry.error ? "" : " · not in Pyth's registry";
    return (
      <span>
        {proFeedId(id)}
        {name}
      </span>
    );
  };
  if (raw) return leg(feedId);
  if (comp.loading) return <span className="muted">reading…</span>;
  if (!comp.data) return <Mono>{feedId}</Mono>;
  return (
    <span>
      {leg(comp.data.baseId)} {comp.data.invertQuote ? "÷" : "×"} {leg(comp.data.quoteId)}
    </span>
  );
}

/** A termination claim's grounds, by category number. */
const groundsOf = (category: number) => term.TERMINATION_CATEGORY_INFO[category as term.TerminationCategory] ?? null;

// ---------------------------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------------------------

/** Pyth's symbols registry, read once per page load (it is public and needs no key). */
let registryListing: Promise<ProSymbol[]> | null = null;
function loadRegistry(): Promise<ProSymbol[]> {
  registryListing ??= registryClient()
    .symbols()
    .catch((e: unknown) => {
      registryListing = null;
      throw e;
    });
  return registryListing;
}

/** What the feed field names, once looked up. */
type FeedLookup =
  | { readonly kind: "empty" }
  | { readonly kind: "search"; readonly matches: readonly ProSymbol[] }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "checking" }
  | { readonly kind: "unknown"; readonly feedId: Hex }
  | { readonly kind: "raw"; readonly feedId: Hex; readonly feeds: readonly [ProSymbol] }
  | { readonly kind: "composite"; readonly feedId: Hex; readonly feeds: readonly [ProSymbol, ProSymbol]; readonly invertQuote: boolean };

function useFeedLookup(text: string, registry: readonly ProSymbol[] | undefined): FeedLookup {
  const { readBz } = useRead();
  const t = text.trim();
  const isId = /^\d+$/.test(t) || /^0x[0-9a-fA-F]{64}$/.test(t);
  const byId = useMemo(() => new Map((registry ?? []).map((s) => [s.feedId.toLowerCase(), s])), [registry]);
  let feedId: Hex | null = null;
  let invalid: string | null = null;
  if (isId) {
    try {
      feedId = listings.asFeedId("baseFeedId", t).toLowerCase() as Hex;
    } catch (e) {
      invalid = explain(e);
    }
  }
  const raw = feedId ? byId.get(feedId) : undefined;
  // Not a feed the registry lists: it may be a composite registered on Bazaar's oracle.
  const composite = useAsync(async () => (readBz && feedId && registry && !raw ? readBz.listings.getComposite(feedId) : null), [readBz, feedId, registry, raw]);

  if (!t) return { kind: "empty" };
  if (!isId) return /^0x/i.test(t) ? { kind: "invalid", message: "A feed ID is a number (1 for BTC/USD) or 32 bytes of hex." } : { kind: "search", matches: searchSymbols(registry ?? [], t) };
  if (invalid || !feedId) return { kind: "invalid", message: invalid ?? "That isn't a feed ID." };
  if (!registry) return { kind: "checking" };
  if (raw) return { kind: "raw", feedId, feeds: [raw] };
  if (composite.loading) return { kind: "checking" };
  const c = composite.data;
  const base = c ? byId.get(c.baseId.toLowerCase()) : undefined;
  const quote = c ? byId.get(c.quoteId.toLowerCase()) : undefined;
  if (c && base && quote) return { kind: "composite", feedId, feeds: [base, quote], invertQuote: c.invertQuote };
  return { kind: "unknown", feedId };
}

function FeedCard({ s, role }: { s: ProSymbol; role?: string }) {
  const is247 = scheduleIs247(s.schedule);
  const zone = s.schedule.split(";")[0];
  return (
    <div className="summary small">
      <div className="spread">
        <b>
          {role ? `${role}: ` : ""}
          {feedLabelOf(s.symbol)}
        </b>
        <span className="muted mono">feed {s.id}</span>
      </div>
      <div>{s.description}</div>
      <div className="muted">
        {s.symbol} · {s.assetType} · {is247 === null ? "schedule unknown" : is247 ? "trades 24/7" : `trading hours (${zone})`} ·{" "}
        <span className={feedIsLive(s) ? "" : "down"}>{s.state}</span>
      </div>
    </div>
  );
}

/** Pyth Terminal's list of every Pyth Pro feed, by asset class; each feed's page shows its feed ID. */
const PYTH_FEEDS_URL = "https://app.pyth.com/explore/all";

function ProposeListing({ onClose }: { onClose: () => void }) {
  const costed = useCosted();
  const registry = useAsync(loadRegistry, []);
  const [feed, setFeed] = useState("");
  const [continuous, setContinuous] = useState(true);
  const [total, setTotal] = useState("4000");
  const [desc, setDesc] = useState("");
  const [descTouched, setDescTouched] = useState(false);
  const lookup = useFeedLookup(feed, registry.data);
  const resolved = lookup.kind === "raw" || lookup.kind === "composite" ? lookup : null;
  // The wallet's USDC, read again after a faucet claim and whenever the user comes back to the page
  // (say, from moving USDC in their wallet): the listing pulls the whole amount at once.
  const w = useWallet();
  const { readBz } = useRead();
  const [heldN, setHeldN] = useState(0);
  const readHeldAgain = useCallback(() => setHeldN((x) => x + 1), []);
  const usdcHeld = useAsync(async () => (readBz && w.address ? readBz.allowance.usdcBalance(w.address) : null), [readBz, w.address, heldN]);
  useEffect(() => {
    window.addEventListener("focus", readHeldAgain);
    return () => window.removeEventListener("focus", readHeldAgain);
  }, [readHeldAgain]);
  const shortfall = listingShortfall(usdcHeld.data, parseInput(total));
  const feeds = resolved?.feeds ?? [];
  const suggested = lookup.kind === "raw" ? suggestDescription(lookup.feeds[0]) : lookup.kind === "composite" ? suggestCompositeDescription(lookup.feeds[0], lookup.feeds[1], lookup.invertQuote) : null;

  // A feed just found: take its 24/7 flag from Pyth's schedule and, unless the user wrote their own,
  // its description.
  const resolvedKey = resolved?.feedId ?? null;
  useEffect(() => {
    if (!resolved) return;
    if (resolved.kind === "composite") setContinuous(false);
    else {
      const is247 = scheduleIs247(resolved.feeds[0].schedule);
      if (is247 !== null) setContinuous(is247);
    }
    if (!descTouched && suggested) setDesc(suggested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedKey]);

  const descErr = desc ? listings.descriptionProblem(desc) : null;
  const descWarn = !descErr && feeds.length ? descriptionMismatch(desc, feeds) : null;
  const flagWarn = continuousMismatch(continuous, feeds, lookup.kind === "composite");
  const dead = feeds.filter((s) => !feedIsLive(s));
  const blocker =
    lookup.kind === "unknown"
      ? "Pyth Pro's registry lists no feed with this ID, and it isn't a composite registered on Bazaar's oracle. A listing of it would be disputed and lose its bond."
      : lookup.kind === "invalid"
        ? lookup.message
        : null;

  return (
    <Modal title="Propose a new market" onClose={onClose} wide>
      <div className="stack">
        <p className="small muted">
          Anyone can list a market. You post a UMA bond (at least 1,000 USDC, returned if nobody disputes successfully) and an insurance seed (at least 3,000 USDC, which becomes the market's
          insurance fund and your shares). Anyone can dispute within 48 hours, so the feed, the 24/7 flag and the description must match what Pyth publishes.
        </p>
        <label className="field">
          Asset: search Pyth (e.g. AAPL, gold) or enter a feed ID
          <input value={feed} onChange={(e) => setFeed(e.target.value)} placeholder="AAPL, or 922, or a composite id 0x…" autoFocus />
        </label>
        <div className="small muted">
          Not sure what to list? Browse{" "}
          <a href={PYTH_FEEDS_URL} target="_blank" rel="noopener noreferrer">
            every Pyth feed ↗
          </a>
          , then search for its name or enter its feed ID here.
          {ACTIVE.testnet && <b> On testnet, only crypto and US equities are available for now.</b>}
        </div>
        {registry.error ? <div className="small accent">Pyth's registry can't be read right now, so the feed can't be checked here. The proposal is still checked against it when you review.</div> : null}
        {lookup.kind === "search" &&
          (registry.loading && !registry.data ? (
            <div className="small muted">Reading Pyth's registry…</div>
          ) : lookup.matches.length === 0 ? (
            <div className="small muted">No Pyth feed matches “{feed.trim()}”.</div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 240, overflowY: "auto" }}>
              <table>
                <tbody>
                  {lookup.matches.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => setFeed(String(s.id))}>
                      <td>
                        <b>{feedLabelOf(s.symbol)}</b>
                        <div className="small muted">{s.description}</div>
                      </td>
                      <td className="small muted">{s.assetType}</td>
                      <td className="small">{scheduleIs247(s.schedule) ? "24/7" : "trading hours"}</td>
                      <td className={`small ${feedIsLive(s) ? "muted" : "down"}`}>{s.state}</td>
                      <td className="num small">#{s.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {lookup.kind === "checking" && <div className="small muted">Checking the feed against Pyth's registry…</div>}
        {lookup.kind === "raw" && <FeedCard s={lookup.feeds[0]} />}
        {lookup.kind === "composite" && (
          <>
            <div className="small muted">A composite registered on Bazaar's oracle: the asset priced in USD through an FX feed{lookup.invertQuote ? " (inverted)" : ""}.</div>
            <FeedCard s={lookup.feeds[0]} role="Asset" />
            <FeedCard s={lookup.feeds[1]} role="FX leg" />
          </>
        )}
        {blocker && <div className="callout bad small">{blocker}</div>}
        {dead.length > 0 && (
          <div className="callout bad small">
            Pyth lists {dead.map((s) => feedLabelOf(s.symbol)).join(" and ")} as {dead.map((s) => s.state).join(" / ")}
            {dead.some((s) => /deprecated/i.test(s.description)) ? " (deprecated)" : ""}. A market on a feed Pyth doesn't publish normally is likely to be disputed, or terminated soon after.
          </div>
        )}

        <label className="check small">
          <input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} /> Trades 24/7 (crypto). Untick for stocks, FX and other venues with hours.
        </label>
        {flagWarn && <div className="callout small">{flagWarn}</div>}

        <label className="field">
          <span className="spread">
            <span>Description (letters, digits, spaces and . , &amp; / - only)</span>
            {suggested && desc !== suggested && (
              <button
                className="link small"
                onClick={() => {
                  setDesc(suggested);
                  setDescTouched(false);
                }}
              >
                Use Pyth's
              </button>
            )}
          </span>
          <input
            value={desc}
            maxLength={listings.MAX_DESCRIPTION_LENGTH}
            onChange={(e) => {
              setDesc(e.target.value);
              setDescTouched(true);
            }}
            placeholder="Filled in from Pyth once you pick a feed"
          />
          <span className="small muted">
            {desc.length}/{listings.MAX_DESCRIPTION_LENGTH}
          </span>
          {descErr && <span className="field-error">{descErr}</span>}
        </label>
        {descWarn && <div className="callout small">{descWarn}</div>}

        <label className="field">
          Total deposit, bond plus seed (USDC)
          <input className="num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
        </label>
        {shortfall && (
          <div className="callout bad small">
            {shortfall}
            {ACTIVE.testnet && (
              <>
                {" "}
                <FaucetButton compact onDone={readHeldAgain} /> <TestUsdcHelpLink />
              </>
            )}
          </div>
        )}
        <Notice text={costed.notice} onClose={costed.clear} />
        <button
          className="primary"
          disabled={!resolved || !desc || !!descErr || !!blocker || !!shortfall || parseInput(total) === null}
          onClick={() =>
            resolved &&
            void costed.run(
              "Propose a market",
              (bz, user) =>
                bz.listings.proposePairDeployment({
                  baseFeedId: resolved.feedId,
                  isContinuouslyTraded: continuous,
                  totalAmount: parseUnits18(total.trim()),
                  description: desc,
                  from: user,
                  // The connection has no Pyth Pro source, so name the registry for the builder's own check.
                  registry: PYTH_PRO.symbolsUrl,
                }),
              // Once it lands, close the form; closing reloads the list, which now shows the proposal.
              onClose,
            )
          }
        >
          Review proposal
        </button>
        {(descWarn || flagWarn) && resolved && <div className="small muted">You can still review it, but fix the warnings above unless you're sure: UMA's verifiers judge the listing on them.</div>}
      </div>
    </Modal>
  );
}


const LISTING_STATUS: Record<listings.DeploymentStatus, string> = {
  inReview: "In UMA review",
  settleable: "Ready to deploy",
  disputed: "Disputed: UMA's voters decide",
  deployed: "Deployed",
  notDeployed: "Not deployed",
};

function Listings() {
  const { readBz } = useRead();
  const w = useWallet();
  const costed = useCosted();
  const early = useCanSettleEarly();
  const [propose, setPropose] = useState(false);
  const [n, setN] = useState(0);
  const open = useAsync(async () => (readBz ? (await readBz.listings.openListings()).listings : []), [readBz, n]);
  // The open listings' transactions, for their details. The resolved ones page below, however many.
  const openTx = useAsync(async () => (readBz ? (await readBz.history.listingProposals({ status: ["Pending", "Disputed"], first: 100 })).items : []), [readBz, n]);
  const txOf = useMemo(() => new Map((openTx.data ?? []).map((p) => [p.id.toLowerCase(), p.transactionHash])), [openTx.data]);
  const refund = useAsync(async () => (readBz && w.address ? readBz.listings.seedRefundOwed(w.address) : 0n), [readBz, w.address, n]);
  const now = Date.now() / 1000;
  const reload = () => setN((x) => x + 1);
  const { sorted: openSorted, th } = useSort(open.data ?? [], {
    asset: (l) => l.description,
    status: (l) => LISTING_STATUS[l.status],
    seed: (l) => l.seedAmountUsdc,
    // When the next step opens: disputes closing, or a disputed listing's release.
    deadline: (l) => (l.status === "inReview" ? l.livenessEndsAt : l.status === "disputed" ? l.releaseOpensAt : 0),
  });
  return (
    <section className="panel tight">
      <div className="panel-head">
        <h2>Market listings</h2>
        <button className="small primary" onClick={() => setPropose(true)}>
          Propose a market
        </button>
      </div>
      <div className="panel-body stack">
        <Notice text={costed.notice} onClose={costed.clear} />
        {(refund.data ?? 0n) > 0n && (
          <div className="callout small row">
            <span className="grow">A listing seed of {uma.usdcText(refund.data!)} is owed back to you.</span>
            <button className="small" onClick={() => void costed.run("Claim seed refund", (bz, user) => bz.listings.claimSeedRefund({ from: user }), reload)}>
              Claim
            </button>
          </div>
        )}
        <h3>Open</h3>
        {open.loading && !open.data ? (
          <Loading />
        ) : !open.data?.length ? (
          <Empty title="No listing is open">Propose one to add a market. It deploys if nobody disputes it within 48 hours.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead>
                <tr>
                  <th {...th("asset")}>Asset</th>
                  <th {...th("status")}>Status</th>
                  <th {...th("seed", "num")}>Seed</th>
                  <th {...th("deadline")}>Deadline</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {openSorted.map((l) => (
                  <tr key={l.assertionId}>
                    <td data-main="">
                      <b>{l.description}</b>
                      <div className="small muted mono">
                        {feedText(l.baseFeedId)} · {l.isContinuouslyTraded ? "24/7" : "trading hours"} · by {shortAddr(l.deployer)}
                      </div>
                      <ProposalDetails
                        txHash={txOf.get(l.assertionId.toLowerCase())}
                        facts={[
                          { k: "Description", v: l.description },
                          { k: "Feed", v: <FeedName feedId={l.baseFeedId} /> },
                          { k: "Trades", v: l.isContinuouslyTraded ? "24/7" : "during trading hours" },
                          { k: "Proposed by", v: <Addr a={l.deployer} /> },
                          { k: "Proposed", v: dateTime(l.proposalTs) },
                          { k: "Disputes close", v: dateTime(l.livenessEndsAt) },
                          { k: "Insurance seed", v: uma.usdcText(l.seedAmountUsdc) },
                          { k: "Disputed", v: yesNo(l.disputed) },
                          { k: "UMA assertion", v: <Mono>{l.assertionId}</Mono> },
                        ]}
                        note="UMA's voters judge a claim the factory writes from the description, the feed and the 24/7 flag, followed by the checks every listing must pass: an active Pyth Pro feed, an eligible asset, the asset's own spot feed and one market per asset, a US dollar price, the right trading schedule, and no termination event pending."
                      />
                    </td>
                    <td data-label="Status">
                      {LISTING_STATUS[l.status]}
                      <div>
                        <AssertionLine id={l.assertionId} home="factory" />
                      </div>
                    </td>
                    <td data-label="Seed" className="num">{uma.usdcText(l.seedAmountUsdc)}</td>
                    <td data-label="Deadline" className="small">
                      {l.status === "inReview" ? `disputes close ${relative(l.livenessEndsAt)}` : l.status === "disputed" ? `release from ${dateTime(l.releaseOpensAt)}` : "now"}
                    </td>
                    <td data-actions="">
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        {l.status === "inReview" && (
                          <button className="small" onClick={() => void costed.run("Dispute listing", (bz, user) => bz.uma.disputeAssertion({ assertionId: l.assertionId, from: user, home: "factory" }), reload)}>
                            Dispute
                          </button>
                        )}
                        {l.status === "inReview" && early && (
                          <button
                            className="small primary"
                            title={SETTLE_EARLY_TIP}
                            onClick={() => void costed.run("Settle listing early", (bz, user) => bz.uma.settleEarly({ assertionId: l.assertionId, from: user, home: "factory" }), reload)}
                          >
                            Settle early
                          </button>
                        )}
                        {(l.status === "settleable" || l.status === "disputed") && (
                          <button className="small primary" onClick={() => void costed.run("Settle listing", (bz, user) => bz.listings.settleDeploymentProposal({ assertionId: l.assertionId, from: user }), reload)}>
                            Settle
                          </button>
                        )}
                        {now >= l.releaseOpensAt && l.status !== "settleable" && (
                          <button className="small" onClick={() => void costed.run("Release stuck listing", (bz, user) => bz.listings.expireStuckDeploymentProposal({ pairId: l.pairId, from: user }), reload)}>
                            Release
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <h3>Resolved</h3>
        {!readBz ? (
          <Loading />
        ) : (
          <HistoryList<history.ListingProposal>
            deps={[readBz, n]}
            filename="bazaar-listings.csv"
            pageSize={PROPOSALS_PAGE}
            load={(o) => readBz.history.listingProposals({ status: ["Deployed", "Rejected", "Expired", "Voided"], ...o })}
            empty={{ title: "None yet", text: "Listings show here once UMA settles them." }}
            columns={[
              { header: "Proposed", csvHeader: "proposed", cell: (p) => dateTime(p.proposedAt), csv: (p) => new Date(p.proposedAt * 1000).toISOString() },
              {
                header: "Asset",
                csvHeader: "description",
                cell: (p) => (
                  <>
                    <b>{p.description}</b>
                    <ProposalDetails
                      txHash={p.transactionHash}
                      facts={[
                        { k: "Description", v: p.description },
                        { k: "Feed", v: <FeedName feedId={p.baseFeedId} /> },
                        { k: "Outcome", v: p.status },
                        { k: "Proposed by", v: <Addr a={p.deployer} /> },
                        { k: "Proposed", v: dateTime(p.proposedAt) },
                        { k: "Dispute deadline", v: dateTime(p.livenessEndsAt) },
                        { k: "Disputed", v: yesNo(p.disputed) },
                        p.resolvedAt !== null && { k: "Resolved", v: dateTime(p.resolvedAt) },
                        { k: "Insurance seed", v: `${amount(p.seedAmount, 2)} USDC` },
                        p.seedRefundUsdc !== null && { k: "Seed returned", v: uma.usdcText(p.seedRefundUsdc) },
                        p.pair && { k: "Market", v: <Addr a={p.pair} /> },
                        { k: "UMA assertion", v: <Mono>{p.id}</Mono> },
                      ]}
                    />
                  </>
                ),
                csv: (p) => p.description,
              },
              { header: "Outcome", csvHeader: "outcome", cell: (p) => p.status, csv: (p) => p.status },
              { header: "Resolved", csvHeader: "resolved", cell: (p) => (p.resolvedAt ? dateTime(p.resolvedAt) : "–"), csv: (p) => (p.resolvedAt ? new Date(p.resolvedAt * 1000).toISOString() : "") },
              { header: "Market", csvHeader: "market", cell: (p) => (p.pair ? <Link to={`/market/${p.pair}`}>open market</Link> : <span className="muted">–</span>), csv: (p) => p.pair ?? "" },
              { header: "", csvHeader: "transaction", cell: (p) => <TxLink hash={p.transactionHash}>tx ↗</TxLink>, csv: (p) => p.transactionHash },
            ]}
          />
        )}
      </div>
      {propose && <ProposeListing onClose={() => (setPropose(false), reload())} />}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Terminations
// ---------------------------------------------------------------------------------------------

function ProposeTermination({ m, insurer, onClose }: { m: markets.MarketInfo; insurer: boolean; onClose: () => void }) {
  const costed = useCosted();
  const [category, setCategory] = useState<number>(term.TerminationCategory.OracleDecommission);
  const [cutoff, setCutoff] = useState(() => new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16));
  const [reason, setReason] = useState("");
  const cutoffTs = Math.floor(new Date(cutoff).getTime() / 1000);
  const reasonErr = !insurer && reason ? term.reasonProblem(reason) : null;
  return (
    <Modal title={insurer ? `Insurer vote to end ${m.label}` : `Propose ending ${m.label}`} onClose={onClose}>
      <div className="stack">
        {insurer ? (
          <p className="small muted">
            A vote by this market's insurers. It ends the market at the cutoff if insurers holding 60% of matured shares vote yes at least an hour before. You post a 1,000 USDC bond (refunded
            unless the vote fails short of 60%) and need shares deposited at least 4 days ago.
          </p>
        ) : (
          <p className="small muted">
            A claim to UMA that the market should end, with a bond of at least 1,000 USDC that is returned if the claim is accepted. Anyone can dispute it for 12 hours. Price moves are never grounds.
          </p>
        )}
        {!insurer && (
          <label className="field">
            Grounds
            <select value={category} onChange={(e) => setCategory(Number(e.target.value))}>
              {Object.entries(term.TERMINATION_CATEGORY_INFO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.name}
                </option>
              ))}
            </select>
            <span className="small muted">{term.TERMINATION_CATEGORY_INFO[category as term.TerminationCategory].description}</span>
          </label>
        )}
        <label className="field">
          Last trading time (your local time)
          <input type="datetime-local" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          <span className="small muted">{insurer ? "2 hours to 14 days from now." : "At least 2 hours out; 12 hours or more is enforced as proposed."}</span>
        </label>
        {!insurer && (
          <label className="field">
            Reason and evidence
            <textarea rows={4} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What happened, with links to official sources" />
            {reasonErr && <span className="field-error">{reasonErr}</span>}
          </label>
        )}
        <Notice text={costed.notice} onClose={costed.clear} />
        <button
          className="primary"
          disabled={!Number.isFinite(cutoffTs) || (!insurer && (!reason || !!reasonErr))}
          onClick={() =>
            void costed.run(
              insurer ? "Propose insurer vote" : "Propose termination",
              (bz, user) =>
                insurer
                  ? bz.termination.proposeInsurerTermination({ pair: m.address, cutoffTs, from: user })
                  : bz.termination.proposeTermination({ pair: m.address, category, lastTradingTs: cutoffTs, reason, from: user }),
              // Once it lands, close the form and reload, as the listing form does.
              onClose,
            )
          }
        >
          Review
        </button>
      </div>
    </Modal>
  );
}

function VoteDialog({ m, v, onClose }: { m: markets.MarketInfo; v: term.InsurerProposalInfo; onClose: () => void }) {
  const costed = useCosted();
  const [text, setText] = useState("");
  const shares = parseInput(text);
  return (
    <Modal title={`Vote to end ${m.label}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">
          Votes count shares deposited at least 4 days before the vote opened, and can't be withdrawn. Voted shares are locked until the cutoff; if the vote ends the market and UMA doesn't uphold
          it, part of them is forfeited. The confirmation lists exactly what's at stake.
        </p>
        <div className="kv">
          <span>Yes so far</span>
          <span>
            {amount(v.yesShares, 4)} of {amount(v.thresholdShares, 4)} needed
          </span>
          <span>Cutoff</span>
          <span>{dateTime(v.cutoffTs)}</span>
        </div>
        <label className="field">
          Shares to vote
          <input className="num" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <Notice text={costed.notice} onClose={costed.clear} />
        <button className="primary" disabled={!shares || shares <= 0n} onClick={() => void costed.run("Vote yes", (bz, user) => bz.termination.voteForInsurerTermination({ pair: m.address, id: v.id, shares: shares!, from: user }), onClose)}>
          Review vote
        </button>
      </div>
    </Modal>
  );
}

const PHASE_TEXT: Record<term.TerminationPhase, string> = {
  live: "No end scheduled",
  scheduled: "End scheduled",
  limbo: "Trading stopped; waiting for the final price",
  settling: "Settling positions at the final price",
  terminated: "Ended",
};

function MarketTermination({
  m,
  snap,
  claimTx,
  voteTx,
}: {
  m: markets.MarketInfo;
  snap: markets.MarketSnapshot | undefined;
  /** Each recent claim's and vote's transaction, by id (lower case), from the history below. */
  claimTx: ReadonlyMap<string, Hex>;
  voteTx: ReadonlyMap<string, Hex>;
}) {
  const { readBz } = useRead();
  const w = useWallet();
  const costed = useCosted();
  const early = useCanSettleEarly();
  const [n, setN] = useState(0);
  const [dialog, setDialog] = useState<null | { kind: "uma" | "insurer" } | { kind: "vote"; v: term.InsurerProposalInfo }>(null);
  const st = useAsync(async () => (readBz ? readBz.termination.terminationStatus(m.address) : null), [readBz, m.address, n]);
  const myShares = useAsync(async () => (readBz && w.address ? readBz.insurance.insuranceShares(m.address, w.address) : 0n), [readBz, w.address, m.address]);
  const reload = () => setN((x) => x + 1);
  const s = st.data;
  const stale = snap && snap.price.age > ORACLE_DEAD_THRESHOLD;
  const now = s?.now ?? Date.now() / 1000;
  const act = (label: string, build: (bz: Bazaar, user: Address) => Promise<Costed | null>) => () => void costed.run(label, build, reload);

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div className="spread">
        <div className="row">
          <Link to={`/market/${m.address}`}>
            <b>{m.label}</b>
          </Link>
          {snap && <StatusBadge status={snap.status} />}
          {s && <span className="small muted">{PHASE_TEXT[s.phase]}</span>}
          {s && s.scheduledTerminationTs !== null && s.scheduledTerminationTs > 0 && <span className="small">cutoff {dateTime(s.scheduledTerminationTs)}</span>}
        </div>
        <div className="row">
          {s && (s.phase === "live" || s.phase === "scheduled") && (
            <>
              <button className="small" onClick={() => setDialog({ kind: "uma" })}>
                Propose ending (UMA)
              </button>
              {(myShares.data ?? 0n) > 0n && (
                <button className="small" onClick={() => setDialog({ kind: "insurer" })}>
                  Insurer vote
                </button>
              )}
            </>
          )}
          {stale && s?.phase === "live" && (
            <button className="small" onClick={act("End stale market", (bz, user) => bz.termination.terminateStalePair({ pair: m.address, from: user }))}>
              End stale market
            </button>
          )}
          {s?.phase === "limbo" && s.cutoffPassed && (
            <button
              className="small primary"
              onClick={act("Fix the final price", async (bz, user) => {
                const plan = await bz.termination.terminateScheduledPair({ pair: m.address, from: user });
                if (!plan.call) throw new Error(`${plan.reason ?? "No proven final price yet."}${plan.retryAt ? ` Try again ${relative(plan.retryAt)}.` : ""}`);
                return plan.call;
              })}
            >
              Fix final price
            </button>
          )}
          {s?.phase === "settling" && s.finalizeOpensAt !== null && now >= s.finalizeOpensAt && (
            <button className="small primary" onClick={act("Finalize", (bz, user) => bz.termination.finalizeTermination({ pair: m.address, from: user }))}>
              Finalize
            </button>
          )}
        </div>
      </div>
      <Notice text={costed.notice} onClose={costed.clear} />
      {s && (s.openProposals.termination.length > 0 || s.openProposals.insurer.length > 0) && (
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="rtable">
            <tbody>
              {s.openProposals.termination.map((c) => (
                <tr key={c.assertionId}>
                  <td data-main="">
                    UMA claim: <b>{c.categoryName}</b>
                    <div className="small muted" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {c.reason}
                    </div>
                    <ProposalDetails
                      txHash={claimTx.get(c.assertionId.toLowerCase())}
                      facts={[
                        { k: "Grounds", v: c.categoryName },
                        groundsOf(c.category) && { k: "Which means", v: groundsOf(c.category)!.description },
                        { k: "Reason", v: <span className="prewrap">{c.reason}</span> },
                        { k: "Proposed cutoff", v: dateTime(c.lastTradingTs) },
                        { k: "Proposed by", v: <Addr a={c.proposer} /> },
                        { k: "Proposed", v: dateTime(c.proposalTs) },
                        { k: "Disputes close", v: dateTime(c.livenessEndsAt) },
                        { k: "UMA assertion", v: <Mono>{c.assertionId}</Mono> },
                      ]}
                    />
                  </td>
                  <td data-label="Cutoff" className="small">
                    cutoff {dateTime(c.lastTradingTs)}
                    <div>
                      <AssertionLine id={c.assertionId} home="terminator" />
                    </div>
                  </td>
                  <td data-actions="">
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      {now < c.livenessEndsAt && (
                        <button className="small" onClick={act("Dispute claim", (bz, user) => bz.uma.disputeAssertion({ assertionId: c.assertionId, from: user, home: "terminator" }))}>
                          Dispute
                        </button>
                      )}
                      {now < c.livenessEndsAt && early && (
                        <button
                          className="small primary"
                          title={SETTLE_EARLY_TIP}
                          onClick={act("Settle claim early", (bz, user) => bz.uma.settleEarly({ assertionId: c.assertionId, from: user, home: "terminator" }))}
                        >
                          Settle early
                        </button>
                      )}
                      {now >= c.livenessEndsAt && (
                        <button className="small primary" onClick={act("Settle claim", (bz, user) => bz.termination.settleTerminationProposal({ assertionId: c.assertionId, from: user }))}>
                          Settle
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {s.openProposals.insurer.map((v) => (
                <tr key={v.id}>
                  <td data-main="">
                    Insurer vote {v.claimBacked ? "(with a UMA claim)" : ""}
                    <div className="small muted">
                      {v.state} · yes {amount(v.yesShares, 2)} / {amount(v.thresholdShares, 2)} shares needed
                    </div>
                    <ProposalDetails
                      txHash={voteTx.get(v.id.toLowerCase())}
                      facts={[
                        { k: "Kind", v: v.claimBacked ? "Opened by a UMA claim" : "Insurers' own vote" },
                        { k: "State", v: v.state },
                        { k: "Cutoff", v: dateTime(v.cutoffTs) },
                        { k: "Voting opens", v: dateTime(v.windowOpenTs) },
                        { k: "Voting closes", v: dateTime(v.votingClosesAt) },
                        { k: "Yes votes", v: `${amount(v.yesShares, 4)} shares` },
                        { k: "Needed", v: v.snapshotTaken ? `${amount(v.thresholdShares, 4)} shares, 60% of ${amount(v.snapshotTotalShares, 4)}` : "set when voting opens" },
                        { k: "Proposed by", v: <Addr a={v.proposer} /> },
                        { k: "Proposed", v: dateTime(v.proposalTs) },
                        { k: v.claimBacked ? "UMA assertion" : "Vote id", v: <Mono>{v.id}</Mono> },
                      ]}
                    />
                  </td>
                  <td data-label="Cutoff" className="small">
                    cutoff {dateTime(v.cutoffTs)}
                    <div className="muted">voting closes {relative(v.votingClosesAt, now)}</div>
                  </td>
                  <td data-actions="">
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      {v.state === "voting" && (myShares.data ?? 0n) > 0n && (
                        <button className="small" onClick={() => setDialog({ kind: "vote", v })}>
                          Vote yes
                        </button>
                      )}
                      {(v.thresholdMet || v.state === "expired") && !v.resolved && (
                        <button className="small primary" onClick={act("Execute vote", (bz, user) => bz.termination.executeInsurerTermination({ pair: m.address, id: v.id, from: user }))}>
                          Execute
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(dialog?.kind === "uma" || dialog?.kind === "insurer") && <ProposeTermination m={m} insurer={dialog.kind === "insurer"} onClose={() => (setDialog(null), reload())} />}
      {dialog?.kind === "vote" && <VoteDialog m={m} v={dialog.v} onClose={() => (setDialog(null), reload())} />}
    </div>
  );
}

function Terminations() {
  const { readBz, markets: list } = useRead();
  const { snaps } = useMarketSnapshots();
  // The open claims' and votes' transactions, for their details in the market panel. The history pages
  // below, however long it gets.
  const openTx = useAsync(async () => {
    if (!readBz) return null;
    const [claims, votes] = await Promise.all([
      readBz.history.terminationProposals({ status: ["Pending", "Disputed"], first: 100 }),
      readBz.history.insurerProposals({ status: ["Open", "Scheduled"], first: 100 }),
    ]);
    return { claims: claims.items, votes: votes.items };
  }, [readBz]);
  const claimTx = useMemo(() => new Map((openTx.data?.claims ?? []).map((c) => [c.id.toLowerCase(), c.transactionHash])), [openTx.data]);
  const voteTx = useMemo(() => new Map((openTx.data?.votes ?? []).map((v) => [v.id.toLowerCase(), v.transactionHash])), [openTx.data]);
  // UMA claims and insurer votes, newest first, as one list a page at a time.
  const loadHistory = useMemo(() => {
    if (!readBz) return null;
    type Opts = { first: number; to?: number };
    return mergeByTime<TerminationRow>([
      async (o: Opts) => {
        const p = await readBz.history.terminationProposals(o);
        return { next: p.next, items: p.items.map((c): TerminationRow => ({ kind: "claim", c, timestamp: c.submittedAt })) };
      },
      async (o: Opts) => {
        const p = await readBz.history.insurerProposals(o);
        return { next: p.next, items: p.items.map((v): TerminationRow => ({ kind: "vote", v, timestamp: v.createdAt })) };
      },
    ]);
  }, [readBz]);
  // One market at a time, picked from the list: its state, open claims and votes, and what can be done.
  const [chosen, setChosen] = useState<Address | null>(null);
  const find = (p: Address) => list.find((m) => m.address.toLowerCase() === p.toLowerCase());
  const picked = chosen ? find(chosen) : undefined;
  // A market named in the history opens it above, where its open claims and votes can be acted on.
  const marketName = (p: Address) => {
    const m = find(p);
    return m ? (
      <button className="link small" onClick={() => setChosen(m.address)}>
        {m.label}
      </button>
    ) : (
      shortAddr(p)
    );
  };
  return (
    <section className="panel tight">
      <div className="panel-head">
        <h2>Market terminations</h2>
      </div>
      <div className="panel-body">
        <p className="small muted">
          A market can be ended if its price feed stops, its asset is delisted, or its price series breaks. Anyone can propose it to UMA with a bond; a market's{" "}
          <Term t="insurance">insurers</Term> can also vote it through. Ended markets settle every position at a final price.
        </p>
        {!list.length ? (
          <Loading />
        ) : (
          <>
            <label className="field" style={{ maxWidth: 320, marginBottom: 10 }}>
              Market
              <select value={picked?.address ?? ""} onChange={(e) => setChosen(e.target.value ? (e.target.value as Address) : null)}>
                <option value="">Choose a market…</option>
                {list.map((m) => {
                  // A market that is no longer simply live says so, so one already ending stands out.
                  const status = snaps.get(m.address)?.status;
                  return (
                    <option key={m.address} value={m.address}>
                      {m.label}
                      {status && status !== "live" ? ` · ${STATUS_TEXT[status]?.label ?? status}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            {picked && <MarketTermination key={picked.address} m={picked} snap={snaps.get(picked.address)} claimTx={claimTx} voteTx={voteTx} />}
          </>
        )}
        <h3 style={{ marginTop: 12 }}>History</h3>
        {!loadHistory ? (
          <Loading />
        ) : (
          <HistoryList<TerminationRow>
            deps={[loadHistory]}
            filename="bazaar-terminations.csv"
            pageSize={PROPOSALS_PAGE}
            load={loadHistory}
            empty={{ title: "No termination has been proposed yet" }}
            columns={[
              { header: "Proposed", csvHeader: "proposed", cell: (r) => dateTime(r.timestamp), csv: (r) => new Date(r.timestamp * 1000).toISOString() },
              {
                header: "Market",
                csvHeader: "market",
                cell: (r) => marketName(r.kind === "claim" ? r.c.pair : r.v.pair),
                csv: (r) => find(r.kind === "claim" ? r.c.pair : r.v.pair)?.label ?? (r.kind === "claim" ? r.c.pair : r.v.pair),
              },
              { header: "Kind", csvHeader: "kind", cell: (r) => (r.kind === "claim" ? "UMA claim" : "Insurer vote"), csv: (r) => (r.kind === "claim" ? "uma claim" : "insurer vote") },
              { header: "Outcome", csvHeader: "outcome", cell: (r) => (r.kind === "claim" ? r.c.status : r.v.status), csv: (r) => (r.kind === "claim" ? r.c.status : r.v.status) },
              {
                header: "Cutoff",
                csvHeader: "cutoff",
                cell: (r) => dateTime(r.kind === "claim" ? r.c.lastTradingTs : r.v.cutoffTs),
                csv: (r) => new Date((r.kind === "claim" ? r.c.lastTradingTs : r.v.cutoffTs) * 1000).toISOString(),
              },
              {
                header: "Details",
                csvHeader: "reason",
                cell: (r) => (r.kind === "claim" ? <ClaimDetails c={r.c} /> : <VoteDetails v={r.v} />),
                csv: (r) => (r.kind === "claim" ? r.c.reason : r.v.claimBacked ? "opened by a UMA claim" : "insurers' own vote"),
              },
              { header: "", csvHeader: "transaction", cell: (r) => <TxLink hash={r.kind === "claim" ? r.c.transactionHash : r.v.transactionHash}>tx ↗</TxLink>, csv: (r) => (r.kind === "claim" ? r.c.transactionHash : r.v.transactionHash) },
            ]}
          />
        )}
      </div>
    </section>
  );
}

/** One row of the termination history: a UMA claim or an insurer vote, by when it was proposed. */
type TerminationRow = { readonly kind: "claim"; readonly c: history.TerminationProposal; readonly timestamp: number } | { readonly kind: "vote"; readonly v: history.InsurerProposal; readonly timestamp: number };

function ClaimDetails({ c }: { c: history.TerminationProposal }) {
  return (
    <>
      <span className="small" style={{ overflowWrap: "anywhere" }}>
        {c.reason}
      </span>
      <ProposalDetails
        txHash={c.transactionHash}
        facts={[
          { k: "Grounds", v: groundsOf(c.category)?.name ?? `category ${c.category}` },
          groundsOf(c.category) && { k: "Which means", v: groundsOf(c.category)!.description },
          { k: "Reason", v: <span className="prewrap">{c.reason}</span> },
          { k: "Outcome", v: c.status },
          { k: "Proposed cutoff", v: dateTime(c.lastTradingTs) },
          c.acceptedCutoffTs !== null && { k: "Accepted cutoff", v: dateTime(c.acceptedCutoffTs) },
          { k: "Proposed by", v: <Addr a={c.proposer} /> },
          { k: "Proposed", v: dateTime(c.submittedAt) },
          { k: "Dispute deadline", v: dateTime(c.livenessEndsAt) },
          { k: "Disputed", v: yesNo(c.disputed) },
          c.resolvedAt !== null && { k: "Resolved", v: dateTime(c.resolvedAt) },
          { k: "Market", v: <Addr a={c.pair} /> },
          { k: "UMA assertion", v: <Mono>{c.id}</Mono> },
        ]}
      />
    </>
  );
}

function VoteDetails({ v }: { v: history.InsurerProposal }) {
  const verdict = v.outcome ? term.OUTCOME_NAMES[v.outcome] : undefined;
  return (
    <>
      <span className="small muted">{v.claimBacked ? "Opened by a UMA claim" : "Insurers' own vote"}</span>
      <ProposalDetails
        txHash={v.transactionHash}
        facts={[
          { k: "Kind", v: v.claimBacked ? "Opened by a UMA claim" : "Insurers' own vote" },
          { k: "Outcome", v: v.status },
          { k: "Cutoff", v: dateTime(v.cutoffTs) },
          { k: "Voting opened", v: dateTime(v.windowOpenTs) },
          { k: "Yes votes", v: `${amount(v.yesShares, 4)} shares` },
          v.snapshotTotalShares !== null && { k: "Shares at the snapshot", v: amount(v.snapshotTotalShares, 4) },
          v.thresholdMet !== null && { k: "Reached 60%", v: yesNo(v.thresholdMet) },
          verdict && verdict !== "none" && { k: "For yes-voters", v: term.OUTCOME_TEXT[verdict] },
          v.levyBp !== null && { k: "Levy", v: `${(Number(v.levyBp) / 100).toFixed(2)}%` },
          { k: "Proposed by", v: <Addr a={v.proposer} /> },
          { k: "Proposed", v: dateTime(v.createdAt) },
          v.resolvedAt !== null && { k: "Resolved", v: dateTime(v.resolvedAt) },
          { k: "Market", v: <Addr a={v.pair} /> },
          { k: v.claimBacked ? "UMA assertion" : "Vote id", v: <Mono>{v.id}</Mono> },
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The UMA identifier
// ---------------------------------------------------------------------------------------------

function Identifier() {
  const { readBz } = useRead();
  const costed = useCosted();
  const early = useCanSettleEarly();
  const [n, setN] = useState(0);
  const [propose, setPropose] = useState(false);
  const [id, setId] = useState("");
  const g = useAsync(async () => (readBz ? readBz.governance.identifierGovernance() : null), [readBz, n]);
  // The pending and queued proposals' transactions, for their details. The history pages below.
  const openTx = useAsync(async () => (readBz ? (await readBz.history.identifierUpgradeProposals({ status: ["Pending", "Disputed", "Queued"], first: 20 })).items : []), [readBz, n]);
  const txOf = useMemo(() => new Map((openTx.data ?? []).map((p) => [p.id.toLowerCase(), p.transactionHash])), [openTx.data]);
  const reload = () => setN((x) => x + 1);
  const s = g.data;
  const idText = (id: Hex) => uma.identifierText(id) ?? id;
  return (
    <section className="panel tight">
      <div className="panel-head">
        <h2>UMA identifier</h2>
        <button className="small" onClick={() => setPropose(true)}>
          Propose an upgrade
        </button>
      </div>
      <div className="panel-body stack">
        <p className="small muted">
          Bazaar has no admin and no token vote. Listings and terminations are judged by UMA under one identifier; swapping it is the protocol's only governance lever.
        </p>
        <Notice text={costed.notice} onClose={costed.clear} />
        {!s ? (
          <Loading />
        ) : (
          <div className="kv">
            <span>In force</span>
            <span>
              {s.umaIdentifierText ?? s.umaIdentifier} {s.umaIdentifierIsLive ? <span className="badge live">live</span> : <span className="badge bad">off UMA's whitelist</span>}
            </span>
            <span>Pending proposal</span>
            <span>
              {s.pending ? (
                <>
                  {s.pending.newIdentifierText ?? s.pending.newIdentifier} · {uma.ASSERTION_PHASE_TEXT[s.pending.assertion.phase]}
                  {(s.pending.assertion.phase === "settleable" || s.pending.assertion.phase === "disputed") && (
                    <div>
                      <button className="small primary" onClick={() => void costed.run("Settle upgrade", (bz, user) => bz.governance.settleIdentifierUpgradeProposal({ assertionId: s.pending!.assertionId, from: user }), reload)}>
                        Settle
                      </button>
                    </div>
                  )}
                  {s.pending.assertion.phase === "liveness" && (
                    <div>
                      <AssertionLine id={s.pending.assertionId} home="factory" />
                      <button className="small" onClick={() => void costed.run("Dispute upgrade", (bz, user) => bz.uma.disputeAssertion({ assertionId: s.pending!.assertionId, from: user, home: "factory" }), reload)}>
                        Dispute
                      </button>
                      {early && (
                        <button
                          className="small primary"
                          title={SETTLE_EARLY_TIP}
                          onClick={() => void costed.run("Settle upgrade early", (bz, user) => bz.uma.settleEarly({ assertionId: s.pending!.assertionId, from: user, home: "factory" }), reload)}
                        >
                          Settle early
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                "none"
              )}
            </span>
            <span>Queued upgrade</span>
            <span>
              {s.queued ? (
                <>
                  {s.queued.newIdentifierText ?? s.queued.newIdentifier} · activates {dateTime(s.queued.activationOpensAt)}
                  {s.queued.canActivate && (
                    <div>
                      <button className="small primary" onClick={() => void costed.run("Activate upgrade", (bz, user) => bz.governance.activateIdentifierUpgrade({ from: user }), reload)}>
                        Activate
                      </button>
                    </div>
                  )}
                </>
              ) : (
                "none"
              )}
            </span>
          </div>
        )}
        {s?.pending && (
          <ProposalDetails
            label="Pending proposal details"
            txHash={txOf.get(s.pending.assertionId.toLowerCase())}
            facts={[
              { k: "New identifier", v: s.pending.newIdentifierText ?? s.pending.newIdentifier },
              { k: "Replacing", v: s.umaIdentifierText ?? s.umaIdentifier },
              { k: "Proposed by", v: <Addr a={s.pending.proposer} /> },
              { k: "Proposed", v: dateTime(s.pending.proposalTs) },
              { k: "Disputes close", v: dateTime(s.pending.livenessEndsAt) },
              { k: "Disputed", v: yesNo(s.pending.disputed) },
              { k: "UMA assertion", v: <Mono>{s.pending.assertionId}</Mono> },
            ]}
          />
        )}
        {s?.queued && (
          <ProposalDetails
            label="Queued upgrade details"
            txHash={txOf.get(s.queued.assertionId.toLowerCase())}
            facts={[
              { k: "New identifier", v: s.queued.newIdentifierText ?? s.queued.newIdentifier },
              { k: "Replacing", v: s.umaIdentifierText ?? s.umaIdentifier },
              { k: "Approved", v: dateTime(s.queued.approvedAt) },
              { k: "Timelock ends", v: dateTime(s.queued.effectiveTs) },
              { k: "Activation opens", v: dateTime(s.queued.activationOpensAt) },
              s.queued.newIdentifierWhitelisted !== null && { k: "On UMA's whitelist", v: yesNo(s.queued.newIdentifierWhitelisted) },
              { k: "UMA assertion", v: <Mono>{s.queued.assertionId}</Mono> },
            ]}
          />
        )}
        <h3>History</h3>
        {!readBz ? (
          <Loading />
        ) : (
          <HistoryList<history.IdentifierUpgradeProposal>
            deps={[readBz, n]}
            filename="bazaar-identifier-upgrades.csv"
            pageSize={PROPOSALS_PAGE}
            load={(o) => readBz.history.identifierUpgradeProposals(o)}
            empty={{ title: "No upgrade has been proposed yet" }}
            columns={[
              { header: "Proposed", csvHeader: "proposed", cell: (p) => dateTime(p.proposedAt), csv: (p) => new Date(p.proposedAt * 1000).toISOString() },
              {
                header: "New identifier",
                csvHeader: "new_identifier",
                cell: (p) => (
                  <>
                    {idText(p.newIdentifier)}
                    <ProposalDetails
                      txHash={p.transactionHash}
                      facts={[
                        { k: "New identifier", v: idText(p.newIdentifier) },
                        p.oldIdentifier !== null && { k: "Replacing", v: idText(p.oldIdentifier) },
                        { k: "Outcome", v: p.status },
                        { k: "Proposed by", v: <Addr a={p.proposer} /> },
                        { k: "Proposed", v: dateTime(p.proposedAt) },
                        { k: "Dispute deadline", v: dateTime(p.livenessEndsAt) },
                        { k: "Disputed", v: yesNo(p.disputed) },
                        p.effectiveTs !== null && { k: "Timelock ends", v: dateTime(p.effectiveTs) },
                        p.resolvedAt !== null && { k: "Resolved", v: dateTime(p.resolvedAt) },
                        { k: "UMA assertion", v: <Mono>{p.id}</Mono> },
                      ]}
                    />
                  </>
                ),
                csv: (p) => idText(p.newIdentifier),
              },
              { header: "Outcome", csvHeader: "outcome", cell: (p) => p.status, csv: (p) => p.status },
              { header: "Resolved", csvHeader: "resolved", cell: (p) => (p.resolvedAt ? dateTime(p.resolvedAt) : "–"), csv: (p) => (p.resolvedAt ? new Date(p.resolvedAt * 1000).toISOString() : "") },
              { header: "", csvHeader: "transaction", cell: (p) => <TxLink hash={p.transactionHash}>tx ↗</TxLink>, csv: (p) => p.transactionHash },
            ]}
          />
        )}
      </div>
      {propose && (
        <Modal title="Propose a UMA identifier upgrade" onClose={() => setPropose(false)}>
          <div className="stack">
            <p className="small muted">The new identifier must be on UMA's whitelist and start with ASSERT_TRUTH. The bond is at least 5,000 USDC; disputes are open for 2 days, then a 7-day timelock.</p>
            <label className="field">
              New identifier
              <input value={id} onChange={(e) => setId(e.target.value)} placeholder="ASSERT_TRUTH3" />
            </label>
            <button className="primary" disabled={!id.trim()} onClick={() => void costed.run("Propose upgrade", (bz, user) => bz.governance.proposeUmaIdentifierUpgrade({ newIdentifier: id.trim(), from: user }), () => (setPropose(false), reload()))}>
              Review proposal
            </button>
            <Notice text={costed.notice} onClose={costed.clear} />
          </div>
        </Modal>
      )}
    </section>
  );
}

/** Rows each proposal history shows before Load more. */
const PROPOSALS_PAGE = 10;

type ProposalTab = "listings" | "terminations" | "identifier";
/** The page's tabs: one per kind of proposal, and the wallet's own proposals and votes. */
type PageTab = ProposalTab | "activity";
const PROPOSAL_TABS: { id: PageTab; label: string }[] = [
  { id: "listings", label: "Market listings" },
  { id: "terminations", label: "Terminations" },
  { id: "identifier", label: "UMA identifier" },
  { id: "activity", label: "Your activity" },
];

export function ProposalsPage() {
  // One kind of proposal at a time. The tab rides in the address (#/proposals?tab=terminations), so it
  // can be linked to and Back returns to it; Market listings is the default.
  const [params, setParams] = useSearchParams();
  const tab = PROPOSAL_TABS.find((t) => t.id === params.get("tab"))?.id ?? "listings";
  return (
    <div className="stack">
      <div className="hero">
        <h1>Proposals</h1>
        <p className="muted">
          List new markets, end broken ones, and keep the UMA identifier current. Every proposal shows its bonds and what comes back before you sign. These are sent from your wallet and need a
          little {ACTIVE.name} ETH for gas. Learn more:{" "}
          <a href={`${DOCS}/listing.html`} target="_blank" rel="noopener noreferrer">
            listing ↗
          </a>
          ,{" "}
          <a href={`${DOCS}/termination.html`} target="_blank" rel="noopener noreferrer">
            termination ↗
          </a>
          .
        </p>
      </div>
      <HistoryLag />
      <div className="tabs" role="tablist" aria-label="Kind of proposal">
        {PROPOSAL_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setParams(t.id === "listings" ? {} : { tab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab !== "activity" && <HowItWorks tab={tab} />}
      {tab === "listings" ? <Listings /> : tab === "terminations" ? <Terminations /> : tab === "identifier" ? <Identifier /> : <YourActivity />}
    </div>
  );
}
