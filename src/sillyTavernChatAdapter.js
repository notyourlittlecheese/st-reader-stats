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
    return `${character.avatar}::${String(chatId).replace(/\.jsonl$/i, '')}`;
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
      fileName: item.file_name,
      fileSize: item.file_size ?? '',
      messageCount: Number(item.message_count) || 0,
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
    return this.post('/api/chats/get', {
      avatar_url: descriptor.characterAvatar,
      file_name: descriptor.fileName,
    }, signal);
  }
}
