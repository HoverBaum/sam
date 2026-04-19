import React from 'react'
import { Box, Text } from 'ink'
import SelectInput from 'ink-select-input'
import { FIELD_LABELS } from './shellRouting.ts'
import type { SettingsField } from './shellRouting.ts'

interface SettingsMenuPanelProps {
  settingsItems: Array<{ label: string; value: SettingsField }>
  onSelect: (field: SettingsField) => void
}

interface SettingsEditPanelProps {
  editingField: SettingsField
  editBuffer: string
  autoSuggestions: string[]
}

export function ShellHomePanel() {
  return (
    <Box flexShrink={0}>
      <Text dimColor>
        Type /help for routes. Try /connect, /config, /index, or /home.
      </Text>
    </Box>
  )
}

export function SettingsMenuPanel({
  settingsItems,
  onSelect,
}: SettingsMenuPanelProps) {
  return (
    <Box marginTop={1} flexDirection="column" flexShrink={0}>
      <Text color="magenta">⚙️ Settings</Text>
      <Text dimColor>
        Enter edit · S save · Esc shell · current path shows where you are
      </Text>
      <SelectInput
        items={settingsItems}
        onSelect={(item) => onSelect(item.value)}
        limit={6}
      />
    </Box>
  )
}

export function SettingsEditPanel({
  editingField,
  editBuffer,
  autoSuggestions,
}: SettingsEditPanelProps) {
  return (
    <Box marginTop={1} flexDirection="column" flexShrink={0}>
      <Text color="green">Editing {FIELD_LABELS[editingField]}</Text>
      <Text dimColor>Tab autocomplete · Enter apply · Esc settings</Text>
      <Text>{editBuffer}</Text>
      {autoSuggestions.length > 0 ? (
        <Text dimColor>
          Suggestions: {autoSuggestions.slice(0, 5).join(' · ')}
        </Text>
      ) : null}
    </Box>
  )
}
