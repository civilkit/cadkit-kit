# Install as an app and work offline

This chapter covers installing CivilKit CAD as an app in its own window, using it without a network, how updates arrive, and what the app keeps on your device.

CivilKit CAD runs in the browser. After the first visit it can also start without a network, because the app files are saved on your device. Installing it is optional and only changes how it looks and starts.

## Install it

Browsers that support installing a site offer it once the site qualifies (it is served over https and has its app files saved). When the app is installable, an **Install** button appears in the top bar. Its tooltip reads "Install CivilKit CAD as an app: its own window, and it opens without the browser."

1. Choose **Install** in the top bar.
2. Confirm in the browser's own install dialog.
3. CivilKit CAD opens in its own window, and it gets an icon you can start from like any other app.

Notes:

- The button shows only in browsers that offer installation, and only while the app is not already installed. If you do not see it, look for an install option in your browser's menu or address bar.
- Some browsers do not send the install offer the **Install** button depends on. There, use the browser's own menu if it has an install or add-to-home-screen option.
- The installed app has the name "CivilKit CAD" and runs in a standalone window without the browser's address bar.
- Uninstall it from your browser's app list or your system's app list. Your saved parts are files on your computer and are not removed.

## Work offline

The first time you open the app with a network, it saves the app files on your device: the page, the program, the geometry kernel and the icons. After that:

- The app starts without a network. If you open the page address with no connection, the saved copy loads.
- Everything that runs in the browser works: sketching, modelling, saving to your computer, importing and exporting files.
- Samples you opened before are available. A sample you have never opened is fetched when you first pick it, so it needs a network the first time.
- Library parts are available offline only after you installed them or dropped them once. See [The library and samples](../library/library.md).
- The local kernel service and the MCP server work on your own computer and do not need the internet either. See [The local kernel service](../automation/local-kernel.md).

On a phone or tablet the geometry kernel (about 7 MB) is not saved when the app is installed, so the first load stays light; it is saved the first time the app starts the kernel, which happens as soon as you open or build a part. Open a part once while online before you rely on offline use there.

To be sure it works offline, open the app once while online and wait for it to finish loading.

## Updates

When a new version is published:

- The app checks about every five minutes, and whenever you return to its tab. If it finds a newer version, a notice appears in the top bar: "A new version is available." with **Refresh** and **Later**.
- **Refresh** reloads the app. If your part has unsaved changes, the app asks first what to do with them. **Later** dismisses the notice for now.
- Without a network, the check quietly waits until the next try.
- On the next load the app fetches the page from the network first and falls back to the saved copy. A deployed update is therefore picked up on your next online visit. The program files themselves have fixed names tied to their content, so an old copy never mixes with a new one. Older saved copies are removed automatically.

Files saved by earlier versions still open in newer ones.

## What is stored on your device

All of this stays in your browser's storage for this site. The app has no account and no cloud storage. Your parts go to a file only when you save.

| What | Where | Why |
| --- | --- | --- |
| App files and the geometry kernel | Browser cache | Starting offline and starting quickly. |
| Autosave of the open part | Local storage | Restoring your work after a crash or a closed tab. Documents over about 3 MB of text are not autosaved. |
| Rolling snapshots of the open part | Browser database | Up to ten earlier states, taken at most every 30 seconds while you work, for **Recover earlier versions...**. |
| A saved picture of the model's view | Browser database | Shows a part before the kernel has rebuilt it. It is a cache and is rebuilt when stale. |
| Recent files and samples (names and thumbnails) | Local storage | The recent list in the Library picker. |
| Workspace settings, theme, language, navigation and sketch preferences | Local storage | Remembered between visits. |
| Libraries you added, installed library parts and licence confirmations | Local storage and browser database | See [The library and samples](../library/library.md). |
| Local kernel service address and access token | Local storage | Only if you use the service. |

Saving a part with **Save** or **Save as** writes a file to your computer. In browsers that support direct file access, **Save** can overwrite the same file. Otherwise the browser downloads a new copy each time. See [Saving and opening](../files/files.md).

### Clearing it

Clear this site's data in your browser's settings to remove everything above, including settings, libraries and the saved app files. That does not touch files you saved on your computer. Browsers may also clear a site's storage on their own when disk space runs low, or after a long time without a visit. Save your work to files, and do not rely on autosave or snapshots as the only copy.

Private or incognito windows may block storage. The app still runs, but your settings and autosave last only for that session.

## Next

- [Saving and opening](../files/files.md)
- [The library and samples](../library/library.md)
- [Troubleshooting](troubleshooting.md)
- [Limits and known gaps](limits.md)
