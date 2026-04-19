import React from 'react'
import { MemoryRouter } from 'react-router'
import { ShellRoutes } from './ShellRoutes.tsx'
import type { CommandContext } from '../types.ts'

interface ShellProps {
  context: CommandContext
}

export function Shell(props: ShellProps) {
  return (
    <MemoryRouter initialEntries={['/']}>
      <ShellRoutes context={props.context} />
    </MemoryRouter>
  )
}
