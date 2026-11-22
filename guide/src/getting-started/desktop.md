# The desktop app

CivilKit CAD is available as a native desktop app for **macOS**, **Windows**, and **Linux**. It is the same program as in the browser, in its own window, with the native Rust kernel built in. It works offline, and your parts stay on your computer.

Download the installer for your system from the Releases page of the project:

- **macOS:** `.dmg` (`aarch64` for Apple silicon M1 and later; `x64` for Intel Macs). Open it and drag **CivilKit CAD** to Applications.
- **Windows:** `.msi` (Windows Installer) or `.exe` (NSIS installer, supports per-user or machine-wide installation). Requires WebView2 (pre-installed on Windows 11 and modern Windows 10).
- **Linux:** `.AppImage` (portable, works across distributions: `chmod +x CivilKit*.AppImage && ./CivilKit*.AppImage`) or `.deb` (Debian/Ubuntu: `sudo apt install ./civilkit-cad_*.deb`).

## First start (unsigned builds)

The desktop builds are not code-signed yet, so your operating system may ask you to confirm on the first launch:

- **macOS:**
  1. Open the app. macOS says it cannot check it or that it is blocked.
  2. Open **System Settings > Privacy & Security**, scroll to the message about CivilKit CAD, choose **Open Anyway**, and confirm.
  3. From a terminal you can instead remove the quarantine mark: `xattr -dr com.apple.quarantine "/Applications/CivilKit CAD.app"`.
  (On older macOS versions, right-clicking or Control-clicking the app and choosing **Open** also works.)
- **Windows:** If Windows Defender SmartScreen shows "Windows protected your PC", click **More info** and then **Run anyway**.
- **Linux:** For the `.AppImage`, mark it executable (`chmod +x`) or allow executing as a program in your file manager's Properties dialog.

## What is different from the browser

- **Embedded native kernel:** The desktop app embeds the native Rust kernel locally (over loopback with a per-launch random token) instead of relying only on browser WebAssembly.
- **Native file dialogs:** **Export** and **Save a copy** open the system Save dialog. **Open** and **File > Open Part File** use the system file picker.
- **File associations:** Double-clicking a `.ckpart` or `.ckpart.gz` file opens it in the app on macOS, Windows, and Linux.
- **Send to Slicer:** The Print Plate dialog can detect installed slicers (Bambu Studio, OrcaSlicer, PrusaSlicer, UltiMaker Cura) and launch them directly with your exported plate.
- **Updates:** The app does not update itself; download the new version from Releases to update. The version is shown at the bottom of **Settings**.
- **Privacy:** Online libraries (Poly Haven textures and environments) stay off until you turn on **Use online libraries**; the app contacts only Poly Haven for that.
- **Browser install (PWA):** You can still use the **Install** button in your browser's address bar on any platform to install CivilKit CAD directly from the web page.
