import React from "react";
import { Text } from "ink";
import Spinner from "ink-spinner";

export interface IndexProgressLineProps {
  phase: string;
  done: number;
  total: number;
}

export function IndexProgressLine({ phase, done, total }: IndexProgressLineProps) {
  return (
    <Text>
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
      {` ${phase} ${done}/${total}`}
    </Text>
  );
}
