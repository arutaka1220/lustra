import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPhotoMetadata } from '../src/features/import/photo-metadata'
import type { ImportCandidate } from '../src/types/photo'

describe('capture metadata parsing from local images', () => {
  it('keeps the raw EXIF capture date and offset for the JPEG sample', async () => {
    const name = 'DSC_8575.jpg'
    const bytes = await readFile(resolve(process.cwd(), 'test-data', name))
    const file = new File([bytes], name)
    const candidate: ImportCandidate = {
      id: name,
      name,
      source: { kind: 'file', file, url: URL.createObjectURL(file) },
      selected: true,
      metadata: {},
      metadataState: 'ready',
    }
    const result = await readPhotoMetadata(candidate)
    expect(result.status).not.toBe('parseError')
    expect(result.metadata.date).toBe('2026:11:07 14:19:45.90+09:00')
    URL.revokeObjectURL(candidate.source.url)
  })
})
