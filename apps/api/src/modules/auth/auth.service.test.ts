import test from 'node:test'
import assert from 'node:assert/strict'
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common'

import { AuthService } from './auth.service'

type QueryCall = { text: string; params: any[] }

class FakeDb {
  calls: QueryCall[] = []
  users = new Map<string, { id: string; email: string; password_hash: string }>()
  seq = 1

  async query<T = any>(text: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
    this.calls.push({ text, params })

    if (text.includes('SELECT id FROM users WHERE email')) {
      const email = String(params[0] || '')
      const u = this.users.get(email)
      return { rows: (u ? [{ id: u.id }] : []) as T[], rowCount: u ? 1 : 0 }
    }

    if (text.includes('INSERT INTO users (email, password_hash)') && text.includes('RETURNING id, email')) {
      const email = String(params[0] || '')
      const password_hash = String(params[1] || '')
      const id = `u-${this.seq++}`
      this.users.set(email, { id, email, password_hash })
      return { rows: [{ id, email }] as T[], rowCount: 1 }
    }

    if (text.includes('SELECT id, password_hash FROM users WHERE email')) {
      const email = String(params[0] || '')
      const u = this.users.get(email)
      if (!u) return { rows: [] as T[], rowCount: 0 }
      return { rows: [{ id: u.id, password_hash: u.password_hash }] as T[], rowCount: 1 }
    }

    if (text.includes('SELECT id, email FROM users WHERE id')) {
      const id = String(params[0] || '')
      const u = Array.from(this.users.values()).find((x) => x.id === id)
      if (!u) return { rows: [] as T[], rowCount: 0 }
      return { rows: [{ id: u.id, email: u.email }] as T[], rowCount: 1 }
    }

    throw new Error(`Unhandled SQL in test fake: ${text}`)
  }
}

class FakeJwt {
  async signAsync(payload: { sub: string }) {
    return `jwt-${payload.sub}`
  }
}

function createAuth() {
  const db = new FakeDb()
  const jwt = new FakeJwt()
  const auth = new AuthService(db as any, jwt as any)
  return { auth, db }
}

test('register: creates user, lowercases email and returns token', async () => {
  const { auth, db } = createAuth()
  const out = await auth.register('User@Example.COM', 'password123')
  assert.ok(out.token.startsWith('jwt-u-'))
  assert.equal(out.user.email, 'user@example.com')
  const saved = db.users.get('user@example.com')
  assert.ok(saved)
  assert.notEqual(saved?.password_hash, 'password123')
})

test('register: duplicate email throws ConflictException', async () => {
  const { auth } = createAuth()
  await auth.register('dup@example.com', 'password123')
  await assert.rejects(
    () => auth.register('dup@example.com', 'password123'),
    (e: any) => e instanceof ConflictException,
  )
})

test('register: invalid email throws BadRequestException', async () => {
  const { auth } = createAuth()
  await assert.rejects(
    () => auth.register('bad-email', 'password123'),
    (e: any) => e instanceof BadRequestException,
  )
})

test('register: weak password throws BadRequestException', async () => {
  const { auth } = createAuth()
  await assert.rejects(
    () => auth.register('ok@example.com', '1234567'),
    (e: any) => e instanceof BadRequestException,
  )
})

test('login: success with normalized email', async () => {
  const { auth } = createAuth()
  await auth.register('login@example.com', 'password123')
  const out = await auth.login('LOGIN@EXAMPLE.COM', 'password123')
  assert.equal(out.user.email, 'login@example.com')
  assert.ok(out.token.startsWith('jwt-'))
})

test('login: unknown email throws UnauthorizedException', async () => {
  const { auth } = createAuth()
  await assert.rejects(
    () => auth.login('none@example.com', 'password123'),
    (e: any) => e instanceof UnauthorizedException,
  )
})

test('login: wrong password throws UnauthorizedException', async () => {
  const { auth } = createAuth()
  await auth.register('wrongpass@example.com', 'password123')
  await assert.rejects(
    () => auth.login('wrongpass@example.com', 'password999'),
    (e: any) => e instanceof UnauthorizedException,
  )
})
