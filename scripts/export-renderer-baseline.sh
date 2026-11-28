#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <source-photo> <output-directory> [runs]" >&2
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The legacy renderer baseline is macOS-only." >&2
  exit 2
fi

if [[ $# -lt 2 || $# -gt 3 ]]; then
  usage
  exit 2
fi

source_photo="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
output_directory="$2"
runs="${3:-5}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -f "$source_photo" ]]; then
  echo "Source photo does not exist: $source_photo" >&2
  exit 2
fi
if [[ ! "$runs" =~ ^[1-9][0-9]*$ ]]; then
  echo "Runs must be a positive integer." >&2
  exit 2
fi
for tool in sips shasum cargo; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required command not found: $tool" >&2
    exit 2
  fi
done

mkdir -p "$output_directory"
output_directory="$(cd "$output_directory" && pwd)"
fixture_directory="$output_directory/inputs"
mkdir -p "$fixture_directory"

echo "Building the current native renderer in release mode..."
cargo build --release --manifest-path "$repo_root/src-tauri/Cargo.toml" \
  --bin documentation-media-examples --bin export-renderer-baseline-case
renderer="$repo_root/src-tauri/target/release/documentation-media-examples"
case_renderer="$repo_root/src-tauri/target/release/export-renderer-baseline-case"

printf 'date=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$output_directory/environment.txt"
printf 'os=%s\n' "$(sw_vers -productVersion)" >> "$output_directory/environment.txt"
printf 'architecture=%s\n' "$(uname -m)" >> "$output_directory/environment.txt"
printf 'cpu=%s\n' "$(sysctl -n machdep.cpu.brand_string)" >> "$output_directory/environment.txt"
printf 'memory_bytes=%s\n' "$(sysctl -n hw.memsize)" >> "$output_directory/environment.txt"
printf 'rustc=%s\n' "$(rustc --version)" >> "$output_directory/environment.txt"
printf 'commit=%s\n' "$(git -C "$repo_root" rev-parse HEAD)" >> "$output_directory/environment.txt"
printf 'source=%s\n' "$source_photo" >> "$output_directory/environment.txt"
printf 'source_sha256=%s\n' "$(shasum -a 256 "$source_photo" | awk '{print $1}')" >> "$output_directory/environment.txt"

for spec in '24mp 4000 6000' '45mp 6000 7500'; do
  read -r name height width <<< "$spec"
  input="$fixture_directory/$name.jpg"
  sips -z "$height" "$width" "$source_photo" --out "$input" >/dev/null
  printf '%s_width=%s\n' "$name" "$width" >> "$output_directory/environment.txt"
  printf '%s_height=%s\n' "$name" "$height" >> "$output_directory/environment.txt"
  printf '%s_sha256=%s\n' "$name" "$(shasum -a 256 "$input" | awk '{print $1}')" >> "$output_directory/environment.txt"
  for ((run = 1; run <= runs; run++)); do
    run_directory="$output_directory/$name/run-$run"
    mkdir -p "$run_directory"
    /usr/bin/time -l "$renderer" "$input" "$run_directory" > "$output_directory/$name-run-$run.log" 2>&1
  done
done

job="$repo_root/src-tauri/tests/fixtures/export-renderer-baseline/text-crop.json"
settings="$repo_root/src-tauri/tests/fixtures/export-renderer-baseline/png-1440-srgb.json"
mkdir -p "$output_directory/text-crop"
for name in 24mp 45mp; do
  input="$fixture_directory/$name.jpg"
  "$case_renderer" "$input" "$job" "$settings" "$output_directory/text-crop/warm-$name.png"
  for ((run = 1; run <= runs; run++)); do
    /usr/bin/time -l "$case_renderer" "$input" "$job" "$settings" \
      "$output_directory/text-crop/$name-$run.png" \
      > "$output_directory/text-crop/$name-$run.log" 2>&1
  done
done

for format in jpeg png webp; do
  settings="$repo_root/src-tauri/tests/fixtures/export-renderer-baseline/original-$format-srgb.json"
  job="$repo_root/src-tauri/tests/fixtures/export-renderer-baseline/plain-black.json"
  case "$format" in
    jpeg) extension=jpg ;;
    png) extension=png ;;
    webp) extension=webp ;;
  esac
  for name in 24mp 45mp; do
    input="$fixture_directory/$name.jpg"
    "$case_renderer" "$input" "$job" \
      "$settings" "$output_directory/original-warm-$name.$extension"
    for ((run = 1; run <= runs; run++)); do
      /usr/bin/time -l "$case_renderer" "$input" "$job" \
        "$settings" "$output_directory/original-$name-$format-$run.$extension" \
        > "$output_directory/original-$name-$format-$run.log" 2>&1
    done
  done
done

job="$repo_root/src-tauri/tests/fixtures/export-renderer-baseline/text-crop.json"
settings="$repo_root/src-tauri/tests/fixtures/export-renderer-baseline/png-1440-srgb.json"
mixed_inputs="$fixture_directory/mixed"
mkdir -p "$mixed_inputs" "$output_directory/batch" "$output_directory/batch-mixed"
cp "$fixture_directory/24mp.jpg" "$mixed_inputs/00-jellyfish-24mp.jpg"
for spec in \
  'aviation 4000 6000 01-aviation-24mp' \
  'alley 6000 7500 02-alley-45mp' \
  'illumination 4000 6000 03-illumination-24mp'; do
  read -r scene height width filename <<< "$spec"
  sips -z "$height" "$width" "$repo_root/scripts/media/fixtures/$scene.jpg" \
    --out "$mixed_inputs/$filename.jpg" >/dev/null
done
for input in "$mixed_inputs"/*.jpg; do
  printf 'mixed_%s_sha256=%s\n' "$(basename "$input")" \
    "$(shasum -a 256 "$input" | awk '{print $1}')" >> "$output_directory/environment.txt"
done
for name in 24mp 45mp; do
  input="$fixture_directory/$name.jpg"
  "$case_renderer" "$input" "$job" "$settings" "$output_directory/batch/warm-$name.png"
  for count in 10 30 100; do
    for ((run = 1; run <= runs; run++)); do
      /usr/bin/time -l "$case_renderer" "$input" "$job" "$settings" \
        "$output_directory/batch/$name-$count-$run" "$count" \
        > "$output_directory/batch/$name-$count-$run.log" 2>&1
    done
  done
done

"$case_renderer" "$mixed_inputs" "$job" "$settings" "$output_directory/batch-mixed/warm.png"
for count in 10 30 100; do
  for ((run = 1; run <= runs; run++)); do
    /usr/bin/time -l "$case_renderer" "$mixed_inputs" "$job" "$settings" \
      "$output_directory/batch-mixed/$count-$run" "$count" \
      > "$output_directory/batch-mixed/$count-$run.log" 2>&1
  done
done

echo "Baseline artifacts written to: $output_directory"
echo "Each timed run log records wall time, maximum RSS, CPU time, and page faults."
