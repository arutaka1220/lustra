# Export renderer baseline

Phase 1 records the behavior of the renderer that ships before the Rust core migration. This document is the comparison contract for later renderer work.

## Current implementation

The export command and batch lifecycle live in `src-tauri/src/export.rs`. They own destination grants, single-run registration, progress, cancellation, collision-safe output creation, cleanup, and retry results. Shared layout calculations also live there. `src-tauri/src/export/metadata.rs` parses and attaches EXIF/XMP metadata.

Pixel rendering is macOS-only: `src-tauri/src/export/macos.rs` calls the Objective-C implementation in `src-tauri/src/export/macos.m`. It uses CoreGraphics, CoreText, ImageIO, and optionally statically linked libwebp/sharpyuv discovered by `build.rs`. Other targets report that export is unavailable. The renderer has no independent core crate today.

### Existing output surface

- Formats: JPEG, PNG, WebP; quality is passed to JPEG/WebP encoding.
- Sizes: Original and short-edge 720 / 1080 / 1440 / 2160.
- Layouts: Standard and Portrait Card; percentage padding; None preserves the source canvas.
- Frame styles: None, Black, White, Soft White, Soft Black, Custom, Blurred, Ambient Gradient, Edge Stretch.
- Image transforms: crop and rotation; source files are opened read-only.
- Overlays: text with font family, weight, anchors, photo-relative placement, color, opacity and metadata-driven values.
- Rendering effects: inset, shadow, blur, brightness/opacity, ambient color sampling and edge stretch.
- Metadata: category-filtered EXIF/XMP, GPS and serial controls, corrections, and sRGB/original color-space options.
- Batch behavior: asynchronous jobs, progress, cancellation policy, collision-safe names, partial success and retry support are handled by Tauri-facing code.

The frontend preview is implemented separately in TypeScript/Canvas/Pixi paths. Similarity is expected for geometry, colors, text placement and effects; raster antialiasing and interpolation may differ.

## Reproducible renderer samples

The developer CLI uses the production renderer and emits nine PNGs, one for each frame style plus Portrait Card:

```sh
cargo run --manifest-path src-tauri/Cargo.toml --bin documentation-media-examples -- \
  scripts/media/fixtures/jellyfish.jpg /tmp/lustra-export-baseline
```

The input is the repository's documentation sample, not a user's photo. The generated images are intentionally kept outside the repository; attach them to a CI artifact or review bundle when comparing a later renderer. The generator currently covers frame styles and Portrait Card but does not cover text, metadata, crop, ICC, or encoder quality; those require dedicated fixtures in the next implementation phase.

For an individual case with explicit format, size, metadata, crop, and text settings, use the developer-only `export-renderer-baseline-case` binary. Pass a job JSON and export settings JSON so the saved artifact can be recreated exactly:

```sh
cargo run --release --manifest-path src-tauri/Cargo.toml \
  --bin export-renderer-baseline-case -- \
  scripts/media/fixtures/jellyfish.jpg /tmp/job.json /tmp/settings.json /tmp/baseline.png [count]
```

The optional count renders the same input repeatedly within one process into a directory, for measuring the renderer loop at 10/30/100 items. A directory may be passed as the source; supported image files in that directory are sorted by name and cycled through the requested count. The binary calls the same renderer and metadata filtering path as batch export. It is test tooling only; it does not add a user-facing CLI product surface.

The repository fixture `src-tauri/tests/fixtures/export-renderer-baseline/text-crop.json` exercises a rotated crop, blurred background, inset/shadow, mixed Japanese/English text, two anchors, font weights, opacity, and photo-relative placement. Pair it with `png-1440-srgb.json` and the documented `jellyfish.jpg` source to regenerate this case. The current baseline uses the local system's Arial and fallback fonts; cross-OS typography comparisons must use an identical redistributable font file and record its checksum.

