import test from 'node:test'
import assert from 'node:assert/strict'

import { extractStreamContentDelta } from './stream-thinking.util'

test('extractStreamContentDelta: OpenAI 风格增量', () => {
  const st = { last: '', minimax: false }
  assert.equal(extractStreamContentDelta({ content: '你' }, st), '你')
  assert.equal(extractStreamContentDelta({ content: '好' }, st), '好')
})

test('extractStreamContentDelta: MiniMax 风格累积', () => {
  const st = { last: '', minimax: true }
  assert.equal(extractStreamContentDelta({ content: '你好' }, st), '你好')
  assert.equal(extractStreamContentDelta({ content: '你好世界' }, st), '世界')
})
