# Documentation Media Pipeline

This pipeline generates Lustra's documentation screenshots and finished export examples. It runs independently from the ordinary `e2e/` tests and uses an isolated Playwright context for each language.

## Layout

- `fixtures/`: approved public demo photos with fixed filenames.
- `scenes/`: Playwright UI flows and screenshot assertions.
- `helpers/`: PNG inspection, decoration geometry, hashes, and report generation.
- `playwright.config.ts`: Chromium, 1440 × 900 CSS px, 2× scale, locale, timezone, light theme, reduced motion, one worker, one retry.
- `docs/assets/screenshots/{ja,en}/`: reviewed screenshots.
- `docs/assets/examples/`: nine finished PNG exports from Rust's production macOS renderer.
- `.media-tmp/`: lock, traces, staging area, manifest, and HTML review report; ignored by Git.

## Requirements

Install the lockfile-pinned project dependencies and matching browser:

```sh
bun install --frozen-lockfile
bunx playwright install chromium
```

Install ExifTool 13.55 or compatible for privacy checks and metadata writing. All runs require the project's Rust toolchain; the media-only Cargo feature pins oxipng 10.2.1 (MIT) for deterministic lossless optimization without adding it to ordinary application builds. Native export examples additionally require macOS and Xcode command-line tools because the production renderer uses CoreGraphics/CoreText/ImageIO. This limitation matters for a future Ubuntu GitHub Actions workflow: those jobs cannot run the native example command without changing the runner or renderer architecture.

## Demo photos and privacy

The four approved photos belong in `fixtures/`: `aviation.jpg`, `jellyfish.jpg`, `alley.jpg`, and `illumination.jpg`. Do not download replacements, use AI images, or mix these with test fixtures. The checked-in copies are resized to a 3000 px long edge; source originals are not modified.

GPS, serial numbers, personal identifiers, software history, and original capture dates have been removed. Each image has a fixed synthetic 2025 date in Asia/Tokyo. Camera, lens, focal length, aperture, shutter speed, and ISO remain when present. The camera correction UI demonstrates an exact rule that changes `NIKON CORPORATION NIKON Z 6_2` to `Nikon Z6 II`. The native examples preserve the synthetic date and exposure metadata, remove GPS and serial information, and apply the `Nikon Z6 II` camera override. The CLI checks these privacy constraints before publishing generated assets.

## Commands

```sh
bun run media -- --help
bun run media                         # all 33 images
bun run media:screenshots             # both languages
bun run media:screenshots:ja          # Japanese only
bun run media:screenshots:en          # English only
bun run media:examples                # nine native Rust exports
bun run media:screenshots:ja -- --scene portrait-card
bun run media:screenshots:en -- --scene crop-and-rotate
```

The language allowlist is `both`, `ja`, or `en`. The scene allowlist is `all`, `hero`, `frame-styles`, `ambient-gradient`, `edge-stretch`, `portrait-card`, `crop-and-rotate`, `custom-color`, `metadata`, `import`, `review`, `export`, and `metadata-corrections`. Unknown flags and values fail with a specific error. A lock prevents overlapping pipeline runs. All selected outputs are staged, decoded, checked for dimensions and privacy metadata, and only then copied into the public assets directory; failures leave prior assets in place.

## Adding a scene

Add a scenario identifier to the allowlist and implement it in `scenes/media.spec.ts`. Use actual UI interactions and assert the intended state before capturing. Wait for `document.fonts.ready` and decoded images; do not add fixed sleeps. Full-window captures receive the macOS-style transparent outer frame. The frame-style locator capture remains undecorated. Avoid introducing screenshot-only behavior into production application code.

The Export scene installs a small in-memory Tauri bridge in the Playwright page for read-only export capabilities and demo preferences, allowing the real export settings UI to render in Chromium. It does not invoke the export operation. Finished export examples are generated separately by the production Rust renderer.

## Decoration, validation, and reports

`helpers/media.ts` calculates 2× titlebar, outer margin, corner radius, and shadow bounds. The Rust media helper applies oxipng preset 2 to each staged image without palette reduction or alpha alteration; it preserves PNG chunks such as alpha and ICC profiles. It runs before privacy validation and publication. The manifest and offline HTML report record each image's byte size before and after optimization plus total bytes saved. They also record tool versions, per-image success/failure, errors, and warnings. The PNG validator fully decodes images, checks plausible dimensions, rejects uniformly blank or fully transparent images, validates transparency on decorated screenshots, and records SHA-256. ExifTool scans every embedded metadata tag in both fixtures and generated images against a small allowlist, including synthetic-only dates and expected camera correction values. This rejects GPS, serials, software/history, personal identifiers, and unexpected tags. The CLI creates `.media-tmp/latest-report/manifest.json` and `report.html` with local image copies, hashes, dimensions, sizes, added/changed status, and before/after image comparisons. Failed runs retain an offline diagnostic report while leaving published images untouched.

