import assert from 'node:assert/strict';
import test from 'node:test';

import { SillyTavernChatAdapter } from '../src/sillyTavernChatAdapter.js';

test('loadCurrentChat fetches a complete solo chat file', async () => {
  const context = {
    chatId: 'long-chat',
    characterId: 0,
    characters: [{ name: '角色', avatar: 'character.png' }],
    chat: [{ mes: 'frontend tail only' }],
  };
  globalThis.SillyTavern = { getContext: () => context };
  const adapter = new SillyTavernChatAdapter();
  let request;
  adapter.post = async (path, body) => {
    request = { path, body };
    return [{ mes: 'full one' }, { mes: 'full two' }];
  };

  const chat = await adapter.loadCurrentChat();
  assert.equal(request.path, '/api/chats/get');
  assert.deepEqual(request.body, {
    avatar_url: 'character.png',
    file_name: 'long-chat',
  });
  assert.equal(chat.length, 2);
});

test('loadCurrentChat fetches a complete group chat file', async () => {
  const context = {
    chatId: 'group-chat.jsonl',
    groupId: 'group-1',
    characters: [],
    chat: [{ mes: 'frontend tail only' }],
  };
  globalThis.SillyTavern = { getContext: () => context };
  const adapter = new SillyTavernChatAdapter();
  let request;
  adapter.post = async (path, body) => {
    request = { path, body };
    return [{ mes: 'full group one' }, { mes: 'full group two' }];
  };

  const chat = await adapter.loadCurrentChat();
  assert.equal(request.path, '/api/chats/group/get');
  assert.deepEqual(request.body, { id: 'group-chat' });
  assert.equal(chat.length, 2);
});
