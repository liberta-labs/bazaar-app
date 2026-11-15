import { type WatchlistName, useWatchlist } from "../state/watchlist";

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

/**
 * A star that adds the market to a watchlist, or takes it off: the trading one unless `list` says
 * "earn". Inside a clickable row, it doesn't open the market.
 */
export function StarButton({ market, list = "trade" }: { market: { readonly address: string; readonly label: string }; list?: WatchlistName }) {
  const { has, toggle } = useWatchlist(list);
  const on = has(market.address);
  const which = list === "earn" ? "your Earn watchlist" : "your watchlist";
  return (
    <button
      type="button"
      className={`star-btn${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={`Star ${market.label}`}
      title={on ? `On ${which}. Click to remove it.` : `Add to ${which}`}
      onClick={(e) => {
        e.stopPropagation();
        toggle(market.address);
      }}
    >
      <StarIcon filled={on} />
    </button>
  );
}
