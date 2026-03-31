import test from 'node:test'
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'

import { normalizeScope, parseUuidList } from './history.service'

test('normalizeScope: defaults to active for unknown input', () => {
  assert.equal(normalizeScope(undefined), 'active')
  assert.equal(normalizeScope('unknown'), 'active')
})

test('normalizeScope: supports archived and all', () => {
  assert.equal(normalizeScope('archived'), 'archived')
  assert.equal(normalizeScope('ALL'), 'all')
})

test('parseUuidList: validates and returns uuid array', () => {
  const id = '123e4567-e89b-42d3-a456-426614174000'
  const out = parseUuidList([id])
  assert.deepEqual(out, [id])
})

test('parseUuidList: throws for invalid uuid', () => {
  assert.throws(() => parseUuidList(['not-uuid']), (e: any) => e instanceof BadRequestException)
})

