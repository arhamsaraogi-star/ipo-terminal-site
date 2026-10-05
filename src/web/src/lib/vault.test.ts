// Cross-language contract test: a vault sealed by Python (pipeline/build/vault.py) must open with the browser code.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openVault, parseVault } from './vault'

const buf = () => { const b = readFileSync(new URL('./__fixtures__/fixture.vault', import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }

describe('IPOV1 vault', () => {
  it('parses the header', () => {
    const h = parseVault(buf())
    expect(h.iterations).toBe(1000)
    expect(h.salt.length).toBe(16)
    expect(h.iv.length).toBe(12)
  })
  it('decrypts a Python-sealed vault', async () => {
    const { data } = await openVault<{ hello: string; n: number[] }>(buf(), 'fixture passphrase 123')
    expect(data).toEqual({ hello: '₹1,250 cr', n: [1, 2, 3] })
  })
  it('rejects a wrong password', async () => {
    await expect(openVault(buf(), 'wrong passphrase')).rejects.toThrow('Incorrect password')
  })
  it('rejects non-vault input', () => {
    expect(() => parseVault(new TextEncoder().encode('<html>not a vault</html>........................................').buffer)).toThrow()
  })
})
