import { useEffect, useRef, useState } from 'react'
import { readAppPreference, writeAppPreference } from '../../store/session-persistence'
import { DEFAULT_REVIEW_MIN_SIZE } from './review-layout'

const PREFERENCE_KEY = 'review.minimumPhotoSize'
const MIN_SIZE = 160
const MAX_SIZE = 400
const STEP = 20

function normalizeSize(value: number | null): number {
  if (!Number.isFinite(value)) return DEFAULT_REVIEW_MIN_SIZE
  const clamped = Math.max(MIN_SIZE, Math.min(MAX_SIZE, value!))
  return MIN_SIZE + Math.round((clamped - MIN_SIZE) / STEP) * STEP
}

export function useReviewMinimumSize() {
  const [minimumSize, setMinimumSize] = useState(DEFAULT_REVIEW_MIN_SIZE)
  const [ready, setReady] = useState(false)
  const changedByUser = useRef(false)

  useEffect(() => {
    let active = true
    void readAppPreference<number>(PREFERENCE_KEY).then((saved) => {
      if (!active) return
      if (!changedByUser.current && saved !== null) setMinimumSize(normalizeSize(saved))
      setReady(true)
    }).catch((error: unknown) => {
      console.warn('Could not load review minimum size', error)
      if (active) setReady(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => {
      void writeAppPreference(PREFERENCE_KEY, minimumSize).catch((error: unknown) => console.warn('Could not save review minimum size', error))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [minimumSize, ready])

  const update = (value: number) => {
    changedByUser.current = true
    setMinimumSize(normalizeSize(value))
  }

  const reset = () => update(DEFAULT_REVIEW_MIN_SIZE)
  return { minimumSize, ready, update, reset }
}
