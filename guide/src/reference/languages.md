# Languages

This chapter covers which languages the app supports, how to change the language, and what stays in English whatever you choose.

## What is supported today

The app ships in English only. English is also the fallback: if text is missing in another language, the English text shows.

The app is built so that another language is one more translation file with no change to the program itself. A partial translation is allowed, and anything not yet translated appears in English.

## Change the language

1. Open **Settings**: click the gear icon at the right of the top bar, or run **Workspace settings** from command search (**F**).
2. On the **General** tab, find **Language**.
3. Choose a language from the list.

The choice is remembered on this device.

The **Language** list appears only when the app has more than one language to offer. With English alone, there is nothing to choose, so the list is not shown. Development builds also offer a pseudo-language used for testing, which wraps English text in markers. It is not a real language.

## What is translated

The interface text: ribbon tabs and buttons, command names, menus, dialogs, settings, tooltips and messages. Plural wording follows the rules of the chosen language. Numbers and units are formatted by the browser's own number handling and the app's unit settings, not by the translation file.

## What is never translated

- **Your own names.** Part names, feature names, sketch labels and body names stay as you typed them.
- **Messages from the geometry kernel.** Error and hint text for failed features, for example a message saying a feature is still referenced by another, is English text built by the kernel layer. The app does not yet map the kernel's error codes to translated messages.
- **Agent and script tooling.** The text of the MCP server and its guides stays in English. See [Agents and the MCP server](../automation/mcp.md).

Right-to-left layout is not supported yet.

## Next

- [Units and settings](../getting-started/settings.md)
- [Troubleshooting](troubleshooting.md)
- [Limits and known gaps](limits.md)
