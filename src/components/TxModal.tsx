import { createPortal } from "react-dom";
import { ACTIVE } from "../config/networks";
import type { TxView } from "../state/tx";
import { TxLink } from "./ui";

/** "Sell NVDA: no network fee (…)" as "No network fee (…)", for a confirmation with one relayed step. */
function feeOnly(line: string): string {
  const i = line.indexOf(": ");
  const rest = i >= 0 ? line.slice(i + 2) : line;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export function TxModal({ view, onConfirm, onRecover, onClose }: { view: TxView; onConfirm: () => void; onRecover: () => void; onClose: () => void }) {
  const running = view.phase === "running";
  const review = view.job.review;
  return createPortal(
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="tx-title" onClick={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal">
        <h2 id="tx-title">{view.job.title}</h2>
        {review ? (
          <div className="review">
            <div className="review-head">
              {review.side && <span className={`review-side ${review.side}`}>{review.side === "buy" ? "Buy" : "Sell"}</span>}
              <div className="grow">
                <div className="review-action">{review.action}</div>
                {review.detail && <div className="small muted">{review.detail}</div>}
              </div>
            </div>
            {review.sections.map((s, i) => (
              <div key={i} className="review-section">
                {s.title && <h4>{s.title}</h4>}
                <div className="kv">
                  {s.rows.flatMap((r, j) => [<span key={`l${j}`}>{r.label}</span>, <span key={`v${j}`}>{r.value}</span>])}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="summary">
            {view.job.summary.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
        {((review && view.job.summary.length > 0) || view.fees.length > 0) && (
          <div className="review-notes small muted">
            {review && view.job.summary.map((line, i) => <div key={i}>{line}</div>)}
            {/* One relayed step needs no name on its fee line. */}
            {view.fees.map((f, i) => (
              <div key={`f${i}`}>{view.fees.length === 1 ? feeOnly(f) : f}</div>
            ))}
          </div>
        )}
        {view.needsGas && view.ethWei === 0n ? (
          <div className="banner warn small" role="status">
            <div className="grow">
              <div>
                Your wallet has no {ACTIVE.name} ETH. This step is sent from your wallet, which pays a small network fee in ETH.
                {ACTIVE.gasFaucets && ACTIVE.gasFaucets.length > 0 && <> Get some free, then try again:</>}
              </div>
              {ACTIVE.gasFaucets && ACTIVE.gasFaucets.length > 0 && (
                <div className="row" style={{ gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                  {ACTIVE.gasFaucets.map((f) => (
                    <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer">
                      {f.name} faucet ↗
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          view.needsGas && <p className="small muted">This step is sent from your wallet and needs a little {ACTIVE.name} ETH for gas.</p>
        )}

        {view.phase !== "confirm" && (
          <ol className="steps">
            {view.steps.map((s, i) => (
              <li key={i}>
                <span className={`dot ${s.state}`}>{s.state === "done" ? "✓" : s.state === "failed" ? "!" : ""}</span>
                <div className="grow">
                  <div>{s.label}</div>
                  {s.detail && <div className={`small ${s.state === "failed" ? "down" : "muted"}`}>{s.detail}</div>}
                  {s.hash && (
                    <div className="small">
                      <TxLink hash={s.hash} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        {view.phase === "failed" && view.recovery?.note && <p className="small muted">{view.recovery.note}</p>}
        {view.phase === "failed" && !view.steps.some((s) => s.state === "failed") && view.error && <p className="down small">{view.error}</p>}

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          {view.phase === "confirm" && (
            <>
              <button className="ghost" onClick={onClose}>
                Cancel
              </button>
              <button className={review?.side ?? "primary"} onClick={onConfirm}>
                Confirm
              </button>
            </>
          )}
          {running && <span className="muted small">Keep this page open until it's confirmed.</span>}
          {view.phase === "failed" && (
            <>
              <button className="ghost" onClick={onClose}>
                Close
              </button>
              {view.recovery && (
                <button className="primary" onClick={onRecover}>
                  {view.recovery.label}
                </button>
              )}
            </>
          )}
          {view.phase === "done" && (
            <button className="primary" onClick={onClose}>
              Done
            </button>
          )}
        </div>
        {view.phase === "done" && <p className="small muted" style={{ marginTop: 8 }}>History can take a few seconds to show it.</p>}
      </div>
    </div>,
    document.body,
  );
}
