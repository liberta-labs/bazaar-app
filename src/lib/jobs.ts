/**
 * The app's writes as TxParts. How each is sent:
 * - createOrder, amendOrders, withdrawCollateral, depositToInsurance, executeInsuranceWithdrawal:
 *   always relayed (they carry a fresh Pyth price, which only the service can fetch);
 * - depositCollateral, cancelOrders, requestInsuranceWithdrawal: relayed, with the wallet as the
 *   fallback when the relayer is down;
 * - test USDC: from the service's faucet (no wallet, no ETH) when it offers one, else the wallet's claim;
 * - claimFees, governance, listings, termination and UMA calls: from the wallet.
 */
import { type Bazaar, OrderType, type PreparedCall, allowance, orders } from "@liberta-labs/bazaar-sdk";
import type { Address } from "viem";
import type { TxPart } from "../state/tx";
import type { RelayService } from "./relay";

/** USDC approval (when the allowance is short) and the call that pulls it, sent from the wallet. */
async function withApproval(bz: Bazaar, user: Address, pair: Address, call: PreparedCall): Promise<PreparedCall[]> {
  const f = await bz.allowance.usdcFunding(user, pair, call.pullsUsdc ?? 0n);
  if (!f.enoughBalance) {
    throw new Error(`Your wallet holds ${allowance.formatUsdcUnits(f.balance)} USDC; this needs ${allowance.formatUsdcUnits(f.needUsdc)}.`);
  }
  return f.approveUsdc > 0n ? [await bz.allowance.approveUsdc(user, pair, f.approveUsdc), call] : [call];
}

export function depositPart(pair: Address, amount: bigint, label = "Deposit collateral"): TxPart {
  return {
    kind: "relayed",
    label,
    pair,
    permit: true,
    input: () => ({ action: "depositCollateral", amount }),
    fallback: async (bz, user) => withApproval(bz, user, pair, await bz.trade.depositCollateral(pair, user, amount)),
  };
}

export function withdrawPart(pair: Address, amount: bigint): TxPart {
  return { kind: "relayed", label: "Withdraw collateral", pair, permit: false, input: () => ({ action: "withdrawCollateral", amount }) };
}

/** An order whose expiry (when it rests) is counted in Arbitrum blocks from the block at signing. */
export function orderPart(readBz: Bazaar, pair: Address, order: orders.OrderInput, expirySeconds: number | null, label = "Place order"): TxPart {
  return {
    kind: "relayed",
    label,
    pair,
    permit: true,
    input: async () => {
      const rests = orders.canRest(order.orderType, order.tif ?? 0);
      const expirationBlock = rests && expirySeconds !== null ? (await readBz.ctx.chain.blockNumber()) + orders.blocksIn(expirySeconds) : undefined;
      return { action: "createOrder", order: { ...order, ...(expirationBlock !== undefined ? { expirationBlock } : {}) } };
    },
  };
}

export function cancelPart(pair: Address, ids: readonly bigint[], label?: string): TxPart {
  return {
    kind: "relayed",
    label: label ?? (ids.length === 1 ? `Cancel order #${ids[0]}` : `Cancel ${ids.length} orders`),
    pair,
    permit: true,
    input: () => ({ action: "cancelOrders", orderIds: [...ids] }),
    fallback: async (bz, user) => [await bz.trade.cancelOrders(pair, user, ids)],
  };
}

export function amendPart(pair: Address, amendments: readonly orders.AmendInput[]): TxPart {
  return {
    kind: "relayed",
    label: amendments.length === 1 ? `Amend order #${amendments[0]!.orderId}` : `Amend ${amendments.length} orders`,
    pair,
    permit: true,
    input: () => ({ action: "amendOrders", amendments }),
  };
}

export function claimFeesPart(pair: Address, label = "Claim to your wallet"): TxPart {
  return { kind: "wallet", label, build: async (bz, user) => [await bz.trade.claimFees(pair, user)] };
}

export function faucetPart(): TxPart {
  return { kind: "wallet", label: "Claim test USDC", build: async (bz, user) => [await bz.allowance.claimFaucet(user)] };
}

/**
 * Test USDC from the service's faucet: Bazaar's relayer sends it from its own wallet, so the user signs
 * nothing and needs no ETH. When the service is down, the wallet's own claim is offered instead.
 */
export function serviceFaucetPart(service: RelayService, chainId: number): TxPart {
  return {
    kind: "service",
    label: "Get test USDC",
    send: (user) => service.drip(chainId, user),
    waiting: "Bazaar is sending test USDC to your wallet…",
    fallback: async (bz, user) => [await bz.allowance.claimFaucet(user)],
  };
}

export function insuranceDepositPart(pair: Address, amount: bigint): TxPart {
  return { kind: "relayed", label: "Deposit into the insurance fund", pair, permit: true, input: () => ({ action: "depositToInsurance", amount }) };
}

export function insuranceRequestPart(pair: Address, shareAmount: bigint): TxPart {
  return {
    kind: "relayed",
    label: "Request withdrawal",
    pair,
    permit: true,
    input: () => ({ action: "requestInsuranceWithdrawal", shareAmount }),
    fallback: async (bz, user) => [await bz.insurance.requestInsuranceWithdrawal(pair, user, shareAmount)],
  };
}

export function insuranceExecutePart(pair: Address, label: string): TxPart {
  return { kind: "relayed", label, pair, permit: true, input: () => ({ action: "executeInsuranceWithdrawal" }) };
}

/** A market order that closes the whole position. A full close is exempt from the $5 minimum. */
export function closeOrder(isLong: boolean, size: bigint, slippageBp = 100n): orders.OrderInput {
  return { orderType: OrderType.Market, isLong: !isLong, size, maxSlippageBp: slippageBp };
}

/** A costed governance call: its approvals first, then the call, from the wallet. */
export function costedPart(label: string, build: (bz: Bazaar, user: Address) => Promise<PreparedCall & { approvals?: readonly PreparedCall[] }>): TxPart {
  return {
    kind: "wallet",
    label,
    build: async (bz, user) => {
      const c = await build(bz, user);
      return [...(c.approvals ?? []), c];
    },
  };
}

/**
 * A smart-contract wallet cannot sign relayed requests: the actions it may take (deposit, cancel,
 * request an insurance withdrawal) go from the wallet instead, through their fallback.
 */
export function forAccount(part: TxPart, canSign: boolean): TxPart {
  if (canSign || part.kind !== "relayed" || !part.fallback) return part;
  return { kind: "wallet", label: part.label, build: part.fallback };
}
