import { describe, it, expect } from 'vitest'
import { validateAddress } from '@/lib/address'

const GOOD = {
    name: '  Dana Cohen ',
    email: 'dana@example.com',
    street1: '12 Herzl St',
    city: 'Tel Aviv',
    postcode: '6473424',
    countryCode: 'il',
}

describe('validateAddress', () => {
    it('accepts a complete address and tidies it', () => {
        const { address, problems } = validateAddress(GOOD)
        expect(problems).toEqual([])
        expect(address.name).toBe('Dana Cohen')
        expect(address.countryCode).toBe('IL')
        // Optional fields are absent rather than empty strings, so a
        // printer's API does not receive a blank line 2.
        expect(address).not.toHaveProperty('street2')
    })

    it('names the missing field rather than failing generically', () => {
        const { address, problems } = validateAddress({ ...GOOD, city: '   ' })
        expect(address).toBeNull()
        expect(problems[0]).toEqual({ field: 'city', message: 'City is required.' })
    })

    it('rejects an email that cannot receive the confirmation', () => {
        const { problems } = validateAddress({ ...GOOD, email: 'dana@example' })
        expect(problems[0].field).toBe('email')
    })

    it('insists on a two-letter country code', () => {
        expect(validateAddress({ ...GOOD, countryCode: 'Israel' }).problems[0].field).toBe('countryCode')
    })

    it('keeps the optional lines when they are given', () => {
        const { address } = validateAddress({ ...GOOD, street2: 'Apt 4', phone: '+972 50 123 4567' })
        expect(address.street2).toBe('Apt 4')
        expect(address.phone).toBe('+972 50 123 4567')
    })

    it('does not throw on rubbish', () => {
        expect(validateAddress(null).address).toBeNull()
        expect(validateAddress('nope').problems.length).toBeGreaterThan(0)
    })
})
