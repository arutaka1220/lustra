import { convertFileSrc } from '@tauri-apps/api/core'
import type { ImportCandidate, PhotoSource } from '../../types/photo'

const supportedExtensions = new Set(['jpg', 'jpeg', 'png', 'webp'])

export function isSupportedImage(name: string) {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  return supportedExtensions.has(extension)
}

function candidateFromSource(source: PhotoSource, name: string): ImportCandidate {
  return {
    id: source.kind === 'path' ? source.path : `${name}:${source.file.size}:${source.file.lastModified}`,
    name,
    source,
    selected: true,
    metadata: {},
    metadataState: 'loading',
  }
}

export function candidatesFromPaths(paths: string[]) {
  return paths.flatMap((path) => {
    const name = path.split(/[\\/]/).pop() ?? path
    if (!isSupportedImage(name)) return []
    const source: PhotoSource = { kind: 'path', path, url: convertFileSrc(path) }
    return [candidateFromSource(source, name)]
  })
}

export function candidatesFromFiles(files: FileList | File[]) {
  return Array.from(files).flatMap((file) => {
    if (!isSupportedImage(file.name)) return []
    const source: PhotoSource = { kind: 'file', file, url: URL.createObjectURL(file) }
    return [candidateFromSource(source, file.name)]
  })
}