PNG output is lossless and keeps alpha for decorated windows. Screenshots are generated by Chromium; export examples are rendered by Rust and only then receive approved EXIF metadata. Human visual review is still necessary before committing refreshed assets.

## Troubleshooting

- Missing photo errors list expected fixture filenames.
- If `.media-tmp/pipeline.lock` remains after a crashed process, confirm no generator is running and then remove that file.
- If Playwright cannot start Chromium, install the browser build with `bunx playwright install chromium`.
- If `media:examples` says the renderer is unavailable, run it on macOS; the application has no Linux-native export backend.
- Generated traces and reports remain under ignored `.media-tmp/`; do not stage that directory.

## GitHub Actions

The `Documentation Media Pipeline` workflow is a manual `workflow_dispatch` workflow restricted to `main`. Choose `all`, `screenshots`, or `examples`; screenshot requests can select `both`, `ja`, or `en` and one scene. When generating examples, leave language at `both` and scene at `all`. Contradictory values fail before generation. Ordinary pushes, pull requests, and releases do not trigger media generation.

Screenshot generation and artifact processing run on `ubuntu-24.04`. The nine finished examples run on `macos-15` because the production Rust renderer links CoreGraphics, CoreText, and ImageIO. The engine is not reimplemented for Linux. All generation jobs use isolated checkouts and do not receive the Lustra Bot key. The Linux screenshot jobs and native renderer are independent; the workflow only proceeds to review when every job required by the selected media type succeeds.

The assembled artifact is named `documentation-media-<run-id>-<attempt>`, is retained for 30 days, and contains the PNGs, SHA-256 manifest, offline HTML report, and before/after comparisons. Open the workflow run's Summary and download this artifact to inspect the report locally. Generation failures may also publish a short-lived diagnostics artifact without media credentials.

When generated images differ from `main`, the `create-pr` job pauses at the `documentation-media` Environment. Review and approve the deployment only after inspecting the artifact and report. The environment must require the configured reviewer and contain `LUSTRA_BOT_CLIENT_ID` as a variable and `LUSTRA_BOT_PRIVATE_KEY` as a secret. Approval authorizes only the verified artifact from that run. The job rechecks artifact hashes, allowed paths, and the `main` SHA before it requests a short-lived repository-scoped Lustra Bot token. That token can write contents and pull requests, and exists only in the approval job.

After approval, Lustra Bot creates one commit on `docs/update-media-<run-id>` and opens a PR against `main`. The PR embeds before/after comparisons and the workflow artifact link. Existing required CI runs on the image-only PR; the workflow never merges it. Use manual Squash and merge after reviewing the images, PR diff, and CI result. If `main` moves while approval is pending, the run stops and asks for a fresh generation. If no images changed, the workflow skips Environment approval and PR creation.

The repository's current required `validate` workflow has no path filter, so image-only PRs trigger its existing checks. Environment approval, App token issuance, push, and PR creation can only be exercised by a `workflow_dispatch` on `main`; they are not executed from pull request branches.

## Troubleshooting

- If a dispatch is rejected, select the `main` branch and use only the listed media type, language, and scene values.
- If example rendering fails on Ubuntu, check that the workflow still uses its dedicated `macos-15` job; the production export backend is Apple-framework based.
- A missing or inaccessible GitHub Environment setting prevents the PR job from obtaining the App key. Restore the `documentation-media` reviewer and its configured variable/secret; do not replace the approval with a repository secret.
- If review approval is followed by a `main` SHA mismatch, run the workflow again against the new `main` head.
- If an App token or push fails, the 30-day reviewed artifact remains available for diagnosis; no PAT or `GITHUB_TOKEN` write fallback is used.
- If a PR already exists for the same run, the workflow reports that PR and does not create a duplicate or rewrite its branch.

## Known limits

- GitHub's manual approval, App installation, and PR creation require a post-merge dispatch to verify end-to-end.
- Export examples run on macOS to preserve the real native renderer; an all-Ubuntu runner cannot execute them with the current application architecture.
- Generated media still needs human visual review; passing structural and privacy checks does not guarantee composition quality.
