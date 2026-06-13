#!/usr/bin/env bash
set -euo pipefail

target="${1:-all}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -e "console.log(require('${root}/manifest.json').version)")"
stamp="$(date -u +%Y%m%d%H%M%S)"
build_root="${root}/build/marketplace/${stamp}"

case "${target}" in
  all|chrome|firefox) ;;
  *)
    echo "Usage: scripts/package-extension.sh [all|chrome|firefox]" >&2
    exit 2
    ;;
esac

build_target() {
  local browser="$1"
  local out_dir="${build_root}/${browser}"
  local zip_path="${build_root}/plex-lyrics-pip-${version}-${browser}.zip"

  mkdir -p "${out_dir}/icons"
  cp "${root}/lyrics-status.js" "${out_dir}/"
  cp "${root}/pip-page.js" "${out_dir}/"
  cp "${root}/README.md" "${out_dir}/"
  cp "${root}/LICENSE" "${out_dir}/"
  cp "${root}/icons/icon-16.png" "${out_dir}/icons/"
  cp "${root}/icons/icon-48.png" "${out_dir}/icons/"
  cp "${root}/icons/icon-128.png" "${out_dir}/icons/"

  node - "${root}/manifest.json" "${out_dir}/manifest.json" "${browser}" <<'NODE'
const fs = require('node:fs');

const [inputPath, outputPath, browser] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

if (browser === 'chrome') {
  delete manifest.browser_specific_settings;
  manifest.minimum_chrome_version = manifest.minimum_chrome_version || '116';
} else if (browser === 'firefox') {
  delete manifest.minimum_chrome_version;
  const gecko = manifest.browser_specific_settings?.gecko || {};
  manifest.browser_specific_settings = manifest.browser_specific_settings || {};
  manifest.browser_specific_settings.gecko = {
    ...gecko,
    id: gecko.id || '{bb57550a-75f8-4fed-8d36-568f2c74d4d9}',
    strict_min_version: '151.0',
    data_collection_permissions: {
      required: ['none'],
    },
  };
}

fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

  (cd "${out_dir}" && zip -qr "${zip_path}" .)
  echo "${zip_path}"
}

mkdir -p "${build_root}"

if [[ "${target}" == "all" || "${target}" == "chrome" ]]; then
  build_target chrome
fi

if [[ "${target}" == "all" || "${target}" == "firefox" ]]; then
  build_target firefox
fi
