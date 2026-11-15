/**
 * The Proposals page's "Your activity" tab: the connected wallet's own proposals and votes, every kind in
 * one list, newest first: market listings, termination claims, insurer proposals and votes, and
 * identifier upgrades. Descriptions and identifiers come from the chain, so they are rendered as text.
 */
import type { history } from "@liberta-labs/bazaar-sdk";
import { Link } from "react-router-dom";
import { hexToString } from "viem";
import { explain } from "../lib/errors";
import { amount, dateTime } from "../lib/format";
import { useRead, useWallet } from "../state/connection";
import { useLiveAccount } from "../state/data";
import { Empty, Loading, TxLink, useAsync } from "./ui";

/** Each kind of proposal read, at most this many. */
const EACH = 50;

type Tab = "listings" | "terminations" | "identifier";

interface Row {
  readonly key: string;
  readonly kind: string;
  readonly what: string;
  readonly status: string | null;
  readonly at: number;
  readonly tab: Tab;
  readonly tx: string;
}

/** Still being decided, settled in the proposer's favour, or neither. */
const IN_PROGRESS = new Set(["Pending", "Disputed", "Open", "Scheduled", "Queued"]);
const SUCCEEDED = new Set(["Deployed", "Accepted", "Upgraded"]);
const tone = (s: string) => (IN_PROGRESS.has(s) ? " warn" : SUCCEEDED.has(s) ? " live" : "");
/** "ScheduleRefused" -> "Schedule refused". */
const words = (s: string) => s.replace(/([a-z])([A-Z])/g, (_, a: string, b: string) => `${a} ${b.toLowerCase()}`);

/** A bytes32 identifier as its text, without the padding; the hex when it isn't text. */
function identifier(h: string): string {
  try {
    const t = hexToString(h as `0x${string}`, { size: 32 }).replace(/\0+$/, "");
    return /^[\x20-\x7e]+$/.test(t) ? t : h;
  } catch {
    return h;
  }
}

export function YourActivity() {
  const w = useWallet();
  const { readBz, markets } = useRead();
  const { historyVersion } = useLiveAccount();
  const label = (p: string) => markets.find((m) => m.address.toLowerCase() === p.toLowerCase())?.label ?? `${p.slice(0, 8)}…`;
  const rows = useAsync(async (): Promise<Row[] | null> => {
    // null until it can read: shown as loading, not as "nothing yet".
    if (!readBz || !w.address) return null;
    const me = w.address;
    const [listings, terms, insurer, votes, ids] = await Promise.all([
      readBz.history.listingProposals({ deployer: me, first: EACH }),
      readBz.history.terminationProposals({ proposer: me, first: EACH }),
      readBz.history.insurerProposals({ proposer: me, first: EACH }),
      readBz.history.insurerVotes({ voter: me, first: EACH }),
      readBz.history.identifierUpgradeProposals({ proposer: me, first: EACH }),
    ]);
    const out: Row[] = [
      ...listings.items.map((x: history.ListingProposal) => ({ key: x.id, kind: "Market listing", what: x.description, status: x.status, at: x.proposedAt, tab: "listings" as const, tx: x.transactionHash })),
      ...terms.items.map((x: history.TerminationProposal) => ({ key: x.id, kind: "Termination claim", what: label(x.pair), status: x.status, at: x.submittedAt, tab: "terminations" as const, tx: x.transactionHash })),
      // A termination claim opens an insurer vote under the same id: the claim's row stands for both.
      ...insurer.items
        .filter((x: history.InsurerProposal) => !x.claimBacked)
        .map((x: history.InsurerProposal) => ({ key: x.id, kind: "Insurer proposal", what: label(x.pair), status: x.status, at: x.createdAt, tab: "terminations" as const, tx: x.transactionHash })),
      ...votes.items.map((x: history.InsurerVote) => ({ key: x.id, kind: "Insurer vote", what: `${amount(x.amount, 4)} shares to end ${label(x.pair)}`, status: null, at: x.timestamp, tab: "terminations" as const, tx: x.transactionHash })),
      ...ids.items.map((x: history.IdentifierUpgradeProposal) => ({ key: x.id, kind: "Identifier upgrade", what: `To ${identifier(x.newIdentifier)}`, status: x.status, at: x.proposedAt, tab: "identifier" as const, tx: x.transactionHash })),
    ];
    return out.sort((a, b) => b.at - a.at);
  }, [readBz, w.address, markets, historyVersion]);

  if (!w.address) {
    return <Empty title="Connect to see your proposals and votes" action={<button className="primary" onClick={w.openConnect}>Connect</button>} />;
  }
  if (!rows.data) {
    return rows.error ? <Empty title={explain(rows.error)} action={<button onClick={rows.reload}>Try again</button>} /> : <Loading what="Loading your proposals and votes" />;
  }
  if (!rows.data.length) {
    return <Empty title="Nothing yet">Markets you propose, claims you make, and votes you cast show up here.</Empty>;
  }
  return (
    <section className="panel tight">
      <div className="panel-head">
        <h2>Your proposals and votes</h2>
        <span className="small muted">Newest first. Click a kind to open its tab.</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>What</th>
              <th>Status</th>
              <th className="hide-sm">Date</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.data.map((r) => (
              <tr key={`${r.kind}-${r.key}`}>
                <td style={{ whiteSpace: "nowrap" }}>
                  <Link to={r.tab === "listings" ? "/proposals" : `/proposals?tab=${r.tab}`}>{r.kind}</Link>
                </td>
                <td style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.what}>
                  {r.what}
                </td>
                <td>{r.status ? <span className={`badge${tone(r.status)}`}>{words(r.status)}</span> : <span className="muted">–</span>}</td>
                <td className="hide-sm small muted" style={{ whiteSpace: "nowrap" }}>
                  {dateTime(r.at)}
                </td>
                <td className="num">
                  <TxLink hash={r.tx}>
                    <span className="small">tx ↗</span>
                  </TxLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
