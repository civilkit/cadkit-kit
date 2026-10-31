# Clip recorder

Records the CAD app as a short video (CDP screencast frames, a visible pointer, WebM and MP4 encode).

Playwright is deliberately not a kit dependency: it is large, needs a browser download, and only this recorder uses it. Install it where you record, outside the kit tree, and point the scripts at it:

    mkdir -p ~/clip-tools && cd ~/clip-tools && npm init -y && npm i playwright && npx playwright install chromium
    ln -s ~/clip-tools/node_modules e2e/node_modules      # untracked
    tools/serve_local.sh --port 5192                      # serve a build, never a dev server
    node e2e/clips/record.mjs --url http://localhost:5192/ --out OUT --only pet-bottle

Needs `ffmpeg` on the path. Rendering uses the GPU (`--use-angle=metal`) by default; `CLIP_GL=swiftshader` forces software rendering (about 2 frames a second, choppy). `CLIP_TIMEOUT` (seconds) raises the per-clip limit; `CLIP_SHOTS=DIR` with `dry.mjs` writes screenshots instead of video.
