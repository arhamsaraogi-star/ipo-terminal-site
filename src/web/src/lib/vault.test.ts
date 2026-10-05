// Cross-language contract test: a vault sealed by Python (pipeline/build/vault.py seal_v2) must open in the browser.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { login, openUser, parseVault, sealUser } from './vault'

const buf = () => { const b = readFileSync(new URL('./__fixtures__/fixture.vault', import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }

describe('IPOV2 vault', () => {
  it('parses the header', () => {
    const h = parseVault(buf())
    expect(h.iters).toBe(1000)
    expect(h.users.length).toBe(2)
    expect(h.iv.length).toBe(12)
  })
  it('opens for each user (username is case/space-insensitive)', async () => {
    expect((await login<{ hello: string }>(buf(), ' ARHAM', 'fixture password 1')).data.hello).toBe('₹1,250 cr')
    expect((await login<{ n: number[] }>(buf(), 'boss', 'another pass 22')).data.n).toEqual([1, 2, 3])
  })
  it('rejects a wrong password or unknown user', async () => {
    await expect(login(buf(), 'arham', 'wrong password')).rejects.toThrow()
    await expect(login(buf(), 'nobody', 'fixture password 1')).rejects.toThrow()
  })
  it('user data round-trips with the personal key only', async () => {
    const a = (await login(buf(), 'arham', 'fixture password 1')).session
    const b = (await login(buf(), 'boss', 'another pass 22')).session
    const blob = await sealUser(a, { x: 1 })
    expect(await openUser(a, blob)).toEqual({ x: 1 })
    await expect(openUser(b, blob)).rejects.toThrow()
  })
  it('rejects non-vault input', () => {
    expect(() => parseVault(new TextEncoder().encode('<html>not a vault</html>........................................').buffer)).toThrow()
  })
})
