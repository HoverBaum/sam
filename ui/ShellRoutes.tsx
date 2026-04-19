import React from 'react'
import { Route, Routes, useNavigate } from 'react-router'
import { ConnectFlow } from './ConnectFlow.tsx'
import { ShellWorkspace } from './ShellWorkspace.tsx'
import { useVaultDisplay } from './useVaultDisplay.ts'
import type { CommandContext } from '../types.ts'

interface ShellRoutesProps {
  context: CommandContext
}

export function ShellRoutes({ context }: ShellRoutesProps) {
  const navigate = useNavigate()
  const vaultDisplay = useVaultDisplay(context)

  return (
    <Routes>
      <Route
        path="/connect"
        element={
          <ConnectFlow
            context={context}
            vaultDisplay={vaultDisplay}
            onExit={() => navigate('/')}
          />
        }
      />
      <Route
        path="*"
        element={
          <ShellWorkspace context={context} vaultDisplay={vaultDisplay} />
        }
      />
    </Routes>
  )
}
