# Chat: ask for a change in words

The **Chat** panel lets you type a change ("40x40 plate with four countersunk M5 holes, R8 corners") and an assistant edits the part you have open. It uses the **Claude Code you already have on your computer**, under your own login and plan. There is no key to paste, no account with us, and no server of ours in between.

## Before you start

- **Claude Code**, installed and signed in (run `claude` once in a terminal and sign in).
- **The local service** from the CivilKit CAD source (see [Agents and the MCP server](mcp.md) for Node 22 and the kernel file). The service starts Claude Code for the chat and connects it to the part you have open. In the Mac app and on the web the service is the same one; the Mac app does not start it for you yet.

## Open it

1. Press the chat button in the top bar (or open the **Chat** tab of the left panel).
2. Without the service the panel shows the setup card. In a terminal run the command it shows, for example

   ```sh
   node <checkout>/packages/mcp/bin/ck-mcp.mjs --pair
   ```

   (on the hosted app it adds `--allow-origin` with the app's address). It prints a code like `52311-ABCD-EFGH-JKMN-PQRS`.
3. Paste the code in the panel and press **Link**. The link is the same **agent link** as in Settings; it is off again whenever the page closes.

## Use it

- Type a message and press **Send** (or Ctrl/Cmd+Enter). The reply streams in, and each thing the assistant does (looking at the part, taking a picture, running a script) appears as a line.
- **Stop** ends the turn at once. A script that is already running finishes, because a change is applied whole or not at all.
- **Model**: Sonnet (balanced, the default), Opus (most capable) or Haiku (fastest).
- **Tell it about**: **Selection** sends the names of what you have selected, **View** asks it to look at a picture of the part first, **Comments** sends the script saved with the part with its `//` comments. All three are off until you tick them.
- **Allow it to change this document** is the same box as in Settings, Agent link, and it is off every time the link starts. Without it the assistant can look and take pictures but not change anything. With it, each script, undo and redo it runs is **one undo step** and shows a notice, and Undo takes it back like any other step.
- **New chat** forgets the conversation; otherwise a follow-up message continues the same one.

The assistant adds features after the existing ones; it does not edit or delete features you made by hand (use Undo, or say what you want and do the edit yourself).

## What is sent

To Claude, through your Claude Code: your message, the boxes you ticked, and what the assistant's tools return: the part's features and variables, a picture of it when it takes one, and the scripts it writes. Claude Code keeps its own session files on your computer as it always does. Nothing is stored in your document and nothing goes to us.

## When something goes wrong

The panel says it in words and never loses your message: the service is not running or the link was lost (start it and paste a new code), Claude Code is not found or not signed in, you hit a usage limit, Claude is busy, another chat is already running, or the assistant reached its limit of 24 steps for one message (what it did so far is in the part; undo it or ask it to carry on).