To reproduce the local 24 MP / 45 MP measurements on macOS, use the repeatable wrapper. It builds the release CLIs, scales the chosen source and three repository documentation photos into temporary JPEG inputs, records environment and checksums, and stores per-run `time -l` logs and rendered outputs at the destination. It measures frame variants and text/crop PNG at 1440 px, Original-size JPEG/PNG/WebP from `plain-black.json`, and same-source plus mixed-source loops at 10/30/100:

```sh
scripts/export-renderer-baseline.sh \
  scripts/media/fixtures/jellyfish.jpg /tmp/lustra-export-baseline 5
```

Run it from any working directory. The script requires macOS, `sips`, Rust/Cargo, and a repository checkout; no generated images are added to Git.

Record alongside every comparison: git SHA, OS/version, CPU architecture, Rust toolchain, input SHA-256, JSON job settings, selected font file and SHA-256, output format/quality/size, wall time, peak resident memory, and output byte size. Compare dimensions and geometry exactly; compare pixels/SSIM for raster output, and inspect metadata separately. Do not use encoded file hashes as an image-quality metric.

## Measurement protocol

For an apples-to-apples baseline, use the same generated 24 MP and 45 MP source images, same job JSON and output settings for both implementations. Warm up once, then run at least five measured iterations per case and report median and range. Measure single-image cases first, then batches of 10, 30 and 100; record wall time, peak RSS, CPU utilization and output bytes. Include JPEG/PNG/WebP, Original and short-edge sizes, plain frame, blur background and text overlay. Preserve all raw measurements and machine details with the comparison artifact. Do not compare across different hardware as a performance regression.

## Measurements available at Phase 1

An initial local baseline was collected on 2026-11-29. Environment: macOS 26.6.2 (Darwin 25.6.0), Apple M2, 16 GiB RAM, arm64, Rust 1.93.1, release build from commit `8808834`. The source was `scripts/media/fixtures/jellyfish.jpg` (3000 × 1996, SHA-256 `d8d595e1c43e12e691434297b11e3bd92c14191a365af1e913defee7a8f264d0`). `sips` produced temporary JPEG inputs at 6000 × 4000 (24 MP) and 7500 × 6000 (45 MP); their hashes and outputs were kept under `/tmp/lustra-renderer-baseline-2026-11-29`, not committed.

Each measured invocation ran the production `documentation-media-examples` CLI once, producing nine PNGs (the eight Standard frame styles plus Portrait Card) at the CLI's fixed short edge of 1440 px. A second case used the text/crop JSON fixture and the explicit-settings baseline CLI at a 1440 px short edge. A release build and one warm-up per case were completed before timing. Five invocations per input were timed with `/usr/bin/time -l`; values below are wall time, with maximum RSS and output bytes from a measured run:

| Input | Runs | Wall time (median, range) | Maximum RSS (range) | PNG output bytes (run 5) |
|---|---:|---:|---:|---:|
| 24 MP | 5 | 1.29 s (1.22–1.34 s) | 149,209,088–151,420,928 bytes | 21,688,320 |
| 45 MP | 5 | 1.18 s (1.17–1.22 s) | 127,369,216–129,155,072 bytes | 18,456,576 |

The separate text/crop case measures one PNG export with a blurred background, inset and shadow, rotated crop, and two text overlays including Japanese fallback:

| Input | Runs | Wall time (median, range) | Maximum RSS (range) | PNG output bytes |
|---|---:|---:|---:|---:|
| 24 MP | 5 | 0.21 s (0.21–0.22 s) | 100,384,768–100,548,608 bytes | 2,620,365 |
| 45 MP | 5 | 0.21 s (0.21–0.21 s) | 79,233,024–79,265,792 bytes | 2,203,589 |

Original-size measurements use `plain-black.json` (12% padding, no crop or text), quality 90, and sRGB. Output dimensions include padding:

