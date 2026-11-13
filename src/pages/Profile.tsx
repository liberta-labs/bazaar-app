import { Link } from "react-router-dom";
import type { Address } from "viem";
import { FaucetButton } from "../components/Faucet";
import { TestUsdcHelpLink } from "../components/TestUsdcHelp";
import { HistoryLag } from "../components/HistoryLag";
import { Empty, useAsync } from "../components/ui";
import { addressUrl } from "../config/networks";
import { amount, dateTime, usd } from "../lib/format";
import { useRead, useWallet } from "../state/connection";

function Holdings({ user }: { user: Address }) {
  const { readBz, markets: list } = useRead();
  const label = (p: Address) => list.find((m) => m.address.toLowerCase() === p.toLowerCase())?.label ?? p.slice(0, 8);
  const lps = useAsync(async () => (readBz ? (await readBz.history.insuranceProviders({ account: user, activeOnly: true, first: 100 })).items : []), [readBz, user]);
  const gov = useAsync(async () => {
    if (!readBz) return null;
    const [listings, terms, insurer, votes, ids] = await Promise.all([
      readBz.history.listingProposals({ deployer: user, first: 50 }),
      readBz.history.terminationProposals({ proposer: user, first: 50 }),
      readBz.history.insurerProposals({ proposer: user, first: 50 }),
      readBz.history.insurerVotes({ voter: user, first: 50 }),
      readBz.history.identifierUpgradeProposals({ proposer: user, first: 50 }),
    ]);
    return { listings: listings.items, terms: terms.items, insurer: insurer.items, votes: votes.items, ids: ids.items };
  }, [readBz, user]);
  const g = gov.data;
  const anyGov = g && g.listings.length + g.terms.length + g.insurer.length + g.votes.length + g.ids.length > 0;
  return (
    <div className="two-col">
      <section className="panel">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Insurance holdings</h2>
          <Link to="/earn">Earn →</Link>
        </div>
        {!lps.data?.length ? (
          <Empty title="You don't insure any market yet">Join a market's insurance fund on the Earn page to earn a share of its fees.</Empty>
        ) : (
          <div className="kv" style={{ marginTop: 8 }}>
            {lps.data.flatMap((p) => [
              <span key={`${p.pair}a`}>{label(p.pair)}</span>,
              <span key={`${p.pair}b`}>
                {amount(p.shares, 4)} shares <span className="muted small">(paid {usd(p.deposited)})</span>
              </span>,
            ])}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Your proposals & votes</h2>
          <Link to="/proposals">Proposals →</Link>
        </div>
        {!anyGov ? (
          <Empty title="None yet">Proposals you make and votes you cast show here.</Empty>
        ) : (
          <ul className="small" style={{ paddingLeft: 18 }}>
            {g!.listings.map((x) => (
              <li key={x.id}>
                Listing <b>{x.description}</b>: {x.status}
              </li>
            ))}
            {g!.terms.map((x) => (
              <li key={x.id}>
                Termination claim on {label(x.pair)}: {x.status}
              </li>
            ))}
            {g!.insurer.map((x) => (
              <li key={x.id}>
                Insurer vote on {label(x.pair)}: {x.status}
              </li>
            ))}
            {g!.votes.map((x) => (
              <li key={x.id}>
                Voted {amount(x.amount, 4)} shares to end {label(x.pair)} ({dateTime(x.timestamp)})
              </li>
            ))}
            {g!.ids.map((x) => (
              <li key={x.id}>
                Identifier upgrade proposal: {x.status}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function ProfilePage() {
  const w = useWallet();
  if (!w.address) return <Empty title="Connect a wallet to see your profile" action={<button className="primary" onClick={w.openConnect}>Connect wallet</button>} />;
  return (
    <div className="stack">
      <section className="panel">
        <div className="spread">
          <div>
            <h3>Connected address</h3>
            <div className="mono" style={{ overflowWrap: "anywhere" }}>
              {w.address}
            </div>
            <div className="small muted">
              {w.kind === "contract" ? "Smart-contract wallet: browsing, deposits and cancels only." : w.kind === "delegated" ? "Account with an EIP-7702 delegation: signs with its own key." : "Ordinary account."}{" "}
              <a href={addressUrl(w.address)} target="_blank" rel="noopener noreferrer">
                Arbiscan ↗
              </a>
            </div>
          </div>
          <div className="row">
            <FaucetButton compact />
            <TestUsdcHelpLink label="See test USDC in my wallet" />
            <button className="small" onClick={() => void navigator.clipboard?.writeText(w.address!)}>
              Copy
            </button>
            <button className="small ghost" onClick={() => void w.disconnect()}>
              Disconnect
            </button>
          </div>
        </div>
      </section>
      <HistoryLag />
      <section className="panel">
        <div className="spread">
          <span className="small muted">Your balances, P&L, volume, fees and every history are on the Portfolio.</span>
          <Link to="/portfolio">Portfolio →</Link>
        </div>
      </section>
      <Holdings user={w.address} />
    </div>
  );
}
