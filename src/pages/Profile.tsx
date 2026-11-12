import type { account } from "@liberta-labs/bazaar-sdk";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Address } from "viem";
import { FaucetButton } from "../components/Faucet";
import { TestUsdcHelpLink } from "../components/TestUsdcHelp";
import { HistoryLag } from "../components/HistoryLag";
import { PnlChart } from "../components/PnlChart";
import { ActionButton, Empty, Loading, Pnl, Term, useAsync } from "../components/ui";
import { addressUrl } from "../config/networks";
import { amount, dateTime, shortDate, signedUsd, usd, usdcUnits } from "../lib/format";
import { claimFeesPart } from "../lib/jobs";
import { useRead, useWallet } from "../state/connection";
import { useStablePrices } from "../state/data";
import { useTx } from "../state/tx";

function Totals({ user }: { user: Address }) {
  const { readBz } = useRead();
  const prices = useStablePrices();
  const tx = useTx();
  const [p, setP] = useState<account.Portfolio | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!readBz) return;
    let dead = false;
    const load = () => readBz.account.portfolio(user, undefined, { prices, fetchPrices: false }).then((x) => !dead && setP(x), () => undefined);
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [readBz, user, prices, n]);
  if (!p) return <Loading what="Reading your accounts" />;
  const t = p.totals;
  const claimable = p.accounts.filter((a) => a.claimableFees > 0n);
  return (
    <>
      <div className="cards">
        <div className="stat">
          <div className="label">Wallet USDC</div>
          <div className="value">{usdcUnits(p.walletUsdc)}</div>
        </div>
        <div className="stat">
          <div className="label">
            <Term t="collateral">Collateral</Term> (all markets)
          </div>
          <div className="value">{usd(t.collateral)}</div>
        </div>
        <div className="stat">
          <div className="label">
            <Term t="equity">Equity</Term>
          </div>
          <div className="value">{usd(t.equity)}</div>
        </div>
        <div className="stat">
          <div className="label">
            <Term t="unrealized">Unrealized P&L</Term>
          </div>
          <div className="value">
            <Pnl value={t.unrealizedPnl}>{signedUsd(t.unrealizedPnl)}</Pnl>
          </div>
        </div>
        <div className="stat">
          <div className="label">
            <Term t="fundingPnl">Funding P&L</Term>
          </div>
          <div className="value">
            <Pnl value={t.fundingPnl}>{signedUsd(t.fundingPnl)}</Pnl>
          </div>
        </div>
        <div className="stat">
          <div className="label">Withdrawable now</div>
          <div className="value">{usd(t.maxWithdrawable)}</div>
        </div>
      </div>
      <section className="panel" style={{ marginTop: 12 }}>
        <div className="spread">
          <h2 style={{ margin: 0 }}>
            <Term t="claimable">Claimable</Term>: {usd(t.claimableFees)}
          </h2>
        </div>
        {claimable.length === 0 ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            Nothing to claim. Refunded trigger bounties and rewards collect here.
          </p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <tbody>
                {claimable.map((a) => (
                  <tr key={a.market.address}>
                    <td>{a.market.label}</td>
                    <td className="num">{usd(a.claimableFees)}</td>
                    <td className="right">
                      <ActionButton
                        className="small"
                        onClick={() =>
                          void tx.run({
                            title: `Claim on ${a.market.label}`,
                            summary: [`Send ${usd(a.claimableFees)} you're owed on ${a.market.label} to your wallet.`, "Sent from your wallet: it needs a little ETH for gas."],
                            parts: [claimFeesPart(a.market.address)],
                            onDone: () => setN((x) => x + 1),
                          })
                        }
                      >
                        Claim
                      </ActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function PnlHistory({ user }: { user: Address }) {
  const { readBz } = useRead();
  const [table, setTable] = useState(false);
  const from = Math.floor(Date.now() / 1000) - 90 * 86_400;
  const days = useAsync(async () => (readBz ? (await readBz.history.accountDayData(user, { from, first: 1000 })).items : []), [readBz, user]);
  const stats = useAsync(async () => (readBz ? readBz.history.accountStats(user) : null), [readBz, user]);
  const rows = (days.data ?? []).map((d) => ({ date: d.date, pnl: d.realizedPnl }));
  const s = stats.data;
  return (
    <div className="two-col">
      <section className="panel">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Realized profit & loss, last 90 days</h2>
          <button className="small ghost" onClick={() => setTable((x) => !x)}>
            {table ? "Chart" : "Table"}
          </button>
        </div>
        {days.loading && !days.data ? (
          <Loading />
        ) : !rows.length ? (
          <Empty title="No closed trades yet">Profit and loss shows here once you reduce or close a position.</Empty>
        ) : table ? (
          <div className="table-wrap" style={{ maxHeight: 220 }}>
            <table>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date}>
                    <td>{shortDate(r.date)}</td>
                    <td className="num">
                      <Pnl value={r.pnl}>{signedUsd(r.pnl)}</Pnl>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <PnlChart days={rows} />
        )}
      </section>
      <section className="panel">
        <h2>Lifetime</h2>
        {!s ? (
          stats.loading ? <Loading /> : <Empty title="No activity yet" />
        ) : (
          <div className="kv">
            <span>Trades</span>
            <span>{s.tradeCount}</span>
            <span>Volume</span>
            <span>{usd(s.makerVolumeNotional + s.takerVolumeNotional)}</span>
            <span>Fees paid</span>
            <span>{usd(s.feesPaid)}</span>
            <span>Realized P&L</span>
            <span>
              <Pnl value={s.realizedPnl}>{signedUsd(s.realizedPnl)}</Pnl>
            </span>
            <span>Liquidations</span>
            <span>{s.liquidationCount}</span>
            <span>First seen</span>
            <span>{s.firstSeenTimestamp ? dateTime(s.firstSeenTimestamp) : "–"}</span>
          </div>
        )}
      </section>
    </div>
  );
}

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
      <Totals user={w.address} />
      <PnlHistory user={w.address} />
      <Holdings user={w.address} />
    </div>
  );
}
