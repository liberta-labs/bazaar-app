/**
 * The account's insurance participation: every fund it has insured, past ones too, with what it put in,
 * took out and holds now; the withdrawals under way; the insurer votes it cast; and every insurance
 * event. One subgraph query for the funds and one for the vote count; the value of each live stake is
 * read on chain; the votes and events load a page at a time.
 */
import { type Bazaar, formatUnits18, type history } from "@liberta-labs/bazaar-sdk";
import { Link } from "react-router-dom";
import type { Address } from "viem";
import { amount, dateTime, pct, signedUsd, usd } from "../lib/format";
import { useRead } from "../state/connection";
import { useLiveAccount, useMarketSnapshots } from "../state/data";
import { useSort } from "../state/sort";
import { AssetIcon } from "./AssetIcon";
import { ExportCsv } from "./ExportCsv";
import { HistoryList } from "./History";
import { ACCOUNT_PAGE, usePaged } from "./Pager";
import { Empty, Loading, Pnl, Term, Tip, TxLink, useAsync } from "./ui";

/** Rows a page of the votes and the insurance history shows: shorter than the stakes above them, as they share the tab. */
const PAGE = 10;

const EVENT_TEXT: Record<history.InsuranceEventKind, string> = {
  Deposit: "Insured",
  WithdrawalRequested: "Withdrawal requested",
  WithdrawalLocked: "Withdrawal locked",
  WithdrawalExecuted: "Withdrawal collected",
  LevyCharged: "Levy charged",
  LevyReceived: "Levy received",
};

/** Where a fund's withdrawal stands, from what the subgraph recorded. */
function exitText(p: history.InsuranceProvider): string {
  if (p.requestedShares === 0n) return p.shares > 0n ? "none" : "left the fund";
  if (p.lockedAmount !== null) return `${usd(p.lockedAmount)} locked${p.claimOpensTs ? `, collect from ${dateTime(p.claimOpensTs)}` : ""}`;
  return `${amount(p.requestedShares, 4)} shares requested${p.requestedAt ? ` ${dateTime(p.requestedAt)}` : ""}`;
}

