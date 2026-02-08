import type { MessageFromContent, MessageToContent } from '../shared/types';
import { getExtApi } from '../shared/utils';
import { extractResources, isMoodlePage } from './extractor';

const ext = getExtApi();

ext.runtime.onMessage.addListener(
  (message: MessageToContent, _sender: unknown, sendResponse: (resp: MessageFromContent) => void) => {
    const moodle = isMoodlePage(document);

    if (message?.type === 'MD_PING') {
      sendResponse({ type: 'MD_PONG', isMoodle: moodle });
      return false;
    }

    if (message?.type === 'MD_EXTRACT_RESOURCES') {
      const resources = extractResources(document);
      sendResponse({ type: 'MD_EXTRACT_RESOURCES_RESULT', resources, isMoodle: moodle });
      return false;
    }

    return false;
  },
);
