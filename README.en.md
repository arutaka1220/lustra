# Lustra

**Give finished photos a frame and the details behind the shot.**

Lustra is a desktop app for adding frames, canvas padding, and EXIF-based text to edited photos, then exporting them in batches. Your source photos stay untouched; edits are saved in sessions.

[日本語 README](README.md) · [Download from GitHub Releases](https://github.com/arutaka1220/lustra/releases) · [Contributing](CONTRIBUTING.md)

![Lustra editor showing a jellyfish photo with an Ambient Gradient frame and camera information.](docs/assets/screenshots/en/hero.png)

## Import, edit, review, export

1. **Import** — Choose JPEG, PNG, or WebP photos and arrange their order.
2. **Edit** — Adjust frames, padding, Crop & Rotate, and photo information text.
3. **Review** — Check the finished photos in a gallery and return to edit any photo.
4. **Export** — Choose the format, resolution, and metadata to include, then save the batch.

The editor keeps your photos in a filmstrip. Apply settings across all photos or adjust one photo at a time, with Undo and Redo for your edits.

| Import | Edit | Review |
|---|---|---|
| ![Import Photos screen with four selected photos](docs/assets/screenshots/en/import.png) | ![Crop & Rotate editor](docs/assets/screenshots/en/crop-and-rotate.png) | ![Review Photos gallery](docs/assets/screenshots/en/review.png) |

## Frames and canvas layouts

Frames add a background or padding around a photo to shape the final canvas without stretching or cropping the source. Choose None, Black, White, Blurred, Soft Black, Soft White, Ambient Gradient, Edge Stretch, or Custom.

| White | Soft White | Black |
|---|---|---|
| ![White frame export example](docs/assets/examples/white.png) | ![Soft White frame export example](docs/assets/examples/soft-white.png) | ![Black frame export example](docs/assets/examples/black.png) |
| Soft Black | Custom | Blurred |
| ![Soft Black frame export example](docs/assets/examples/soft-black.png) | ![Custom frame export example](docs/assets/examples/custom.png) | ![Blurred frame export example](docs/assets/examples/blurred.png) |
| Ambient Gradient | Edge Stretch | Portrait Card |
| ![Ambient Gradient frame export example](docs/assets/examples/ambient-gradient.png) | ![Edge Stretch frame export example](docs/assets/examples/edge-stretch.png) | ![Portrait Card layout export example](docs/assets/examples/portrait-card.png) |

**Portrait Card** is a separate canvas layout, not a frame style. Place a landscape photo on a portrait canvas and adjust its size and position.

See more of the editor and its controls:

| Frame styles | Ambient Gradient | Edge Stretch |
|---|---|---|
| ![Nine frame styles](docs/assets/screenshots/en/frame-styles.png) | ![Ambient Gradient editor](docs/assets/screenshots/en/ambient-gradient.png) | ![Edge Stretch editor](docs/assets/screenshots/en/edge-stretch.png) |

| Portrait Card | Custom color | Photo metadata |
|---|---|---|
| ![Portrait Card editor](docs/assets/screenshots/en/portrait-card.png) | ![Custom color editor](docs/assets/screenshots/en/custom-color.png) | ![EXIF metadata editor](docs/assets/screenshots/en/metadata.png) |

## Photo information and sessions

- Read EXIF and XMP metadata from JPEG, PNG, and WebP photos and use it in canvas text.
- Correct camera and lens names. Corrections and text edits can be included in exports without changing the source files.
- Crop & Rotate is non-destructive. Crop ratio and canvas ratio are independent.
- Suspend a session and resume it later, including its editing history.
- Export JPEG, PNG, or WebP at Original size or a fixed short edge of 720, 1080, 1440, or 2160 px.
- GPS location and camera serial numbers are excluded unless explicitly selected in export settings.

| Metadata Corrections | Export settings |
|---|---|
| ![Camera and lens name correction settings](docs/assets/screenshots/en/metadata-corrections.png) | ![Export format and resolution settings](docs/assets/screenshots/en/export.png) |

## Platforms and current limitations

- **macOS 13 and later:** Distributed as a DMG. JPEG and PNG export are available; WebP export requires the encoder in the build environment.
- **Windows 11 x64 and later:** An NSIS installer is configured. Native image export is currently available on macOS only.
- **Linux:** Not currently a distribution target.

Lustra is in Beta. Signing and notarization, automatic updates, and Windows image export are among the features that are unavailable or still in progress. Check [GitHub Releases](https://github.com/arutaka1220/lustra/releases) for available builds.

## Development

You need Bun, the Rust toolchain, and the native build tools for your operating system.

```sh
bun install
bun tauri dev
```

```sh
bun run build
bun run test
bun run test:e2e
bun run test:rust
```

WebP export on macOS requires Homebrew's `webp` package. See [Contributing](CONTRIBUTING.md), the [requirements](Lustra_requirements.md), and the [design specification](Lustra_design_spec.md) for details.
