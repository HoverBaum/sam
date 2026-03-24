import { useEffect, useState } from "react";
import type { CommandContext } from "../types.ts";
import { VaultClient } from "../vault/client.ts";

const OBSIDIAN_CONNECTION_ERROR = "Unable to connect to Obsidian main process";
const OBSIDIAN_MISSING_ERROR = "Obsidian CLI not found";

/** Resolves the active Obsidian vault name for footer chrome (shared by shell + connect). */
export function useVaultDisplay(context: CommandContext): string {
  const [vaultDisplay, setVaultDisplay] = useState<string>(
    context.config.vault?.trim().length ? context.config.vault : "(resolving...)",
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const vault = new VaultClient(context.config);
      try {
        const currentName = await vault.currentVaultName();
        if (!cancelled) {
          setVaultDisplay(currentName);
        }
      } catch (error) {
        if (!cancelled) {
          const message = String((error as Error).message ?? error);
          if (message.includes(OBSIDIAN_CONNECTION_ERROR)) {
            setVaultDisplay("(unavailable: open Obsidian)");
          } else if (message.includes(OBSIDIAN_MISSING_ERROR)) {
            setVaultDisplay("(unavailable: CLI missing)");
          } else {
            setVaultDisplay("(unavailable)");
          }
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [context.config]);

  return vaultDisplay;
}
