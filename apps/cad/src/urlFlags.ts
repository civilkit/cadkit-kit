// URL flags for automation. `?noprompt=1` turns off the browser's "Leave site?" question that is asked while any tab has unsaved
// content, so a browser driver can reload or navigate. Users keep the prompt: nothing sets the flag unless it is in the address.

/** True when the address carries `noprompt=1` (only the value 1 counts). */
export const noPrompt = (search: string): boolean => new URLSearchParams(search).get('noprompt') === '1';

/** Whether leaving the page should raise the browser's prompt. */
export const shouldWarnOnUnload = (dirty: boolean, search: string): boolean => dirty && !noPrompt(search);
