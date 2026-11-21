// Ribbon and command-search entries of the Motion tab. Each calls the same store action the panel and the timeline call.
import type { Command } from '@kit/ui';
import { t } from '../i18n';

export interface MotionActions {
  /** Show the Motion list in the left panel. */
  open(): void;
  hasDocument(): boolean;
  hasDrivers(): boolean;
  hasStudy(): boolean;
  isPlaying(): boolean;
  findLimits(): void;
  newStudy(): void;
  keyAll(): void;
  togglePlay(): void;
  exportClip(): void;
}

export function motionCommands(a: MotionActions): Command[] {
  return [
    { id: 'motion-drive', label: t('cmd.motion-drive'), tab: 'Motion', group: 'Drive', enabled: a.hasDrivers, run: a.open },
    { id: 'motion-find', label: t('cmd.motion-find'), tab: 'Motion', group: 'Drive', enabled: a.hasDrivers, run: a.findLimits },
    { id: 'motion-new-study', label: t('cmd.motion-new-study'), tab: 'Motion', group: 'Study', enabled: a.hasDrivers, run: a.newStudy },
    { id: 'motion-key', label: t('cmd.motion-key'), tab: 'Motion', group: 'Study', enabled: a.hasStudy, run: a.keyAll },
    { id: 'motion-play', label: t('cmd.motion-play'), tab: 'Motion', group: 'Playback', enabled: a.hasStudy, pressed: a.isPlaying, run: a.togglePlay },
    { id: 'motion-export', label: t('cmd.motion-export'), tab: 'Motion', group: 'Clip', enabled: a.hasStudy, run: a.exportClip },
  ];
}
