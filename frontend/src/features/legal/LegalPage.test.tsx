import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import i18n, { changeLanguage } from '../../i18n'
import business from './business.json'
import { LegalPage, type LegalPageName } from './LegalPage'

const PAGES: LegalPageName[] = ['privacy', 'terms', 'refunds', 'contact']

function renderPage(page: LegalPageName) {
  return render(
    <MemoryRouter>
      <LegalPage page={page} />
    </MemoryRouter>,
  )
}

describe('LegalPage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
    window.localStorage.clear()
  })

  it('names the business and the grievance officer from business.json', () => {
    renderPage('privacy')
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeInTheDocument()
    const grievance = screen.getByRole('region', { name: 'Questions and complaints' })
    expect(grievance).toHaveTextContent(business.grievanceOfficer)
    expect(grievance).toHaveTextContent(business.grievanceEmail)
    expect(screen.getByText(new RegExp(`run by ${escape(business.legalName)}`))).toBeInTheDocument()
  })

  it('shows multi-line sections as lists', () => {
    renderPage('privacy')
    const collect = screen.getByRole('region', { name: 'What we collect' })
    expect(within(collect).getAllByRole('listitem')).toHaveLength(7)
  })

  it('marks the text as a draft until it has been reviewed', () => {
    renderPage('terms')
    expect(screen.getByRole('note')).toHaveTextContent('has not been reviewed by a lawyer')
  })

  it('lists the business details on the contact page', () => {
    renderPage('contact')
    expect(screen.getByText('Grievance Officer', { selector: 'dt' })).toBeInTheDocument()
    expect(screen.getByText(business.address, { selector: 'dd' })).toBeInTheDocument()
  })

  it.each(['hi', 'gu'] as const)(
    'renders every page in %s with no key left untranslated',
    async (language) => {
      await changeLanguage(language)
      for (const page of PAGES) {
        const { container, unmount } = renderPage(page)
        expect(container).not.toHaveTextContent(/legal\.|\{\{/)
        unmount()
      }
    },
  )
})

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
