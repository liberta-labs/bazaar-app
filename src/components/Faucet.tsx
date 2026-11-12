import { useCallback, useEffect, useState } from "react";
import type { allowance } from "@liberta-labs/bazaar-sdk";
import { ACTIVE } from "../config/networks";
import { relative, usdcUnits } from "../lib/format";
import { faucetPart, serviceFaucetPart } from "../lib/jobs";
import type { FaucetOffer } from "../lib/relay";
import { useRead, useRelayService, useWallet } from "../state/connection";
import { useTx } from "../state/tx";
import { TestUsdcGuide } from "./TestUsdcHelp";
import { ActionButton, TxLink } from "./ui";

/**
 * Testnet only: get test USDC. When Bazaar's service offers a faucet, it sends the test USDC from its
 * own wallet: nothing to sign, no ETH needed, up to `perAddressPerDay` times per address in any 24 hours.
 * Otherwise the wallet claims from the token's own faucet, once a day per address, which needs a little
 * ETH for gas.
 */
export function FaucetButton({
  compact = false,
  header = false,
  hideOnPhone = false,
  onDone,
}: {
  compact?: boolean;
  /** The header's button: the brand yellow at full height, matching the buttons beside it, with the short label. */
  header?: boolean;
  hideOnPhone?: boolean;
  onDone?: () => void;
}) {
  const { readBz } = useRead();
  const w = useWallet();
  const tx = useTx();
  const service = useRelayService();
  const [status, setStatus] = useState<allowance.FaucetStatus | null>(null);
  const [offer, setOffer] = useState<FaucetOffer | null>(null);
  // Once test USDC lands: the guide to seeing it in the wallet, with what arrived.
  const [arrived, setArrived] = useState<{
    amount: string;
    hash: string | undefined;
  } | null>(null);

  const load = useCallback(async () => {
    const [o, s] = await Promise.all([
      ACTIVE.testnet ? service.faucet(ACTIVE.chainId) : Promise.resolve(null),
      readBz && w.address
        ? readBz.allowance.faucetStatus(w.address).catch(() => null)
        : Promise.resolve(null),
    ]);
    setOffer(o);
    setStatus(s);
  }, [readBz, w.address, service]);

  useEffect(() => {
    void load();
  }, [load]);

  const gasless = offer !== null && offer.available;
  // No service faucet and a token without one: nothing to offer.
  if (!ACTIVE.testnet || (!gasless && status && !status.available)) return null;
  const amount = gasless ? offer.amountUsdc : (status?.amountUsdc ?? null);
  const cls = `faucet${compact ? " small" : ""}${hideOnPhone ? " hide-sm" : ""}`;
  const label = compact || header
    ? "Get test USDC"
    : `Get ${amount ? usdcUnits(amount) : "10,000"} test USDC`;
  if (!w.address) {
    return (
      <button className={cls} onClick={w.openConnect}>
        {label}
      </button>
    );
  }
  // The wallet claim's cooldown applies only when the wallet claims.
  const reason =
    !gasless && status && !status.canClaimNow
      ? `You can claim again ${relative(status.nextClaimTs, status.now)}. Claiming from your wallet works once a day per address.`
      : null;
  const shown = amount ? usdcUnits(amount) : "10,000";
  return (
    <>
      <ActionButton
        className={cls}
        disabledReason={reason}
        onClick={() =>
          void tx
            .run({
              title: "Get test USDC",
              summary: gasless
                ? [
                    `Bazaar sends ${shown} test USDC to your wallet.`,
                    `Nothing to sign and no ETH needed. ${offer.perAddressPerDay === 1 ? "Once" : `Up to ${offer.perAddressPerDay} times`} per address in any 24 hours. Test USDC has no real value.`,
                  ]
                : [
                    `Claim ${shown} test USDC to your wallet.`,
                    `Sent from your wallet: it needs a little ${ACTIVE.name} ETH for gas, and works once a day per address. Test USDC has no real value.`,
                  ],
              parts: [
                gasless
                  ? serviceFaucetPart(service, ACTIVE.chainId)
                  : faucetPart(),
              ],
              onDone: () => {
                void load();
                onDone?.();
              },
              next: (hash) => setArrived({ amount: shown, hash }),
            })
            .then(() => load())
        }
      >
        {label}
      </ActionButton>
      {arrived && (
        <TestUsdcGuide
          onClose={() => setArrived(null)}
          banner={
            <div
              className="banner good small"
              role="status"
              style={{ margin: 0 }}
            >
              <div className="grow">
                <b>{arrived.amount} test USDC is in your wallet.</b> Add it to
                your wallet's token list once to see the balance there.
                {arrived.hash && (
                  <div style={{ marginTop: 4 }}>
                    <TxLink hash={arrived.hash} />
                  </div>
                )}
              </div>
            </div>
          }
        />
      )}
    </>
  );
}
