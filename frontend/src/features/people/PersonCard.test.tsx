import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PersonCard } from './PersonCard'
import type { ChatState, Person } from './types'

function makePerson(chatState: ChatState): Person {
  return {
    sessionId: 's1',
    handle: 'Falcon-0937',
    tags: ['football', 'music'],
    sharedTags: ['music'],
    online: true,
    chatState,
  }
}

function renderCard(chatState: ChatState) {
  const handlers = {
    onSendRequest: vi.fn(),
    onAcceptRequest: vi.fn(),
    onOpenChat: vi.fn(),
    onReport: vi.fn(),
    onBlock: vi.fn(),
  }
  render(
    <ul>
      <PersonCard person={makePerson(chatState)} {...handlers} />
    </ul>,
  )
  return handlers
}

describe('PersonCard', () => {
  it.each([
    ['none', 'Say hi', 'onSendRequest'],
    ['request_received', 'Accept', 'onAcceptRequest'],
    ['chatting', 'Open chat', 'onOpenChat'],
  ] as const)('%s → "%s" calls %s with the session id', async (state, label, handler) => {
    const handlers = renderCard(state)
    await userEvent.setup().click(screen.getByRole('button', { name: label }))
    expect(handlers[handler]).toHaveBeenCalledWith('s1')
  })

  it.each([
    ['request_sent', 'Request sent'],
    ['declined', 'Not available'],
  ] as const)('%s → "%s" is shown but cannot be tapped', (state, label) => {
    renderCard(state)
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
  })

  it('says how many interests are shared', () => {
    renderCard('none')
    expect(screen.getByText('1 interest in common')).toBeInTheDocument()
  })
})
