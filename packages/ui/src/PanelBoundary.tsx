import { Component, type ComponentChildren, type JSX } from 'preact';
import { t } from './i18n';

interface Props { children?: ComponentChildren; resetKey?: unknown; name?: string }
interface State { error: Error | null; key: unknown }

/**
 * Keeps one panel's drawing error inside that panel. Without it a throw in a label or a field formatter leaves the whole app at its last
 * drawn frame (a stale "Rebuilding model" overlay included); with it the panel says what failed, offers Retry, and the rest stays usable.
 * It clears itself when `resetKey` changes (another feature selected, the document changed).
 */
export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };
  static getDerivedStateFromError(error: unknown): Partial<State> { return { error: error instanceof Error ? error : new Error(String(error)) }; }
  static getDerivedStateFromProps(p: Props, s: State): Partial<State> | null { return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null; }
  componentDidCatch(error: unknown): void { try { console.error(`[panel ${this.props.name ?? ''}]`, error); } catch { /* no console */ } }
  render(): JSX.Element | ComponentChildren {
    const e = this.state.error;
    if (!e) return this.props.children;
    return (
      <div class="panel-error" role="alert" data-testid="panel-error" data-panel={this.props.name}>
        <span>{t('ui.panel.failed', { message: e.message })}</span>
        <button type="button" class="panel-error-retry" onClick={() => this.setState({ error: null })}>{t('ui.panel.retry')}</button>
      </div>
    );
  }
}
