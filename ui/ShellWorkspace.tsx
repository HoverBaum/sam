import React from 'react'
import { Box, Text } from 'ink'
import { Route, Routes } from 'react-router'
import { ScrollView } from 'ink-scroll-view'
import { IndexProgressLine } from './IndexProgressLine.tsx'
import { ShellFrame } from './ShellFrame.tsx'
import { ShellHomePanel, SettingsEditPanel, SettingsMenuPanel } from './ShellSettings.tsx'
import { useShellWorkspace } from './useShellWorkspace.ts'
import type { CommandContext } from '../types.ts'

interface ShellWorkspaceProps {
  context: CommandContext
  vaultDisplay: string
}

export function ShellWorkspace({ context, vaultDisplay }: ShellWorkspaceProps) {
  const {
    terminalRows,
    locationPathname,
    prompt,
    footerContext,
    footerActions,
    promptValue,
    messages,
    staleHint,
    scrollRef,
    indexProgress,
    editingField,
    settingsItems,
    autoSuggestions,
    beginEditingField,
  } = useShellWorkspace(context)

  return (
    <ShellFrame
      variant="home"
      terminalRows={terminalRows}
      footerVault={vaultDisplay}
      footerContext={footerContext}
      footerRoute={locationPathname}
      footerActions={footerActions}
      prompt={prompt}
      promptValue={promptValue}
    >
      {staleHint ? (
        <Box flexShrink={0}>
          <Text color="yellow">{staleHint}</Text>
        </Box>
      ) : null}

      <Box
        flexGrow={1}
        flexShrink={1}
        minHeight={4}
        width="100%"
        overflow="hidden"
        flexDirection="column"
      >
        <ScrollView ref={scrollRef}>
          {messages.map((msg) => (
            <Text key={msg.id}>{msg.text}</Text>
          ))}
        </ScrollView>
      </Box>

      <Routes>
        <Route path="/" element={<ShellHomePanel />} />
        <Route
          path="/config"
          element={
            <SettingsMenuPanel
              settingsItems={settingsItems}
              onSelect={beginEditingField}
            />
          }
        />
        <Route
          path="/config/:field"
          element={
            editingField ? (
              <SettingsEditPanel
                editingField={editingField}
                editBuffer={promptValue}
                autoSuggestions={autoSuggestions}
              />
            ) : null
          }
        />
      </Routes>

      {indexProgress ? (
        <Box marginTop={1} flexShrink={0}>
          <IndexProgressLine
            phase={indexProgress.phase}
            done={indexProgress.done}
            total={indexProgress.total}
            phaseStartedAt={indexProgress.phaseStartedAt}
          />
        </Box>
      ) : null}
    </ShellFrame>
  )
}
