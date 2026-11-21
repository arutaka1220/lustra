# Lustra release operations

This repository uses signed Tauri 2 updater bundles and separate Stable and Beta feeds. The workflow files prepare local automation only; no tag, GitHub release, feed branch, environment reviewer, or signing credential was created by this setup.

## Verified repository setup

- `package.json` is the authoritative app version file. `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the root `lustra` package entry in `src-tauri/Cargo.lock` are required mirrors.
- All four version values must match. Supported versions are SemVer `X.Y.Z` and `X.Y.Z-beta.N`.
- `main` is the only existing branch and there were no existing tags, Actions workflows, changelog, or GitHub release feed when this setup was inspected.
- The Tauri build uses Bun, Tauri 2, and currently targets Apple Silicon macOS, Intel macOS, and x64 Windows. Tauri's updater bundles are macOS `.app.tar.gz` and Windows NSIS `-setup.exe`, each with a `.sig` file. CI stages these under architecture-specific names before attaching them to the release.
- The updater feed is hosted as JSON files in the dedicated `release-feed` branch: `stable/stable.json` and `beta/beta.json`. App downloads use the public raw GitHub URLs compiled into Lustra.

## Branches, versions, and tags

`main` is the development and release source branch. Use short-lived `feat/*`, `fix/*`, `refactor/*`, and, where needed, `release/*` branches. Do not create permanent Stable or Beta branches. Tags identify releases and must point to a commit reachable from `main`.

Use Conventional Commits. Update the four version mirrors together before creating the release tag. For example, a Beta tag is `v0.2.0-beta.1`; its next Beta increments the suffix. A Stable tag is `v0.2.0`. Run:

```sh
./scripts/intelirelease read-version .github/release-setup.json
node --test scripts/*.test.mjs
```

The helper rejects invalid versions, inconsistent mirrors, stale versions, and malformed channel routes. The release workflow verifies the tag's version against the files at the tagged commit and confirms that commit is on `main`.

## Beta release

1. Update all version mirrors to the next `X.Y.Z-beta.N` and merge the release commit to `main`.
2. Run the app tests and build checks. Confirm the commit is suitable for early testers.
3. Create and push the version tag when ready to release. Pushing `vX.Y.Z-beta.N` starts the release workflow; this setup did not create any tags.
4. CI builds macOS arm64, macOS x86_64, and Windows x86_64, requires signed updater artifacts, creates a GitHub Pre-release, checks that artifact and `.sig` URLs resolve, then fast-forward updates the Beta feed.

Beta is an intentionally selected preview channel, not a nightly build. No schedule publishes it automatically.

## Stable release

1. Complete validation and set all mirrors to the next stable `X.Y.Z`.
2. Merge the release commit to `main` and create/push its tag.
3. Configure the GitHub `stable-release` environment with required reviewers before relying on it. The workflow references this environment, but reviewer protection is **not active** until configured in GitHub repository settings.
4. After approval, CI creates the non-prerelease GitHub Release, verifies the signed bundle URLs, and fast-forward updates Stable. A newer Stable is also written to Beta when it supersedes the current Beta version.

The `beta-release` environment is used for preview releases and does not require manual approval by default. Confirm repository environment settings before first use.

## Tauri updater signing

Stable and Beta share one updater key pair. Do not commit the private key, place it in release setup JSON, print it in logs, or replace it after users have installed a build signed by it.

To create the key only when the owner is ready to establish the long-lived production key, run locally:

```sh
bunx tauri signer generate -w ~/.tauri/lustra.key
```

Choose a strong password and keep the generated `.key` and `.key.pub` in separate secure backups (for example, an encrypted password manager plus an offline encrypted backup). Do not put either file in the repository. The existing key was not present during this setup and no key was generated or rotated.

Add these GitHub repository settings before a release build:

| Name | Type | Value |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Actions secret | Complete contents of `~/.tauri/lustra.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Actions secret | Password selected when generating the key |
| `LUSTRA_UPDATER_PUBKEY` | Actions variable | Complete contents of `~/.tauri/lustra.key.pub` |

The public key is compiled into the desktop app from the `LUSTRA_UPDATER_PUBKEY` Actions variable; the release preflight and build fail closed if it is missing. No source edit is needed after setting that variable. macOS Developer ID signing, Apple notarization, and paid Windows code signing are not configured here. OS install prompts and first-run restrictions must be tested on real macOS and Windows machines; the workflow does not claim they are bypassed.

## GitHub Actions and retry behavior

- `Validate release metadata` runs for pull requests and pushes to `main`; it checks JSON configuration, version mirrors, release-helper unit tests, app unit tests, and the frontend build.
- `Build and publish release` runs on a `v*` tag push. The manual workflow dispatch accepts an existing tag and is intended for recovering a release/feed delivery interrupted after release creation.
- The target build jobs run both Vitest and Rust unit tests before packaging, including session snapshot migration tests.
- The release job is serialized across channel updates. A new tag builds once and creates a draft release; after the environment gate it publishes the release and feed. A retry for an existing tag reuses the release assets and refuses to move either feed backwards. Existing releases are not overwritten.
- Required `contents: write` is limited to the publish job. Build and validation jobs use read-only repository permissions.
- Tauri updater JSON copies the signature text from each corresponding `.sig` file. It includes version, release notes, UTC publication time, platform/architecture keys, download URLs, and `session_snapshot_versions`. The latter is checked by the app before offering an update; keep it aligned with `SESSION_SNAPSHOT_VERSION` and include a version only if the released app can restore it. Feed publishing is a normal fast-forward push; a concurrent or rejected push fails rather than force-pushing.

The `release-feed` branch is created by the first successful feed publication. Raw file downloads require the repository to be readable without authentication. Confirm that repository visibility and release downloads match the intended audience before the first release.

## Recovery and troubleshooting

- **Version mismatch or tag rejected:** inspect all four mirrors at the tagged commit, the tag format, and whether its commit is reachable from `main`.
- **Missing signing secret or signature:** configure the exact GitHub secret names above. Never add a placeholder signature or disable updater verification.
- **Missing expected updater bundle:** inspect the Tauri build output under `src-tauri/target/release/bundle/`; correct the configured artifact name only after checking the actual platform output.
- **Stable approval did not pause:** configure required reviewers on the GitHub `stable-release` environment. The checked-in workflow alone cannot configure GitHub environment reviewers.
- **Release exists but feed delivery failed:** manually dispatch `Build and publish release` from `main` with the existing tag. It downloads the existing release assets, validates signatures and URL resolution, and retries a fast-forward feed update. It does not rebuild or overwrite the published release.
- **Feed branch push rejected:** inspect the branch and latest channel versions. Do not force-push. Rerun the same tag only after resolving the conflict; stale versions are rejected.
- **Session compatibility:** updater installation is gated in app code, independently of this publisher. The app flushes its current snapshot and atomically writes `sessions.pre-update.json` in its app data directory before invoking the installer; the feed must list the session format versions supported by the new build. Verify session persistence, safe export/restart behavior, and recovery on real packaged apps before a public rollout.

## First release checklist

1. Generate and safely back up the long-lived updater key pair; set the GitHub secrets and public-key variable.
2. Confirm the public key is embedded in the app runtime and the signing secret belongs to it.
3. Configure required reviewers for `stable-release` and confirm Actions write permission is permitted.
4. Run macOS arm64, macOS Intel, and Windows x64 CI builds with the real signing key; verify the actual bundles, signatures, and app install/update behavior.
5. Confirm the repository is publicly readable if updates are intended for users without GitHub authentication.
6. Publish a Beta first and verify both the GitHub Pre-release assets and public feed URLs. Only after that validation, approve a Stable release.

No external settings or release artifacts were changed while preparing this documentation.
