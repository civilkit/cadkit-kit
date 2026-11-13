# Releasing

One product version, in one place: `version` in the root `package.json`. The kit app ships the kernel wasm it was built with, so a
release is the pair (kit, kernel). Versions are `MAJOR.MINOR.PATCH`: a new feature or a visible change raises MINOR, a fix PATCH, a
change that stops old files opening MAJOR. The document format has its own number (the `format` and `version` fields of a
`ck-part`), which only changes when files change shape; opening older files stays supported across versions.

## What users can see

- `version.json` next to the live app: `{ "version": "0.5.0", "kit": "<commit>", "kernel": "<kernel build>" }`, written by
  `npm run build:pages`.
- Settings (the gear), at the bottom of the dialog: "Version 0.5.0 (app <commit>, kernel <build>)".
- `CHANGELOG.md`: one section per release, dated, written for users. Add each user-visible change under **Unreleased** in the same
  commit that makes it. A release is exactly what is under Unreleased when you cut it. Write each entry as a bold title and one or two
  short sentences: what a user can now do or what changed. The What's new page shows only the title and the first sentence (about
  200 characters at most), so put the point first; detail belongs in the guide, not the changelog.

## Cutting a release

1. Check kit `main` is what you want to ship, with the kernel wasm you intend to publish (the one that passed its gate). Run the kit's tests against the kernel checkout you ship: the kit resolves the kernel's TypeScript packages (`@ck/*`) from `../rebuild`, which other sessions leave on any branch, so a stale one fails tests that are not broken (`sheetHints`, the skill `registry` test). Use `CK_REBUILD=<kernel checkout> npx vitest run`, or fast-forward `../rebuild` to the kernel main first.
1b. Rename the `Unreleased` key in `docs/whats-new/highlights.json` to the new version (commit it) BEFORE running the release script: the script does not do it, and a page generated without it shows the release with no highlights (this happened with 0.6.3 and needed a re-tag). Give the kernel tag a `--kernel-ref <hash>` of the commit the gated wasm was built from, since kernel main may have moved on.
2. `node tools/release.mjs minor --dry-run` shows the version, the number of entries and the notes it would write.
3. `node tools/release.mjs minor --kernel-repo /path/to/kernel-checkout` (or `patch`, `major`, or an explicit `X.Y.Z`):
   runs the i18n check, moves Unreleased under `## X.Y.Z - date`, bumps `package.json`, commits `Release X.Y.Z`, tags `vX.Y.Z`
   (the tag message holds the notes) and tags the kernel checkout's HEAD with the same `vX.Y.Z`. Nothing is pushed or deployed.
4. Push the tags to `ci`, build the pages (`PAGES_OUT=dist-pages-civilkit/cad WASM_SRC=<wasm> CK_REBUILD=<kernel> npm run build:pages`),
   smoke-test it (`node tools/pages_smoke.mjs dist-pages-civilkit/cad --profile <dir>`) and deploy as in `docs/pages-deploy.md`.
5. After the deploy, check `https://civilkit.io/cad/version.json` shows the new version.
6. Build the Mac app for the same release (every release ships it): from the tagged checkout run `WASM_SRC=<the same wasm> CK_REBUILD=<kernel> tools/desktop_build.sh` (see `docs/desktop.md`), check the `.dmg` and the `.app.zip` names carry the version, and add the arm64 and x64 files and `SHA256SUMS` to a draft GitHub release `desktop-vX.Y.Z`. Publishing the draft is a separate step for the owner.
7. Draft the r/civilkit post: `node tools/release_post.mjs X.Y.Z --out <dir>` (add `--mac` once the draft GitHub release of step 6 is published, and `--catchup <from>` for one post covering several versions), read it, and hand the text to the owner to post. The owner is the only moderator; never post it automatically.

## What's new clips

Each highlight in `docs/whats-new/highlights.json` can have a short looping clip. `node tools/clips/record.mjs --dir dist-pages-civilkit/cad --profile <scratch dir> [--only <id>]` records the clips of `tools/clips/NN-name.mjs` against a built pages app (headless Chrome at a device pixel ratio of 2, so retina: CDP screencast, ffmpeg with VP9 and H.264, 1920 px wide, at most 4 MB each; the encode of one clip takes a few minutes). The clip files (`apps/cad/public/whats-new/clips/`) are not committed: the build copies them into the deploy. The posters (`posters/<id>.png`, at most 120 KB) are committed. List clips made ahead of a release under the key "Unreleased" and rename the key when you cut the release. Look at every clip before it ships.

## Keeping the guide current

The guide (`guide/`, published at `/docs/cad/`) is checked at release time: build it (`mdbook build guide`) and read the Unreleased
entries against it. For each entry that adds or changes something a user does, the guide has a page or a paragraph, or the entry says
why not. Generated references (the script API from `registry.generated.json`, the command lists) are regenerated, never hand edited.

## Site chrome

Every static page of the suite (home, Calcs, CAD What's new, licences, the /docs/ index, the guides) uses one stylesheet, `https://civilkit.io/styles.css`,
and the same header and footer. The civilkit-site repo owns the stylesheet and the markup. This repo carries a copy of the header and footer in
`tools/pages/siteChrome.mjs` (used by `tools/make_whats_new.mjs`, the licences page and the /docs/ index), and the Calcs repo carries another. Change
the navigation in all three together, and deploy civilkit-site first: the pages here rely on the components it adds to `styles.css`. The guide
(`guide/civilkit.css`) and the kernel book use the same palette through an mdBook stylesheet override instead of the header.
