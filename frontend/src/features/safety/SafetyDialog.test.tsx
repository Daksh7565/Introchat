import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SafetyDialog } from './SafetyDialog'

function renderDialog(mode: 'block' | 'report') {
  const handlers = { onBlock: vi.fn(), onReport: vi.fn(), onCancel: vi.fn() }
  render(<SafetyDialog mode={mode} handle="Lotus-1234" busy={false} error={null} {...handlers} />)
  return handlers
}

describe('SafetyDialog', () => {
  it('says plainly that a block is final before blocking', async () => {
    const { onBlock } = renderDialog('block')
    expect(screen.getByRole('heading', { name: 'Block Lotus-1234?' })).toBeInTheDocument()
    expect(screen.getByText(/can't be undone/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Block' }))
    expect(onBlock).toHaveBeenCalledOnce()
  })

  it('needs a reason before a report can be sent', async () => {
    const { onReport } = renderDialog('report')
    const user = userEvent.setup()
    const send = screen.getByRole('button', { name: 'Report and block' })
    expect(send).toBeDisabled()
    await user.click(screen.getByLabelText('Harassment or threats'))
    await user.type(
      screen.getByLabelText('Anything we should know? (optional)'),
      'Kept messaging after I said no',
    )
    await user.click(send)
    expect(onReport).toHaveBeenCalledWith('harassment', 'Kept messaging after I said no')
  })
})
