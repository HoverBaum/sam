import React from "react";
import { Text } from "ink";
import Spinner from "ink-spinner";

export interface IndexProgressLineProps {
  phase: string;
  done: number;
  total: number;
  phaseStartedAt?: number;
}

export function formatEta(seconds: number): string {
  const rounded = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (minutes === 0) {
    return `${remainder}s`;
  }
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

export function estimateEtaSeconds(
  done: number,
  total: number,
  phaseStartedAt: number | undefined,
  nowMs = Date.now(),
): number | null {
  if (!phaseStartedAt || done <= 0 || total <= done) {
    return null;
  }
  const elapsedSeconds = Math.max(0, (nowMs - phaseStartedAt) / 1000);
  if (elapsedSeconds <= 0) {
    return null;
  }
  const rate = done / elapsedSeconds;
  if (!Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  return (total - done) / rate;
}

export function IndexProgressLine({ phase, done, total, phaseStartedAt }: IndexProgressLineProps) {
  const etaSeconds = estimateEtaSeconds(done, total, phaseStartedAt);
  const etaLabel = etaSeconds === null ? "" : ` • ETA ${formatEta(etaSeconds)}`;
  return (
    <Text>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      {` ${phase} ${done}/${total}${etaLabel}`}
    </Text>
  );
}
