import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Store } from '@kit/store';
import type { StatusItem } from '@kit/ui';
import type { Controller } from './controller';
import { chipParts, chipTone, issueFaceMap, issueNames, issueTarget, type Issue, type ProfileInfo, type ProfileReport } from './designCheck';
import {
  ACTIVE_KEY, AFTER_KEY, buildPolicy, defaultSettings, loadFlag, loadSettings, loadText, saveFlag, saveSettings, saveText, settingsToInline, type ProfileSettings,
} from './checkSettings';
import { plural, type DesignCheckProps } from './CheckPanel';
import { t } from './i18n';

interface Last { report: ProfileReport; revision: number; name: string }
export interface ViewportLike { setIssueFaces(m: Record<string, 'error' | 'warn' | 'info'>): void; setIssueHover(n: string[]): void; frameNames(n: string[]): void }

/** All the state of the Design check: profile, settings, the last result, and the policy the controller enforces. */
export function useDesignCheck(controller: Controller, store: Store, getViewport: () => ViewportLike | null, openPanel: () => void) {
  const [profiles, setProfiles] = useState<ProfileInfo[] | null>(null);
  const [profileId, setProfileId] = useState(() => loadText(ACTIVE_KEY) ?? 'fdm-print');
  const [settings, setSettings] = useState<ProfileSettings | null>(null);
  const [afterEdit, setAfterEdit] = useState(() => loadFlag(AFTER_KEY));
  const [last, setLast] = useState<Last | null>(null);
  const [running, setRunning] = useState(false);
  const rev = controller.revision;

  const profile = profiles?.find((p) => p.id === profileId) ?? profiles?.[0] ?? null;
  // the list comes from the kernel once there is a document; it is only a catalogue, no check runs here
  useEffect(() => {
    if (profiles) return;
    void controller.profiles().then((l) => { if (l) setProfiles(l.profiles); });
  }, [rev, profiles]);
  useEffect(() => { if (profile) setSettings(loadSettings(profile)); }, [profile?.id]);

  // what the controller enforces and runs after edits: always the latest settings
  const live = useRef({ profile, settings, afterEdit });
  live.current = { profile, settings, afterEdit };
  useEffect(() => {
    controller.policy = () => {
      const l = live.current;
      return l.profile && l.settings ? buildPolicy(l.profile, l.settings, l.afterEdit) : null;
    };
    controller.onCheck = (r) => setLast({ report: r.report, revision: r.revision, name: r.policy.name });
    return () => { controller.policy = null; controller.onCheck = null; };
  }, [controller]);

  const stale = !!last && last.revision !== rev;
  useEffect(() => {
    getViewport()?.setIssueFaces(last && !stale ? issueFaceMap(last.report.issues) : {});
  }, [last, stale]);

  const props: DesignCheckProps = {
    profiles, profileId: profile?.id ?? profileId,
    onProfile: (id) => { setProfileId(id); saveText(ACTIVE_KEY, id); },
    settings,
    onSettings: (s) => { setSettings(s); if (profile) saveSettings(profile, s); },
    onReset: () => { if (profile) { const d = defaultSettings(profile); setSettings(d); saveSettings(profile, d); } },
    afterEdit, onAfterEdit: (on) => { setAfterEdit(on); saveFlag(AFTER_KEY, on); },
    showOnPart: store.display.value.issues, onShowOnPart: (on) => store.setDisplay('issues', on),
    report: last && profile && last.report.profile.id === profile.id ? last.report : null,
    stale, running,
    onRun: async () => {
      if (!profile || !settings || running) return;
      setRunning(true);
      try {
        const r = await controller.checkProfile(settingsToInline(profile, settings));
        if (r) setLast({ report: r.report, revision: r.revision, name: profile.name });
      } finally { setRunning(false); }
    },
    onSelect: (issue: Issue) => {
      const target = issueTarget(issue);
      if (!target.names.length) return;
      store.mode.value = target.mode;
      store.select(target.names);
      getViewport()?.frameNames(issueNames(issue));
    },
    onHover: (issue) => getViewport()?.setIssueHover(issue && !stale ? issueNames(issue) : []),
  };

  const chip: StatusItem | null = useMemo(() => {
    if (!last) return null;
    const c = chipParts(last.name, last.report);
    const parts = [c.errors ? plural('error', c.errors) : '', c.warnings ? plural('warn', c.warnings) : '', c.infos ? plural('info', c.infos) : ''].filter(Boolean);
    return {
      label: last.name + ':', value: parts.join(', ') || t('check.clean.chip'), tone: stale ? undefined : chipTone(c),
      onClick: openPanel, title: t('check.chip.title'), icon: 'design-check', dim: stale,
    };
  }, [last, stale]);

  return { props, chip, badge: last && !stale ? last.report.summary.errors : 0 };
}
