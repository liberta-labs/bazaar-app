/** Plain-language explanations of protocol terms, shown as tooltips wherever the term appears. */
export const GLOSSARY = {
  perp: "A perpetual future: a bet on a price that never expires. You go long (profit if the price rises) or short (profit if it falls), with leverage.",
  long: "Buying: you profit when the price goes up.",
  short: "Selling: you profit when the price goes down.",
  mark: "The mark price is the market's own fair price, built from recent trades. Funding and some checks use it.",
  oracle: "The oracle price comes from Pyth, an external price feed. Profit and loss and liquidations are judged at it.",
  funding:
    "Funding is a small payment between longs and shorts every hour that keeps this market's price close to the oracle price. A positive rate means longs pay shorts.",
  margin: "Margin is the collateral that backs your position. More margin means lower leverage and a liquidation price further away.",
  marginRatio:
    "Your equity divided by the maintenance margin your position needs. Above 1 you're safe; below 1 anyone may liquidate your position. Higher is safer.",
  liquidation:
    "If your equity falls below the maintenance margin, your position is closed by a liquidator and you lose the collateral backing it.",
  liquidationPrice: "The estimated price at which your position could be liquidated. It moves as funding accrues.",
  leverage: "Position size divided by your equity. 5× means a 1% move in price changes your equity by about 5%.",
  collateral:
    "USDC you deposit on a market to back positions there. Collateral is held separately on each market: deposit on the market you want to trade.",
  equity: "Your collateral plus unrealized profit and loss.",
  unrealized: "Profit or loss on your open position if you closed it at the current price.",
  fundingPnl: "Funding you have received (positive) or paid (negative) since you opened the position.",
  openInterest: "The total size of all open positions on this market, long and short.",
  insurance:
    "Every market has its own insurance fund. It earns a share of trading fees and pays for liquidation losses beyond a trader's margin, protecting winning traders.",
  insuranceShare:
    "Depositing into a market's insurance fund gives you shares. Their value grows with the fund's fees and falls if liquidations lose money.",
  adl: "Auto-deleveraging (ADL): when the insurance fund can't cover the loss on liquidated positions, trading pauses while profitable positions on the other side are partly closed against them, those with the most profit for their collateral first. Five bars mean a position would be among the first.",
  limbo: "Limbo: the seconds before a scheduled shutdown. Trading has stopped and the settlement price is about to be fixed.",
  settling: "Settling: the market has a fixed final price and every open position is being closed at it. Withdrawals open once it finishes.",
  terminated: "Terminated: the market has ended. Withdraw your collateral; it pays out at the market's final payout ratio.",
  live: "Live: trading normally.",
  warmup:
    "New markets are capped at 5x leverage (2.5x if they follow trading hours) until they are 15 days old and have stored 25,000 prices, so margins are set from real price history. A price is stored each time a trade, a liquidation or a keeper refresh brings one in.",
  tradingHours: "This market follows its venue's trading hours (stocks, FX). While the venue is closed it runs on its last price and market orders are paused.",
  venueClosed: "The venue is closed: this market runs on its last price, fills are held within 10% of it, and market orders resume at the reopen. Limit orders still work.",
  postOnly: "Post-only: the order is cancelled instead of trading immediately, so you only ever add liquidity (and pay the lower maker fee).",
  tif: "Time in force. GTC rests in the book until filled or expired; IOC fills what it can now and cancels the rest; FOK fills completely now or not at all.",
  slippage:
    "The worst price you accept, as a distance from the oracle price, for orders that fill immediately. A lower limit protects your price but makes it more likely the order fills only partly or not at all, especially when the book is thin or the price is moving fast.",
  bounty: "A small USDC reward paid from your wallet to whoever fires your trigger order when its price is reached. Unused bounty comes back to you.",
  stopLimit: "A stop-limit becomes a limit order once the price reaches its trigger.",
  takeProfit: "Take-profit closes your position when the price moves in your favour to the trigger.",
  stopLoss: "Stop-loss closes your position when the price moves against you to the trigger, limiting your loss.",
  reduceOnly:
    "Reduce only: the order can only shrink or close your position, never add to it or flip it. The app holds it to your position when you send it, and a market order fills the moment it lands. For an exit that waits for a price, use a take-profit or stop-loss: the protocol itself caps those at your position.",
  realizedPnl:"Closed P&L: the price profit or loss a fill locked in by reducing or closing a position, before fees. Funding settled at the same time is under Funding history.",
  claimable:"Fees and refunds the protocol owes you on each market: refunded trigger bounties and rewards. Claim them to your wallet.",
  gasless:
    "Gasless: you sign, and Bazaar's relayer sends the transaction and pays the network fee. You need no ETH. On mainnet a small USDC fee covers its cost.",
  coverage: "The fund's size against its target, a share of open interest. Below target, traders pay higher fees that refill it.",
  budget: "Insurers share a withdrawal budget that refills every 6 hours, so the fund can't be drained at once.",
} as const;

export type Term = keyof typeof GLOSSARY;

export const STATUS_TEXT: Record<string, { label: string; term: Term }> = {
  live: { label: "Live", term: "live" },
  adl: { label: "ADL", term: "adl" },
  limbo: { label: "Limbo", term: "limbo" },
  settling: { label: "Settling", term: "settling" },
  terminated: { label: "Terminated", term: "terminated" },
};
