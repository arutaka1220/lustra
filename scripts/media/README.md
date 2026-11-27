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

GitHub Actions orchestration and Lustra Bot approval/PR automation are Phase 2 and are intentionally not included in this Phase 1 implementation. Review local output and its HTML report before staging generated PNGs.