| Input | Format | Output dimensions | Wall time median (range) | Maximum RSS range | Output bytes |
|---|---|---:|---:|---:|---:|
| 24 MP | JPEG | 7895 × 5264 | 0.35 s (0.35–0.37 s) | 576,552,960–576,585,728 bytes | 3,081,553 |
| 24 MP | PNG | 7895 × 5264 | 1.03 s (1.02–1.05 s) | 618,872,832–618,954,752 bytes | 23,505,324 |
| 24 MP | WebP | 7895 × 5264 | 1.96 s (1.96–1.97 s) | 487,178,240 bytes | 774,522 |
| 45 MP | JPEG | 9869 × 7895 | 0.61 s (0.61–0.61 s) | 1,061,863,424–1,061,879,808 bytes | 5,124,766 |
| 45 MP | PNG | 9869 × 7895 | 1.82 s (1.81–1.82 s) | 1,130,512,384–1,130,561,536 bytes | 38,726,429 |
| 45 MP | WebP | 9869 × 7895 | 3.59 s (3.59–3.60 s) | 892,895,232–892,911,616 bytes | 1,266,842 |

Repeated-render batches use the mixed Japanese/English text/crop case at a 1440 px short edge. Each item repeats the same source and settings in one process; this measures renderer throughput and memory reuse, not Tauri scheduling, IPC progress events, cancellation, or varied-source decode behavior.

| Input | Items | Wall time median (range) | Median per item | Maximum RSS range | Output bytes per run |
|---|---:|---:|---:|---:|---:|
| 24 MP | 10 | 1.70 s (1.69–1.73 s) | 170.0 ms | 194,691,072–194,756,608 bytes | 26,203,650 |
| 24 MP | 30 | 4.98 s (4.96–5.01 s) | 166.0 ms | 257,703,936–257,785,856 bytes | 78,610,950 |
| 24 MP | 100 | 16.68 s (16.54–16.71 s) | 166.8 ms | 257,736,704–257,884,160 bytes | 262,036,500 |
| 45 MP | 10 | 1.69 s (1.69–1.72 s) | 169.0 ms | 159,875,072–160,006,144 bytes | 22,035,890 |
| 45 MP | 30 | 4.95 s (4.93–4.95 s) | 165.0 ms | 213,549,056–213,647,360 bytes | 66,107,670 |
| 45 MP | 100 | 16.33 s (16.29–16.35 s) | 163.3 ms | 213,925,888–215,384,064 bytes | 220,358,900 |

Mixed-source batches cycle through four files: 24 MP jellyfish, aviation and illumination images, plus a 45 MP alley image. This samples repeated decode across several paths and image contents; it is not a 100-unique-photo workload.

| Items | Wall time median (range) | Median per item | Maximum RSS range | Output bytes per run |
|---:|---:|---:|---:|---:|
| 10 | 1.72 s (1.71–1.72 s) | 172.0 ms | 195,166,208–195,215,360 bytes | 26,055,957 |
| 30 | 5.02 s (5.02–5.03 s) | 167.3 ms | 256,475,136–256,540,672 bytes | 78,636,207 |
| 100 | 16.68 s (16.67–16.75 s) | 166.8 ms | 256,573,440–257,032,192 bytes | 262,901,250 |

An on-disk metadata smoke comparison also used a temporary copy of `test_exif_01.jpg`, with fictional camera/lens/date/exposure/GPS values written into that copy. JPEG, PNG, and WebP outputs all retained the selected corrected model/lens, exposure, ISO, and date fields; GPS fields were absent with `keepGps=false`. ExifTool read each actual output file. The source copy's SHA-256 was identical before and after rendering. This fixture did not contain a serial-number tag, so serial deletion is covered by the existing synthetic Rust test rather than claimed by this file-level check.

These numbers are a renderer baseline, not a full application throughput matrix: metadata retention sweeps, encoder quality sweeps, 100 unique photos, and Tauri-level progress/cancellation are not covered. The fixed-short-edge cases should not be compared as evidence that larger input is faster; they use distinct source dimensions and the outputs are scaled to 1440 px. Original-size cases show a substantial peak-RSS range and are specific to this Apple M2/macOS environment. The native renderer can only be measured on macOS with the current code.

## Known compatibility boundary

Windows is an existing Tauri build target but its current export backend returns unavailable. Linux desktop packaging is outside the current support surface. macOS output is therefore the only current renderer baseline; cross-OS output comparison begins only after the common renderer exists.
