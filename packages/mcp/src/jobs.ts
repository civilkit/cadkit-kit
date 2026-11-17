// Bounded jobs: a long operation (opening a big file, a recipe, a batch of checks) starts, returns a job id at once, and is asked about with a
// small status call. A finished job has one answer shape; a failed validation is never reported as success; cancelling and failing are explicit.
// The runner is plain TypeScript with no bridge in it: the tool layer gives it the work as a function.
import type { ResultStore } from '@kit/agent-tools';
import { BridgeError } from '@kit/agent-link';

export type JobState = 'running' | 'done' | 'failed' | 'cancelled';
/** What the work reports when it finishes. */
export interface JobOutcome {
  revision: number | null;
  changedCount: number;
  errorCount: number;
  warningCount: number;
  /** The full report: kept behind a handle (`reportUri`). */
  report: unknown;
  /** A picture of the result (base64 PNG), kept behind a handle when there is one (`previewUri`). */
  previewPng?: string | null;
  /** True when the work was answered from its cache: nothing ran. */
  cached?: boolean;
}
export interface JobResult { ok: boolean; revision: number | null; changedCount: number; errorCount: number; warningCount: number; reportUri: string; previewUri?: string; cached?: boolean }
export interface JobFailure { code: string; message: string; hint?: string }
export interface JobInfo {
  jobId: string; kind: string; state: JobState; elapsedMs: number;
  progress?: { done: number; total: number; step?: string };
  result?: JobResult; error?: JobFailure;
  /** After a cancel: the work that was already running finished anyway; what it came to (the job stays cancelled and its result is not used). */
  lateResult?: { ok: boolean; note: string };
  note?: string;
}
export interface JobContext { signal: AbortSignal; progress(done: number, total: number, step?: string): void }

interface Job { id: string; kind: string; state: JobState; startedAt: number; endedAt: number | null; progress?: JobInfo['progress']; result?: JobResult; error?: JobFailure; late?: JobInfo['lateResult']; ctl: AbortController }

const MAX_RUNNING = 4;
const MAX_KEPT = 50;

export class JobRunner {
  private jobs = new Map<string, Job>();
  private seq = 0;
  constructor(private readonly o: { store: ResultStore; now?: () => number }) {}
  private now(): number { return (this.o.now ?? Date.now)(); }

  /** Start `work` in the background. Throws `too_many_jobs` when four are already running. */
  start(kind: string, work: (c: JobContext) => Promise<JobOutcome>): JobInfo {
    if ([...this.jobs.values()].filter((j) => j.state === 'running').length >= MAX_RUNNING) throw new BridgeError('too_many_jobs', `${MAX_RUNNING} jobs are already running`, 'wait for one to finish (app_job_status) or cancel it (app_job_cancel)');
    const job: Job = { id: `j${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, state: 'running', startedAt: this.now(), endedAt: null, ctl: new AbortController() };
    this.jobs.set(job.id, job);
    while (this.jobs.size > MAX_KEPT) { const old = [...this.jobs.values()].find((j) => j.state !== 'running'); if (!old) break; this.jobs.delete(old.id); }
    const ctx: JobContext = { signal: job.ctl.signal, progress: (done, total, step) => { if (job.state === 'running') job.progress = { done, total, ...(step ? { step } : {}) }; } };
    void (async () => {
      let out: JobOutcome | null = null, err: JobFailure | null = null;
      try { out = await work(ctx); }
      catch (e) { const x = e as { code?: string; message?: string; hint?: string }; err = { code: x.code ?? 'job_failed', message: String(x.message ?? e), ...(x.hint ? { hint: x.hint } : {}) }; }
      if (job.state === 'cancelled') {         // cancelled while it ran: it is not used, but what it came to is said
        job.late = out ? { ok: out.errorCount === 0, note: 'the work finished after the job was cancelled; its result was discarded (the app may have changed: check app_state)' } : { ok: false, note: `the work ended after the job was cancelled: ${err!.message}` };
        return;
      }
      job.endedAt = this.now();
      if (err) { job.state = 'failed'; job.error = err; return; }
      job.state = 'done';
      const o = out!;
      const reportUri = `ck://result/${this.o.store.put(o.report, JSON.stringify(o.report, null, 1) ?? 'null')}`;
      const previewUri = o.previewPng ? `ck://result/${this.o.store.put({ mimeType: 'image/png', encoding: 'base64', data: o.previewPng }, JSON.stringify({ mimeType: 'image/png', encoding: 'base64', data: o.previewPng }))}` : undefined;
      // a validation that failed is a failure: ok means no errors, whatever else happened
      job.result = { ok: o.errorCount === 0, revision: o.revision, changedCount: o.changedCount, errorCount: o.errorCount, warningCount: o.warningCount, reportUri, ...(previewUri ? { previewUri } : {}), ...(o.cached ? { cached: true } : {}) };
    })();
    return this.info(job);
  }

  status(id: string): JobInfo | null { const j = this.jobs.get(id); return j ? this.info(j) : null; }
  list(): JobInfo[] { return [...this.jobs.values()].map((j) => this.info(j)); }

  /** Stop waiting for a job. Work already sent to the app cannot be recalled: if it finishes it is reported as `lateResult`. */
  cancel(id: string): JobInfo | null {
    const j = this.jobs.get(id);
    if (!j) return null;
    if (j.state === 'running') { j.state = 'cancelled'; j.endedAt = this.now(); j.ctl.abort(); }
    return this.info(j, j.state === 'cancelled' ? 'cancelled; work already sent to the app may still finish (see lateResult in app_job_status), so check app_state' : undefined);
  }

  private info(j: Job, note?: string): JobInfo {
    return { jobId: j.id, kind: j.kind, state: j.state, elapsedMs: (j.endedAt ?? this.now()) - j.startedAt, ...(j.progress && j.state === 'running' ? { progress: j.progress } : {}), ...(j.result ? { result: j.result } : {}), ...(j.error ? { error: j.error } : {}), ...(j.late ? { lateResult: j.late } : {}), ...(note ? { note } : {}) };
  }
}
