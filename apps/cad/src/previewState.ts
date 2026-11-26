// Whether an editor preview is in flight (the kernel is still answering): the editor shows a "checking" state instead of the last answer.
import { signal } from '@preact/signals-core';
export const previewChecking = signal(false);
