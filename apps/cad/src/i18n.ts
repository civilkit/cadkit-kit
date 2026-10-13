// Registers the CAD app's English catalogue (and the shared UI one) and re-exports t.
import '@kit/ui';
import { registerCatalog } from '@kit/i18n';
import { en } from './locales/en';

registerCatalog('en', en);
export { t } from '@kit/i18n';
