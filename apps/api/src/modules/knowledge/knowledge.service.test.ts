import test from 'node:test'
import assert from 'node:assert/strict'

import { chunkText, normalizeChunkStrategy } from './knowledge.service'

test('normalizeChunkStrategy: falls back to semantic', () => {
  assert.equal(normalizeChunkStrategy('bad-value'), 'semantic')
  assert.equal(normalizeChunkStrategy(undefined), 'semantic')
})

test('normalizeChunkStrategy: accepts known values', () => {
  assert.equal(normalizeChunkStrategy('fixed'), 'fixed')
  assert.equal(normalizeChunkStrategy('paragraph'), 'paragraph')
})

test('chunkText: splits with overlap and keeps non-empty chunks', () => {
  const text = 'a '.repeat(1200)
  const chunks = chunkText(text, 200, 20)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((x) => x.trim().length > 0))
})

