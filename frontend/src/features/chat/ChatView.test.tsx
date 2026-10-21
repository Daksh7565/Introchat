import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChatView } from './ChatView'

function renderChat(canSend: boolean) {
  const onSend = vi.fn()
  render(
    <ChatView
      partnerHandle="Lotus-2210"
      messages={[]}
      canSend={canSend}
      partnerTyping={false}
      onSend={onSend}
      onBack={vi.fn()}
      onBlock={vi.fn()}
      onReport={vi.fn()}
    />,
  )
  return onSend
}

describe('ChatView composer', () => {
  it('sends the trimmed text and clears the box', async () => {
    const user = userEvent.setup()
    const onSend = renderChat(true)
    const box = screen.getByLabelText('Type a message')
    await user.type(box, '  hello there  ')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('hello there')
    expect(box).toHaveValue('')
  })

  it('never sends a whitespace-only message', async () => {
    const user = userEvent.setup()
    const onSend = renderChat(true)
    await user.type(screen.getByLabelText('Type a message'), '    ')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends on Enter', async () => {
    const user = userEvent.setup()
    const onSend = renderChat(true)
    await user.type(screen.getByLabelText('Type a message'), 'hi{Enter}')
    expect(onSend).toHaveBeenCalledWith('hi')
  })

  it('adds a new line on Shift+Enter instead of sending', async () => {
    const user = userEvent.setup()
    const onSend = renderChat(true)
    const box = screen.getByLabelText('Type a message')
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(onSend).not.toHaveBeenCalled()
    expect(box).toHaveValue('line one\nline two')
  })

  it('does not send while a Hindi/Gujarati input method is still composing a word', () => {
    const onSend = renderChat(true)
    const box = screen.getByLabelText('Type a message')
    fireEvent.change(box, { target: { value: 'नमस्ते' } })
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('नमस्ते')
  })

  it('is read-only once the other person has left', () => {
    renderChat(false)
    expect(screen.queryByLabelText('Type a message')).not.toBeInTheDocument()
    expect(
      screen.getByText('Lotus-2210 has left. You can still read and report this chat.'),
    ).toBeInTheDocument()
  })
})
