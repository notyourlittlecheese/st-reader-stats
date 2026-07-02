import { SillyTavernChatAdapter } from './src/sillyTavernChatAdapter.js';
import { StatsIndex } from './src/indexCache.js';
import { StatsDashboard } from './src/dashboard.js';

const MODULE_NAME = 'st-reader-stats';

let dashboard;

function initialize() {
  if (dashboard) return;

  const adapter = new SillyTavernChatAdapter();
  const cache = new StatsIndex();
  dashboard = new StatsDashboard({ adapter, cache });
  dashboard.mount();

  const context = SillyTavern.getContext();
  const refreshCurrent = () => dashboard?.markCurrentChatDirty();
  if (context.event_types.CHAT_CHANGED) {
    context.eventSource.on(
      context.event_types.CHAT_CHANGED,
      () => dashboard?.handleChatChanged(),
    );
  }
  const mutationEvents = [
    context.event_types.MESSAGE_SENT,
    context.event_types.MESSAGE_RECEIVED,
    context.event_types.MESSAGE_EDITED,
    context.event_types.MESSAGE_DELETED,
    context.event_types.MESSAGE_SWIPED,
  ].filter(Boolean);

  for (const event of mutationEvents) {
    context.eventSource.on(event, refreshCurrent);
  }

  console.log(`[${MODULE_NAME}] loaded`);
}

if (globalThis.SillyTavern?.getContext) {
  const { eventSource, event_types } = SillyTavern.getContext();
  if (event_types?.APP_READY) {
    eventSource.on(event_types.APP_READY, initialize);
  } else {
    initialize();
  }
}

export function onActivate() {
  initialize();
}
