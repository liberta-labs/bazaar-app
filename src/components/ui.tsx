/** Small building blocks shared by every page. */
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { txUrl } from "../config/networks";
import { priceAge } from "../lib/board";
import { GLOSSARY, STATUS_TEXT, type Term as TermKey } from "../lib/glossary";
import { duration, price as fmtPrice } from "../lib/format";
import { useNow } from "../state/connection";

/** Gap between a tooltip and its element, and the least room kept from the screen's edges. */
const TIP_GAP = 6;
const EDGE = 8;

/**
 * A tooltip on hover, focus or tap. Its text is always plain text. It is drawn on the page itself
 * (a portal to document.body, fixed to the screen), so a table that scrolls sideways or a panel that
 * clips its contents cannot hide it. It opens above its element, or below when there isn't room above,
 * and slides along to stay inside the screen. It closes when the page scrolls.
 */
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = (hover || focus || pinned) && anchor !== null;

  const measure = () => trigger.current && setAnchor(trigger.current.getBoundingClientRect());

  // Place the box once it is drawn and its size is known: above if it fits, else below; centered on
  // the element, slid back inside the screen.
  useLayoutEffect(() => {
    if (!open || !box.current || !anchor) return;
    const b = box.current.getBoundingClientRect();
    const above = anchor.top - TIP_GAP - b.height >= EDGE;
    const top = above ? anchor.top - TIP_GAP - b.height : Math.min(anchor.bottom + TIP_GAP, window.innerHeight - EDGE - b.height);
    const centered = anchor.left + anchor.width / 2 - b.width / 2;
    const left = Math.max(EDGE, Math.min(centered, window.innerWidth - EDGE - b.width));
    setPos({ top, left });
  }, [open, anchor, text]);

  // A fixed box would drift from its element when the page scrolls: close it instead.
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setHover(false);
      setPinned(false);
      setPos(null);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  return (
    <span
      ref={trigger}
      className="tip"
      tabIndex={0}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => {
        measure();
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
      onFocus={() => {
        measure();
        setFocus(true);
      }}
      onBlur={() => {
        setFocus(false);
        setPinned(false);
      }}
      onClick={() => {
        measure();
        setPinned((p) => !p);
      }}
    >
      {children}
      {open &&
        createPortal(
          <span
            ref={box}
            id={id}
            className="tip-box"
            role="tooltip"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}

/** A protocol term with its plain-language explanation. */
export function Term({ t, children }: { t: TermKey; children?: ReactNode }) {
  return (
    <Tip text={GLOSSARY[t]}>
      <span className="term">{children ?? t}</span>
    </Tip>
  );
}

/** A button that explains why it is disabled. */
export function ActionButton({
  disabledReason,
  children,
  className,
  onClick,
  type = "button",
}: {
  disabledReason?: string | null;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  const btn = (
    <button type={type} className={className} disabled={!!disabledReason} onClick={onClick}>
      {children}
    </button>
  );
  return disabledReason ? <Tip text={disabledReason}>{btn}</Tip> : btn;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="title">{title}</div>
      {children && <div className="small">{children}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_TEXT[status] ?? { label: status, term: "live" as const };
  const cls = status === "live" ? "live" : status === "terminated" ? "bad" : "warn";
  return (
    <Tip text={GLOSSARY[s.term]}>
      <span className={`badge ${cls}`}>{s.label}</span>
    </Tip>
  );
}

/** How old a price is, with warnings for low confidence and a closed venue. */
export function PriceAge({ publishTime, confidenceOk, venueClosed, stored }: { publishTime: number | null; confidenceOk?: boolean | null; venueClosed?: boolean; stored?: boolean }) {
  const now = useNow();
  if (publishTime === null) return <span className="muted small">no price yet</span>;
  const age = priceAge(publishTime, now);
  return (
    <span className="row small" style={{ gap: 6 }}>
      {stored ? (
        <Tip text="This market is not on the live price board (it is settling or has ended). This is the last price the market stored on chain.">
          <span className="badge">stored price · {duration(age)} old</span>
        </Tip>
      ) : (
        <span className={age > 30 ? "accent" : "muted"}>{age < 2 ? "just now" : `${duration(age)} ago`}</span>
      )}
      {confidenceOk === false && (
        <Tip text="Pyth's price confidence is wider than the 2% the protocol accepts right now. Trades may be refused until it narrows.">
          <span className="badge warn">wide confidence</span>
        </Tip>
      )}
      {venueClosed && (
        <Tip text={GLOSSARY.venueClosed}>
          <span className="badge warn">venue closed</span>
        </Tip>
      )}
    </span>
  );
}

export function TxLink({ hash, children }: { hash: string; children?: ReactNode }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noopener noreferrer">
      {children ?? "View on Arbiscan ↗"}
    </a>
  );
}

export function Pnl({ value, children }: { value: bigint; children: ReactNode }) {
  return <span className={value > 0n ? "up" : value < 0n ? "down" : ""}>{children}</span>;
}

export const Price = ({ value }: { value: bigint }) => <span className="num">{fmtPrice(value)}</span>;

/** Loads `load()` and re-loads when `deps` change; keeps the last value while reloading. */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): { data: T | undefined; error: unknown; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let dead = false;
    setLoading(true);
    load()
      .then((d) => {
        if (!dead) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!dead) {
          console.error(e);
          setError(e);
        }
      })
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1) };
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <div className="empty muted">{what}…</div>;
}