export function InsuranceStats({ readBz, user }: { readBz: Bazaar; user: Address }) {
  const { historyVersion } = useLiveAccount();
  const { markets: list } = useRead();
  const { snaps } = useMarketSnapshots();
  const market = (p: Address) => list.find((m) => m.address.toLowerCase() === p.toLowerCase());

  // Every fund the account has insured, with what each live stake is worth now.
  const funds = useAsync(async () => {
    const providers = (await readBz.history.insuranceProviders({ account: user, first: 100 })).items;
    return Promise.all(
      providers.map(async (p) => ({ p, value: p.shares > 0n ? await readBz.insurance.getInsuranceDepositValue(p.pair, user).catch(() => null) : 0n })),
    );
  }, [readBz, user, historyVersion]);
  const votes = useAsync(async () => (await readBz.history.insurerVotes({ voter: user, first: 1000 })).items.length, [readBz, user, historyVersion]);

  const rows = (funds.data ?? []).map(({ p, value }) => {
    const snap = snaps.get(p.pair);
    const gain = value === null ? null : value + p.withdrawn - p.deposited;
    // The stake's share of the fund: its value over the fund's free capital, which the share price is set from.
    const ofFund = value !== null && snap && snap.insurance.freeCapital > 0n ? Number((value * 10_000n) / snap.insurance.freeCapital) / 10_000 : null;
    return { p, value, gain, ofFund, label: market(p.pair)?.label ?? p.pair };
  });
  const { sorted, th, order } = useSort(rows, {
    market: (r) => r.label,
    shares: (r) => r.p.shares,
    ofFund: (r) => r.ofFund,
    value: (r) => r.value,
    deposited: (r) => r.p.deposited,
    withdrawn: (r) => r.p.withdrawn,
    gain: (r) => r.gain,
    since: (r) => r.p.createdTimestamp,
    exit: (r) => (r.p.requestedShares > 0n ? r.p.requestedShares : null),
  });
  const { shown, pager } = usePaged(sorted, ACCOUNT_PAGE, order);

  if (funds.loading && !funds.data) return <Loading what="Reading your insurance" />;
  if (!rows.length) return <Empty title="You haven't insured a market yet">Insure one on the Earn page to earn a share of its trading fees.</Empty>;

  const live = rows.filter((r) => r.p.shares > 0n || r.p.requestedShares > 0n);
  const sum = (f: (r: (typeof rows)[number]) => bigint | null) => rows.reduce((t, r) => t + (f(r) ?? 0n), 0n);
  const value = sum((r) => r.value);
  const deposited = sum((r) => r.p.deposited);
  const withdrawn = sum((r) => r.p.withdrawn);
  const gain = value + withdrawn - deposited;

  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="insurance-summary">
        <div>
          <span className="label">Funds insured</span>
          <b>
            {live.length}
            {rows.length > live.length ? <span className="small muted"> · {rows.length - live.length} left</span> : null}
          </b>
        </div>
        <div>
          <span className="label">Value now</span>
          <b className="mono">{usd(value)}</b>
        </div>
        <div>
          <span className="label">Deposited</span>
          <b className="mono">{usd(deposited)}</b>
        </div>
        <div>
          <span className="label">Withdrawn</span>
          <b className="mono">{usd(withdrawn)}</b>
        </div>
        <div>
          <span className="label">Gain / loss</span>
          <b className="mono">
            <Pnl value={gain}>{signedUsd(gain)}</Pnl>
            {deposited > 0n && <span className="small"> ({pct(Number((gain * 10_000n) / deposited) / 10_000, 2)})</span>}
          </b>
        </div>
        <div>
          <span className="label">Insurer votes cast</span>
          <b className="mono">{votes.data === undefined ? "…" : votes.data >= 1000 ? "1,000+" : votes.data}</b>
        </div>
      </div>

      <div className="row" style={{ justifyContent: "flex-end", padding: "8px 10px 0" }}>
        <ExportCsv
          filename="bazaar-insurance-funds.csv"
          rows={sorted}
          columns={[
            { header: "market", value: (r) => r.label },
            { header: "shares", value: (r) => formatUnits18(r.p.shares) },
            { header: "share_of_fund", value: (r) => r.ofFund ?? "" },
            { header: "value_usd", value: (r) => (r.value === null ? "" : formatUnits18(r.value)) },
            { header: "deposited_usd", value: (r) => formatUnits18(r.p.deposited) },
            { header: "deposit_count", value: (r) => r.p.depositCount },
            { header: "withdrawn_usd", value: (r) => formatUnits18(r.p.withdrawn) },
            { header: "gain_usd", value: (r) => (r.gain === null ? "" : formatUnits18(r.gain)) },
            { header: "gain_pct", value: (r) => (r.gain !== null && r.p.deposited > 0n ? Number((r.gain * 1_000_000n) / r.p.deposited) / 1_000_000 : "") },
            { header: "insuring_since", value: (r) => new Date(r.p.createdTimestamp * 1000).toISOString() },
            { header: "requested_shares", value: (r) => formatUnits18(r.p.requestedShares) },
            { header: "requested_at", value: (r) => (r.p.requestedAt ? new Date(r.p.requestedAt * 1000).toISOString() : "") },
            { header: "locked_usd", value: (r) => (r.p.lockedAmount === null ? "" : formatUnits18(r.p.lockedAmount)) },
            { header: "claim_opens", value: (r) => (r.p.claimOpensTs ? new Date(r.p.claimOpensTs * 1000).toISOString() : "") },
            { header: "levy_charged_shares", value: (r) => formatUnits18(r.p.levyChargedShares) },
            { header: "levy_received_shares", value: (r) => formatUnits18(r.p.levyReceivedShares) },
          ]}
        />
      </div>
      <div className="table-wrap">
        <table className="rtable">
          <thead>
            <tr>
              <th {...th("market")}>Market</th>
              <th {...th("shares", "num")}>
                <Term t="insuranceShare">Shares</Term>
              </th>
              <th {...th("ofFund", "num")}>Share of fund</th>
              <th {...th("value", "num")}>Value now</th>
              <th {...th("deposited", "num")}>Deposited</th>
              <th {...th("withdrawn", "num")}>Withdrawn</th>
              <th {...th("gain", "num")}>Gain / loss</th>
              <th {...th("since")}>Insuring since</th>
              <th {...th("exit")}>Withdrawal</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ p, value: v, gain: g, ofFund }) => {
              const m = market(p.pair);
              return (
                <tr key={p.id}>
                  <td data-main="">
                    <span className="market-name">
                      {m && <AssetIcon market={m} size={18} />}
                      {m ? <Link to={`/market/${m.address}`}>{m.label}</Link> : p.pair.slice(0, 10)}
                    </span>
                  </td>
                  <td data-label="Shares" className="num">
                    {amount(p.shares, 4)}
                    {(p.levyChargedShares > 0n || p.levyReceivedShares > 0n) && (
                      <Tip text="Shares levied from yes-voters of a failed or unjudged insurer vote, paid to the fund's other holders.">
                        <div className="small muted term">
                          levy {p.levyChargedShares > 0n ? `−${amount(p.levyChargedShares, 4)}` : ""}
                          {p.levyReceivedShares > 0n ? ` +${amount(p.levyReceivedShares, 4)}` : ""}
                        </div>
                      </Tip>
                    )}
                  </td>
                  <td data-label="Share of fund" className="num">{ofFund === null ? "–" : `≈${pct(ofFund, 1)}`}</td>
                  <td data-label="Value now" className="num">{v === null ? "–" : usd(v)}</td>
                  <td data-label="Deposited" className="num">
                    {usd(p.deposited)}
                    <div className="small muted">
                      {p.depositCount} deposit{p.depositCount === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td data-label="Withdrawn" className="num">{usd(p.withdrawn)}</td>
                  <td data-label="Gain / loss" className="num">
                    {g === null ? (
                      "–"
                    ) : (
                      <>
                        <Pnl value={g}>{signedUsd(g)}</Pnl>
                        {p.deposited > 0n && (
                          <div className="small">
                            <Pnl value={g}>{pct(Number((g * 10_000n) / p.deposited) / 10_000, 2)}</Pnl>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td data-label="Insuring since" className="small">{dateTime(p.createdTimestamp)}</td>
                  <td data-label="Withdrawal" className="small">{exitText(p)}</td>
                  <td data-actions="" className="right">
                    <Link to="/earn" className="btn small">
                      Manage
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pager}

      <h3 style={{ padding: "16px 10px 0" }}>Insurer votes</h3>
      <HistoryList<history.InsurerVote>
        deps={[readBz, user]}
        refreshKey={historyVersion}
        filename="bazaar-insurer-votes.csv"
        pageSize={PAGE}
        load={(o) => readBz.history.insurerVotes({ voter: user, ...o })}
        empty={{ title: "No votes yet", text: "Insurers can vote to end a market whose feed or asset has broken: see Proposals, Terminations." }}
        columns={[
          { header: "Time", csvHeader: "time", cell: (r) => dateTime(r.timestamp), csv: (r) => new Date(r.timestamp * 1000).toISOString() },
          { header: "Market", csvHeader: "market", cell: (r) => market(r.pair)?.label ?? r.pair.slice(0, 10), csv: (r) => market(r.pair)?.label ?? r.pair },
          { header: "Shares voted", csvHeader: "shares", num: true, cell: (r) => amount(r.amount, 4), csv: (r) => formatUnits18(r.amount) },
          { header: "Yes so far", csvHeader: "total_yes_shares", num: true, cell: (r) => amount(r.totalYesShares, 4), csv: (r) => formatUnits18(r.totalYesShares) },
          { header: "Proposal", csvHeader: "proposal", cell: (r) => <span className="mono small">{r.proposal.slice(0, 10)}…</span>, csv: (r) => r.proposal },
          { header: "", csvHeader: "transaction", cell: (r) => <TxLink hash={r.transactionHash}>tx ↗</TxLink>, csv: (r) => r.transactionHash },
        ]}
      />

      <h3 style={{ padding: "16px 10px 0" }}>Insurance history</h3>
      <HistoryList<history.InsuranceEvent>
        deps={[readBz, user]}
        refreshKey={historyVersion}
        filename="bazaar-insurance-history.csv"
        pageSize={PAGE}
        load={(o) => readBz.history.insuranceEvents({ account: user, ...o })}
        empty={{ title: "Nothing yet" }}
        columns={[
          { header: "Time", csvHeader: "time", cell: (r) => dateTime(r.timestamp), csv: (r) => new Date(r.timestamp * 1000).toISOString() },
          { header: "Market", csvHeader: "market", cell: (r) => market(r.pair)?.label ?? r.pair.slice(0, 10), csv: (r) => market(r.pair)?.label ?? r.pair },
          { header: "What happened", csvHeader: "event", cell: (r) => EVENT_TEXT[r.kind] ?? r.kind, csv: (r) => r.kind },
          { header: "Shares", csvHeader: "shares", num: true, cell: (r) => (r.shares > 0n ? amount(r.shares, 4) : "–"), csv: (r) => formatUnits18(r.shares) },
          { header: "Amount", csvHeader: "amount_usd", num: true, cell: (r) => (r.amount > 0n ? usd(r.amount) : "–"), csv: (r) => formatUnits18(r.amount) },
          { header: "", csvHeader: "transaction", cell: (r) => <TxLink hash={r.transactionHash}>tx ↗</TxLink>, csv: (r) => r.transactionHash },
        ]}
      />
    </div>
  );
}
