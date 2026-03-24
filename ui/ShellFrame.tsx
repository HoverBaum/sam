import React, { type ReactNode } from "react";
import { Box, Text } from "ink";
import Gradient from "ink-gradient";

export interface ShellFrameProps {
  variant?: "home" | "sub";
  /** Shown when variant is "sub" (e.g. connect flow). */
  subTitle?: string;
  /** Clamp layout to the terminal so the headline and footer stay visible. */
  terminalRows: number;
  footerVault: string;
  footerContext: string;
  prompt: string;
  promptValue: string;
  children: ReactNode;
}

export function ShellFrame(
  { variant = "home", subTitle, terminalRows, footerVault, footerContext, prompt, promptValue, children }: ShellFrameProps,
) {
  return (
    <Box flexDirection="column" height={terminalRows} width="100%">
      {variant === "home"
        ? (
          <Box flexDirection="column" marginBottom={1} flexShrink={0}>
            <Gradient colors={["#FF6B9D", "#C44EFF", "#4ECDC4", "#45B7D1"]}>
              <Text bold>sam</Text>
            </Gradient>
            <Gradient name="vice">
              <Text bold>personal knowledge companion</Text>
            </Gradient>
          </Box>
        )
        : (
          <Box marginBottom={1} flexDirection="column" flexShrink={0}>
            {subTitle ? <Text color="cyan" bold>{subTitle}</Text> : null}
          </Box>
        )}

      <Box
        flexDirection="column"
        flexGrow={1}
        flexShrink={1}
        minHeight={0}
        overflow="hidden"
        width="100%"
      >
        {children}
      </Box>

      <Box
        marginTop={1}
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        flexDirection="column"
        flexShrink={0}
        gap={0}
      >
        <Text>
          <Text color="cyan" bold>Vault </Text>
          <Text dimColor>{footerVault}</Text>
        </Text>
        <Text>
          <Text color="magenta" bold>Mode </Text>
          <Text dimColor>{footerContext}</Text>
        </Text>
        <Text>
          <Text color="green">{prompt}</Text>
          {promptValue}
        </Text>
      </Box>
    </Box>
  );
}
