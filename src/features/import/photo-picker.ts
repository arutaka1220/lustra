import { invoke, isTauri } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { readDir } from '@tauri-apps/plugin-fs'
import { candidatesFromPaths, isSupportedImage } from './photo-candidates'
import type { ImportCandidate } from '../../types/photo'

export async function pickImageFiles({ multiple = true, title = 'Add Photos' } = {}): Promise<ImportCandidate[]> {
  if (!isTauri()) return []
  const selected = await open({
    multiple,
    directory: false,
    filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    title,
  })
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
  await invoke('allow_photo_paths', { paths })
  return candidatesFromPaths(paths)
}

export async function pickImageFolder(): Promise<ImportCandidate[] | null> {
  if (!isTauri()) return null
  const selected = await open({ directory: true, multiple: false, title: 'Choose a folder' })
  if (!selected || Array.isArray(selected)) return null
  await invoke('allow_photo_directory', { path: selected })
  return candidatesFromFolderPath(selected)
}

export async function candidatesFromFolderPath(folderPath: string): Promise<ImportCandidate[]> {
  const entries = await readDir(folderPath)
  const directFiles = entries.filter((entry) => entry.isFile && entry.name && isSupportedImage(entry.name))
  const paths = await Promise.all(directFiles.map((entry) => join(folderPath, entry.name)))
  if (isTauri()) await invoke('allow_photo_paths', { paths })
  return candidatesFromPaths(paths)
}

export async function candidatesFromDroppedPaths(paths: string[]): Promise<ImportCandidate[]> {
  const candidates: ImportCandidate[] = []
  for (const path of paths) {
    if (isSupportedImage(path)) {
      if (isTauri()) await invoke('allow_photo_paths', { paths: [path] })
      candidates.push(...candidatesFromPaths([path]))
      continue
    }
    try {
      candidates.push(...await candidatesFromFolderPath(path))
    } catch {
      // Ignore unsupported files and inaccessible folders without interrupting a drop.
    }
  }
  return candidates
}
