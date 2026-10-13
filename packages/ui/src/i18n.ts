// Registers the UI package's English catalogue and re-exports t, so every component translates through one import.
import { registerCatalog } from '@kit/i18n';
import { en } from './locales/en';

registerCatalog('en', en);
export { t } from '@kit/i18n';
