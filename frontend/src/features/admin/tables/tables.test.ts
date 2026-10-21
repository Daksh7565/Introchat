import { describe, expect, it } from 'vitest'
import { rangeLabels } from './labels'
import { cardPosition, tableUrl } from './qrCards'

describe('rangeLabels', () => {
  it('builds zero-padded labels so they sort correctly', () => {
    expect(rangeLabels({ prefix: 'T', from: 1, to: 3, pad: 2 })).toEqual(['T01', 'T02', 'T03'])
  })

  it('supports a word prefix without padding', () => {
    expect(rangeLabels({ prefix: 'Table ', from: 9, to: 10, pad: 0 })).toEqual([
      'Table 9',
      'Table 10',
    ])
  })

  it.each([
    { prefix: 'T', from: 5, to: 4, pad: 0 },
    { prefix: 'T', from: 1, to: 201, pad: 0 },
    { prefix: 'T', from: 1.5, to: 3, pad: 0 },
  ])('returns nothing for an invalid range %o', (range) => {
    expect(rangeLabels(range)).toEqual([])
  })
})

describe('tableUrl', () => {
  it('builds the URL printed in the QR code', () => {
    expect(tableUrl('https://introchat.pages.dev', 'chai-cafe', 'Ab3dEf6hIj9kLm2n')).toBe(
      'https://introchat.pages.dev/v/chai-cafe/t/Ab3dEf6hIj9kLm2n',
    )
  })
})

describe('cardPosition', () => {
  it('places four A6 cards per A4 page in a 2 × 2 grid', () => {
    expect([0, 1, 2, 3, 4].map(cardPosition)).toEqual([
      { page: 0, x: 0, y: 0 },
      { page: 0, x: 105, y: 0 },
      { page: 0, x: 0, y: 148.5 },
      { page: 0, x: 105, y: 148.5 },
      { page: 1, x: 0, y: 0 },
    ])
  })
})
