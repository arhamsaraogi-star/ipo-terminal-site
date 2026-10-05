// Cross-language contract test: a vault sealed by Python (pipeline/build/vault.py seal_v3) must open in the browser,
// and accounts created in the browser must unlock it with just username + password.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { changePassword, createAccount, masterFromCode, openUser, openWithMk, parseVault, sealUser, unlockAccount } from './vault'

const buf = () => { const b = readFileSync(new URL('./__fixtures__/fixture.vault', import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }

describe('IPOV3 vault + accounts', () => {
  it('parses the header', () => {
    const h = parseVault(buf())
    expect(h.iters).toBe(1000)
    expect(h.repo).toBe('o/r')
    expect(h.iv.length).toBe(12)
  })
  it('opens with the access code', async () => {
    const h = parseVault(buf())
    const { key } = await masterFromCode(h, 'fixture code 123')
    expect(await openWithMk(h, key)).toEqual({ hello: '₹1,250 cr', n: [1, 2, 3] })
    await expect(masterFromCode(h, 'wrong')).rejects.toThrow('Wrong access code')
  })
  it('sign up → sign in with username + password only', async () => {
    const h = parseVault(buf())
    const { file } = await createAccount(h, 'Arham', 'abc123', 'fixture code 123')
    const s = await unlockAccount(h, file, 'abc123')
    expect((await openWithMk<{ n: number[] }>(h, s.mk)).n).toEqual([1, 2, 3])
    await expect(unlockAccount(h, file, 'abc124')).rejects.toThrow()
    await expect(createAccount(h, 'x', '12345', 'fixture code 123')).rejects.toThrow()
    await expect(createAccount(h, 'x', '123456', 'bad code')).rejects.toThrow()
  })
  it('personal data is readable only with the same password; change password keeps access', async () => {
    const h = parseVault(buf())
    const a = await createAccount(h, 'a', 'pass-one', 'fixture code 123')
    const b = await createAccount(h, 'b', 'pass-two', 'fixture code 123')
    const blob = await sealUser(a.session, { x: 1 })
    expect(await openUser(a.session, blob)).toEqual({ x: 1 })
    await expect(openUser(b.session, blob)).rejects.toThrow()
    const c = await changePassword(h, a.file, 'pass-one', 'newpass')
    const s2 = await unlockAccount(h, c.file, 'newpass')
    expect((await openWithMk<{ hello: string }>(h, s2.mk)).hello).toBe('₹1,250 cr')
  })
  it('rejects non-vault input', () => {
    expect(() => parseVault(new TextEncoder().encode('<html>not a vault</html>........................................').buffer)).toThrow()
  })
})
