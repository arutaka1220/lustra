# Lustra

Lustra is a desktop app for adding frames and camera information to finished photos. The workflow runs from photo selection and one-by-one editing through review and batch export.

## Run locally

Install the dependencies with Bun, then launch the Tauri development window. A Rust toolchain and the target OS's native build tools are required.

```sh
bun install
bun tauri dev
```

Run the frontend and native checks with these commands.

```sh
bun run build
bun test
cargo test --manifest-path src-tauri/Cargo.toml
```

On macOS, the export engine uses system image and font frameworks. Install Homebrew's `webp` package in the target architecture's default prefix to also enable WebP output. For a custom installation, point `LUSTRA_WEBP_STATIC_DIR` at the directory containing the target architecture's `libwebp.a` and `libsharpyuv.a`. The built app bundles the linked encoder. JPEG and PNG are available in macOS builds without it.

```sh
bun tauri build
```

The configured packages are DMG for macOS 13 and later and NSIS for Windows. Native export currently runs on macOS. Windows export, automatic updates, release automation, signing and notarization remain pending.

## Current workflow

- Import JPEG, PNG and WebP files or the direct contents of a folder. Review the selection, reorder photos and add more while editing.
- Apply common or per-photo frames, adjust ratios, padding and Fill cropping, and save presets. Place EXIF-linked text on the canvas, correct camera or lens names across sessions, or fill missing values for an individual photo.
- Review every photo at the end of the session. On macOS, export JPEG, PNG or WebP with Original or fixed short-edge sizes, metadata category controls and ICC settings. A batch can be canceled or retried for failed photos.
- Resume the current session along with its Undo/Redo history after restarting. Finish moves it into Recent Sessions. Move a missing original back into the session with Locate File or a matching filename in a selected folder.
- Switch between English and Japanese in Preferences. Session edits are stored in SQLite WAL, preferences in JSON, and recent-session thumbnails in a separate cache. The source photo stays at its original path.

## Source map

- `src/features/import/`, `editor/`, `text/`, `review/` and `export/` own the workflow steps.
- `src/store/` holds the session model, independent history stacks and persistence bridge.
- `src-tauri/src/export/` contains macOS image composition and metadata handling. `src-tauri/src/persistence/` manages transactional local storage.
- `Lustra_requirements.md` defines behavior. `Lustra_design_spec.md` defines the workspace, theming and interaction patterns.

The editor uses PixiJS/WebGL with a Canvas 2D fallback. The review grid renders lazily. Native thumbnail generation for large imports, additional color/typography comparisons between the preview and output, and testing on other OS targets are still pending.
