# Alerts

Every transient message (info, success, warning, error) goes through one service, `store.notify(text, level, action?)` (`packages/store/src/notifications.ts`). Nothing else draws a second copy of it.

- **Toast stack** (`packages/ui/src/Toast.tsx`): one column, fixed at the bottom right of the window above the status bar (full width above the bottom bar on a phone), never over the model centre, at most 420 px wide. Text wraps; past about three lines it collapses with Show more, which opens it in place. An error also has Copy. Every toast has a close button; Esc closes the newest (unless you are typing in a field).
- **Timing** (`noticeDuration`): info and success stay about 4 s plus 60 ms a character (at most 20 s; an action toast at least 8 s); warnings at least 20 s; errors at least 60 s. Hovering or focusing a toast holds its timer. An identical message while one is showing merges into it as a count and restarts the timer.
- **Levels**: `info`, `success`, `warning`, `error` (`warn` is accepted as `warning`). Errors are `role="alert"` (announced assertively), the rest `role="status"`. Reduced-motion drops the entrance animation.
- **Action**: `notify(text, level, { label, run })` adds a button (Undo, Show feature); running it closes the toast.
- **Status bar**: only an Alerts chip with the unread count, red while an unread one is an error. It never repeats the message text.
- **History** (`NotificationHistory.tsx`): the last 50 messages, newest first, with time, count and Copy; opened from the chip or More > Recent messages on a phone. Reading it marks everything read; Clear empties it.

Not alerts, and left where they are: validation text beside a field in an editor or wizard, the failure card (`DiagnosticsCard`) for a refused edit, the sketch hint line, canvas handle hints, and the update banner. They describe the thing you are editing, not an event.
