import test from 'node:test'
import assert from 'node:assert/strict'

import { mapChatModelForProvider } from './chat.service'

test('mapChatModelForProvider: passthrough for non-minimax gateway', () => {
  const oldBaseUrl = process.env.OPENAI_BASE_URL
  try {
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
    assert.equal(mapChatModelForProvider('gpt-4o-mini'), 'gpt-4o-mini')
  } finally {
    process.env.OPENAI_BASE_URL = oldBaseUrl
  }
})

test('mapChatModelForProvider: maps gpt aliases under minimax gateway', () => {
  const oldBaseUrl = process.env.OPENAI_BASE_URL
  const oldAllowed = process.env.ALLOWED_CHAT_MODELS
  try {
    process.env.OPENAI_BASE_URL = 'https://api.minimaxi.com/v1'
    process.env.ALLOWED_CHAT_MODELS = 'MiniMax-A,MiniMax-B'
    assert.equal(mapChatModelForProvider('gpt-4o'), 'MiniMax-A')
    assert.equal(mapChatModelForProvider('gpt-4o-mini'), 'MiniMax-B')
  } finally {
    process.env.OPENAI_BASE_URL = oldBaseUrl
    process.env.ALLOWED_CHAT_MODELS = oldAllowed
  }
})

