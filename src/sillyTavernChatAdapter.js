function chatFileId(value) {
  return String(value ?? '').replace(/\.jsonl$/i, '');
}

export class SillyTavernChatAdapter {
  constructor() {
    this.requestHeaders = null;
  }

  context() {
    return SillyTavern.getContext();
  }

  async headers() {
    if (!this.requestHeaders) {
      const script = await import('/script.js');
      this.requestHeaders = script.getRequestHeaders;
    }
    if (typeof this.requestHeaders !== 'function') {
      throw new Error('当前 SillyTavern 没有暴露 getRequestHeaders');
    }
    return this.requestHeaders();
  }

  currentChat() {
    return this.context().chat || [];
  }

  currentGroupId() {
    const context = this.context();
    return context.groupId ?? context.selectedGroup ?? null;
  }

  hasCurrentChat() {
    const context = this.context();
    return Boolean(context.chatId && (this.currentCharacter() || this.currentGroupId()));
  }

  async loadCurrentChat(signal) {
    const context = this.context();
    const chatId = context.chatId;
    if (!chatId) return this.currentChat();

    const groupId = this.currentGroupId();
    if (groupId) {
      const chat = await this.post('/api/chats/group/get', {
        id: chatFileId(chatId),
      }, signal);
      return Array.isArray(chat) && chat.length ? chat : this.currentChat();
    }

    const character = this.currentCharacter();
    if (!character) return this.currentChat();
    const chat = await this.post('/api/chats/get', {
      avatar_url: character.avatar,
      file_name: chatFileId(chatId),
    }, signal);
    return Array.isArray(chat) && chat.length ? chat : this.currentChat();
  }

  currentCharacter() {
    const { characters, characterId } = this.context();
    if (characterId === undefined || characterId === null) return null;
    const character = characters?.[characterId];
    return character ? this.characterDescriptor(character, characterId) : null;
  }

  currentChatIdentity() {
    const character = this.currentCharacter();
    const chatId = this.context().chatId;
    if (!character || !chatId) return null;
    return `${character.avatar}::${chatFileId(chatId)}`;
  }

  characters() {
    return (this.context().characters || [])
      .map((character, index) => this.characterDescriptor(character, index))
      .filter(character => character.avatar);
  }

  characterDescriptor(character, index) {
    return {
      id: index,
      name: character?.name || character?.data?.name || `角色 ${index + 1}`,
      avatar: character?.avatar || character?.data?.avatar || '',
    };
  }

  async post(path, body, signal) {
    const response = await fetch(path, {
      method: 'POST',
      headers: await this.headers(),
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new Error(`${path} 请求失败：HTTP ${response.status}`);
    }
    return response.json();
  }

  async listCharacterChats(character, signal) {
    const results = await this.post('/api/chats/search', {
      query: '',
      avatar_url: character.avatar,
    }, signal);

    return (Array.isArray(results) ? results : []).map(item => ({
      characterId: character.id,
      characterName: character.name,
      characterAvatar: character.avatar,
      fileName: chatFileId(item.file_name ?? item.file_id),
      fileSize: item.file_size ?? '',
      messageCount: Number(item.message_count ?? item.chat_items) || 0,
      lastMessage: item.last_mes ?? '',
      preview: item.preview_message ?? '',
      fingerprint: [
        item.file_size ?? '',
        item.message_count ?? '',
        item.last_mes ?? '',
      ].join(':'),
    }));
  }

  async loadChat(descriptor, signal) {
    const chat = await this.post('/api/chats/get', {
      avatar_url: descriptor.characterAvatar,
      file_name: chatFileId(descriptor.fileName),
    }, signal);
    if (!Array.isArray(chat)) {
      throw new Error(`聊天文件读取失败：${descriptor.fileName || '未知文件'}`);
    }
    if (!chat.length && descriptor.messageCount > 0) {
      throw new Error(`聊天文件为空：${descriptor.fileName || '未知文件'}`);
    }
    return chat;
  }
}
