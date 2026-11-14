import { useWatchlist } from "../state/watchlist";

/**
 * A soft five-pointed star: plump points (the inner corners at about half the outer radius, where a
 * classic star has them nearer a third) and rounded tips. An outline when off, filled when on.
 */
export function StarIcon({ filled, size = 16 }: { filled: boolean; size?: number }) {
  return (
    <svg className="star-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <polygon
        points="12,3.4 14.7,9.18 21.04,9.96 16.38,14.32 17.58,20.59 12,17.5 6.42,20.59 7.62,14.32 2.96,9.96 9.3,9.18"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A star that adds the market to your watchlist, or takes it off. Inside a clickable row, it doesn't open the market. */
export function StarButton({ market }: { market: { readonly address: string; readonly label: string } }) {
  const { has, toggle } = useWatchlist();
  const on = has(market.address);
  return (
    <button
      type="button"
      className={`star-btn${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={`Star ${market.label}`}
      title={on ? "On your watchlist. Click to remove it." : "Add to your watchlist"}
      onClick={(e) => {
        e.stopPropagation();
        toggle(market.address);
      }}
    >
      <StarIcon filled={on} />
    </button>
  );
}
