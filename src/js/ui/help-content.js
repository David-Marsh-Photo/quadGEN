import { APP_RELEASE_CHANNEL } from '../core/version.js';
import {
  VERSION_HISTORY as VERSION_HISTORY_DATA,
  generateAboutDialogVersionHistory as generateAboutDialogVersionHistoryInternal,
  getHelpReadmeHTML,
  getHelpGlossaryHTML,
  getHelpHistoryHTML,
  getHelpWorkflowHTML
} from './help-content-data.js';

export const VERSION_HISTORY = VERSION_HISTORY_DATA;

export function generateAboutDialogVersionHistory() {
  return generateAboutDialogVersionHistoryInternal(VERSION_HISTORY, APP_RELEASE_CHANNEL);
}

export {
  getHelpReadmeHTML,
  getHelpGlossaryHTML,
  getHelpHistoryHTML,
  getHelpWorkflowHTML
};
