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
  parseUnits18,
  termination as term,
  uma,
} from "@liberta-labs/bazaar-sdk";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { Address, Hex } from "viem";
import { HistoryLag } from "../components/HistoryLag";
import { Modal } from "../components/Modal";
import { Empty, Loading, StatusBadge, Term, Tip, useAsync } from "../components/ui";
import { ACTIVE } from "../config/networks";
import { explain, isKeeperOnly } from "../lib/errors";
import { amount, dateTime, parseInput, relative, shortAddr } from "../lib/format";
import { costedPart } from "../lib/jobs";
import {
  continuousMismatch,
  descriptionMismatch,
  feedIsLive,
  feedLabelOf,
  registryClient,
  scheduleIs247,
  searchSymbols,
  suggestCompositeDescription,
  suggestDescription,
} from "../lib/listing";
import { useRead, useWallet } from "../state/connection";
import { useMarketSnapshots } from "../state/data";
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
    <Tip text={uma.ASSERTION_PHASE_TEXT[s.phase]}>
      <span className="small term">
        UMA: {s.phase}
        {s.disputableUntil ? ` · disputable ${relative(s.disputableUntil, s.now)}` : ""}
      </span>
    </Tip>
  );
}

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
        <Notice text={costed.notice} onClose={costed.clear} />
        <button
          className="primary"
          disabled={!resolved || !desc || !!descErr || !!blocker || parseInput(total) === null}
          onClick={() =>
            resolved &&
            void costed.run("Propose a market", (bz, user) =>
              bz.listings.proposePairDeployment({
                baseFeedId: resolved.feedId,
                isContinuouslyTraded: continuous,
                totalAmount: parseUnits18(total.trim()),
                description: desc,
                from: user,
                // The connection has no Pyth Pro source, so name the registry for the builder's own check.
                registry: PYTH_PRO.symbolsUrl,
              }),
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
  const [propose, setPropose] = useState(false);
  const [n, setN] = useState(0);
  const open = useAsync(async () => (readBz ? (await readBz.listings.openListings()).listings : []), [readBz, n]);
  const past = useAsync(async () => (readBz ? (await readBz.history.listingProposals({ first: 20, status: ["Deployed", "Rejected", "Expired", "Voided"] })).items : []), [readBz, n]);
  const refund = useAsync(async () => (readBz && w.address ? readBz.listings.seedRefundOwed(w.address) : 0n), [readBz, w.address, n]);
  const now = Date.now() / 1000;
  const reload = () => setN((x) => x + 1);
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
                  <th>Asset</th>
                  <th>Status</th>
                  <th className="num">Seed</th>
                  <th>Deadline</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {open.data.map((l) => (
                  <tr key={l.assertionId}>
                    <td data-main="">
                      <b>{l.description}</b>
                      <div className="small muted mono">feed {l.baseFeedId.slice(0, 10)}… · {l.isContinuouslyTraded ? "24/7" : "trading hours"} · by {shortAddr(l.deployer)}</div>
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
        {!past.data?.length ? (
          <p className="small muted">None yet.</p>
        ) : (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {past.data.map((p: history.ListingProposal) => (
              <li key={p.id}>
                <b>{p.description}</b>: {p.status} {p.resolvedAt ? `(${dateTime(p.resolvedAt)})` : ""}
                {p.pair && (
                  <>
                    {" "}
                    · <Link to={`/market/${p.pair}`}>open market</Link>
                  </>
                )}
              </li>
            ))}
          </ul>
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
            void costed.run(insurer ? "Propose insurer vote" : "Propose termination", (bz, user) =>
              insurer
                ? bz.termination.proposeInsurerTermination({ pair: m.address, cutoffTs, from: user })
                : bz.termination.proposeTermination({ pair: m.address, category, lastTradingTs: cutoffTs, reason, from: user }),
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

function MarketTermination({ m, snap }: { m: markets.MarketInfo; snap: markets.MarketSnapshot | undefined }) {
  const { readBz } = useRead();
  const w = useWallet();
  const costed = useCosted();
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
  const past = useAsync(async () => {
    if (!readBz) return null;
    const [claims, votes] = await Promise.all([readBz.history.terminationProposals({ first: 20 }), readBz.history.insurerProposals({ first: 20 })]);
    return { claims: claims.items, votes: votes.items };
  }, [readBz]);
  const label = (p: Address) => list.find((m) => m.address.toLowerCase() === p.toLowerCase())?.label ?? shortAddr(p);
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
        {!list.length ? <Loading /> : list.map((m) => <MarketTermination key={m.address} m={m} snap={snaps.get(m.address)} />)}
        <h3 style={{ marginTop: 12 }}>History</h3>
        {!past.data ? (
          <Loading />
        ) : !past.data.claims.length && !past.data.votes.length ? (
          <p className="small muted">No termination has been proposed yet.</p>
        ) : (
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            {past.data.claims.map((c) => (
              <li key={c.id}>
                UMA claim on {label(c.pair)}: {c.status} · cutoff {dateTime(c.lastTradingTs)} · <span style={{ overflowWrap: "anywhere" }}>{c.reason}</span>
              </li>
            ))}
            {past.data.votes.map((v) => (
              <li key={v.id}>
                Insurer vote on {label(v.pair)}: {v.status} · cutoff {dateTime(v.cutoffTs)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// The UMA identifier
// ---------------------------------------------------------------------------------------------

function Identifier() {
  const { readBz } = useRead();
  const costed = useCosted();
  const [n, setN] = useState(0);
  const [propose, setPropose] = useState(false);
  const [id, setId] = useState("");
  const g = useAsync(async () => (readBz ? readBz.governance.identifierGovernance() : null), [readBz, n]);
  const past = useAsync(async () => (readBz ? (await readBz.history.identifierUpgradeProposals({ first: 10 })).items : []), [readBz, n]);
  const reload = () => setN((x) => x + 1);
  const s = g.data;
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
                      <button className="small" onClick={() => void costed.run("Dispute upgrade", (bz, user) => bz.uma.disputeAssertion({ assertionId: s.pending!.assertionId, from: user, home: "factory" }), reload)}>
                        Dispute
                      </button>
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
        {past.data && past.data.length > 0 && (
          <>
            <h3>History</h3>
            <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
              {past.data.map((p) => (
                <li key={p.id}>
                  {uma.identifierText(p.newIdentifier) ?? p.newIdentifier}: {p.status} ({dateTime(p.proposedAt)})
                </li>
              ))}
            </ul>
          </>
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

export function ProposalsPage() {
  return (
    <div className="stack">
      <div className="hero">
        <h1>Proposals</h1>
        <p className="muted">
          List new markets, end broken ones, and keep the UMA identifier current. Every proposal shows its bonds and what comes back before you sign. These are sent from your wallet and need a
          little {ACTIVE.name} ETH for gas.
        </p>
      </div>
      <HistoryLag />
      <Listings />
      <Terminations />
      <Identifier />
    </div>
  );
}
