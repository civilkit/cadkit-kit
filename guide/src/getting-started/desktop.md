# The Mac app

CivilKit CAD is also available as a Mac app (Apple silicon and Intel). It is the same program as in the browser, in its own window. It works offline, and your parts stay on your computer.

Download the `.dmg` from the Releases page of the project: the `aarch64` file for Apple silicon (M1 and later), the `x64` file for Intel Macs. Open it and drag **CivilKit CAD** to Applications.

## The first start

The app is not signed with an Apple Developer ID yet, so macOS asks you to confirm it once:

1. Right-click (or Control-click) the app and choose **Open**, then **Open** again.
2. If macOS says the app is blocked, open **System Settings > Privacy & Security** and choose **Open Anyway**.
3. From a terminal you can instead remove the quarantine mark: `xattr -dr com.apple.quarantine "/Applications/CivilKit CAD.app"`.

## What is different from the browser

- **Export and Save a copy** open the system Save dialog. **Open** uses the system file dialog, and **File > Open Part File** does the same.
- Double-clicking a `.ckpart` file opens it in the app.
- The app does not update itself; download the new version to update. The version is at the bottom of **Settings**.
- Online libraries (Poly Haven textures and environments) stay off until you turn on **Use online libraries**; the app contacts only Poly Haven for that.

## Linux and Windows

There is no Linux or Windows app yet. Use the **Install** button in your browser's address bar to install CivilKit CAD as an app from the web page.
