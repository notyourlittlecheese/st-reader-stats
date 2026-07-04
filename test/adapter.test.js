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

test('list and load normalize search results with a jsonl suffix', async () => {
  globalThis.SillyTavern = { getContext: () => ({}) };
  const adapter = new SillyTavernChatAdapter();
  const requests = [];
  adapter.post = async (path, body) => {
    requests.push({ path, body });
    if (path === '/api/chats/search') {
      return [{
        file_name: 'branched-chat.jsonl',
        file_size: '12 KB',
        message_count: 42,
        last_mes: 123,
      }];
    }
    return [{ chat_metadata: {} }, { mes: '完整聊天' }];
  };

  const [descriptor] = await adapter.listCharacterChats({
    id: 3,
    name: '角色',
    avatar: 'character.png',
  });
  assert.equal(descriptor.fileName, 'branched-chat');
  assert.equal(descriptor.messageCount, 42);

  const chat = await adapter.loadChat(descriptor);
  assert.equal(chat.length, 2);
  assert.deepEqual(requests.at(-1), {
    path: '/api/chats/get',
    body: {
      avatar_url: 'character.png',
      file_name: 'branched-chat',
    },
  });
});

test('loadChat rejects an empty object instead of caching zero statistics', async () => {
  globalThis.SillyTavern = { getContext: () => ({}) };
  const adapter = new SillyTavernChatAdapter();
  adapter.post = async () => ({});

  await assert.rejects(
    () => adapter.loadChat({
      characterAvatar: 'character.png',
      fileName: 'missing-chat',
      messageCount: 100,
    }),
    /聊天文件读取失败/,
  );
});
