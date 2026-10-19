// The status-bar chip shown while the part on screen is a stored snapshot and the kernel is still rebuilding it.
import type { StatusItem } from '@kit/ui';
import { t } from '../i18n';

export const cachedChip = (cached: boolean): StatusItem | null =>
  cached ? { label: t('files.cache.chip'), value: t('files.cache.rebuilding'), tone: 'warn', title: t('files.cache.tip') } : null;
