import { t } from '../i18n';
import type { CatalogItem } from './shapes';
/** The translated name of a catalog item (a built-in shape or a parts-library entry). */
export const itemLabel = (item: CatalogItem): string => (item.bosl ? t('catalog.bosl.entry.' + item.bosl.entryId) : t('catalog.item.' + item.id));
