import { describe, expect, it } from 'vitest'
import { placeholdersIn } from './legalCheck.ts'

describe('placeholdersIn', () => {
  it('finds every field still holding a "[...]" placeholder', () => {
    expect(
      placeholdersIn([
        ['legalName', '[Business legal name]'],
        ['supportEmail', 'help@example.in'],
        ['address', '[Registered address]'],
        ['reviewed', false],
      ]),
    ).toEqual(['legalName', 'address'])
  })

  it('passes real details, including ones with brackets inside', () => {
    expect(placeholdersIn([['address', 'Shop 4 [Ground floor], Ahmedabad']])).toEqual([])
  })
})
