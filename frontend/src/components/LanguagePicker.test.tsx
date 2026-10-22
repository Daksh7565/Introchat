import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { LanguagePicker } from './LanguagePicker'

describe('LanguagePicker', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
    window.localStorage.clear()
  })

  it('switches the UI language and remembers it on this device', async () => {
    const user = userEvent.setup()
    render(<LanguagePicker />)

    await user.selectOptions(screen.getByLabelText('Language'), 'gu')

    // The label itself turns Gujarati once gu.json has been fetched.
    expect(await screen.findByLabelText('ભાષા')).toBeInTheDocument()
    expect(i18n.language).toBe('gu')
    expect(document.documentElement.lang).toBe('gu')
    expect(window.localStorage.getItem('introchat.language')).toBe('gu')
  })

  it('shows every language in its own script', () => {
    render(<LanguagePicker />)
    const names = screen.getAllByRole('option').map((option) => option.textContent)
    expect(names).toEqual(['English', 'हिन्दी', 'ગુજરાતી'])
  })
})
