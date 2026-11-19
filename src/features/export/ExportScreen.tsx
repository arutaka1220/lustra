import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, Check, Download, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { registerWindowCloseGuard } from '../../store/session-persistence'
import { getEffectiveFrame } from '../../store/session-store'
import type { FrameSettings, SessionPhoto } from '../../types/photo'
import { useMetadataCorrections } from '../text/metadata-corrections-store'
import { getEffectiveMetadata, resolveTextLayers } from '../text/text-model'
import { ExportPreferencesContent } from './ExportPreferencesPanel'
import { exportCopy } from './export-copy'
import {
  beginExport,
  cancelExport,
  exportError,
  getExportSettings,
} from './export-model'
import type { CancelPolicy, ExportJob, ExportOutcome } from './export-model'
import { useExportPreferences } from './useExportPreferences'

type ExportScreenProps = {
  photos: SessionPhoto[]
  commonFrame: FrameSettings
  onBackToReview: () => void
  onBackToEditing: () => void
  onFinish: () => void | Promise<void>
  onBusyChange: (busy: boolean) => void
}

type Result = ExportOutcome | { type: 'cancelled' }
type ExportReport = {
  outcomes: Map<string, Result>
  cancelled: boolean
  cleanupErrors: string[]
}

type ActiveRun = {
  report: ExportReport
  runId: string | null
  cancelling: boolean
}

function isReadingMetadata(photo: SessionPhoto) {
  return photo.metadataState === 'loading' && photo.source.kind === 'path' && !photo.source.missing
}

function ExportConfirmation({ open, onClose, restoreFocus, title, description, children }: {
  open: boolean
  onClose: () => void
  restoreFocus: () => void
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="settings-dialog export-dialog" onCloseAutoFocus={(event) => {
        event.preventDefault()
        restoreFocus()
      }}>
        <Dialog.Title className="dialog-title">{title}</Dialog.Title>
        <Dialog.Description className="dialog-description">{description}</Dialog.Description>
        <div className="dialog-actions export-dialog__actions">{children}</div>
      </Dialog.Content>
    </Dialog.Root>
  )
}

export function ExportScreen({ photos, commonFrame, onBackToReview, onBackToEditing, onFinish, onBusyChange }: ExportScreenProps) {
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage?.startsWith('ja') ? 'ja' : 'en'
  const copy = exportCopy[language]
  const corrections = useMetadataCorrections((state) => state.corrections)
  const values = useExportPreferences()
  const { preferences, capabilities, destinationApproved, pickingDestination } = values
  const [actionError, setActionError] = useState<{ description: string; detail: string } | null>(null)
  const [confirmation, setConfirmation] = useState<'incomplete' | 'cancel' | null>(null)
  const [phase, setPhase] = useState<'settings' | 'progress' | 'result'>('settings')
  const [progress, setProgress] = useState({ processed: 0, total: 0 })
  const [canCancel, setCanCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [report, setReport] = useState<ExportReport | null>(null)
  const [finishing, setFinishing] = useState(false)
  const activeRun = useRef<ActiveRun | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const dialogTrigger = useRef<HTMLElement | null>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [phase])

  const runExport = async (batch: SessionPhoto[], previous: ExportReport | null = null) => {
    if (activeRun.current || !capabilities || !destinationApproved || !batch.length || batch.some(isReadingMetadata)) return

    const current: ActiveRun = {
      report: { outcomes: new Map(previous?.outcomes), cancelled: false, cleanupErrors: [...(previous?.cleanupErrors ?? [])] },
      runId: null,
      cancelling: false,
    }
    const jobs: ExportJob[] = []
    for (const photo of batch) {
      current.report.outcomes.delete(photo.id)
      if (photo.source.kind !== 'path') {
        current.report.outcomes.set(photo.id, { type: 'failed', message: copy.unsupportedSource })
        continue
      }
      if (photo.source.missing) {
        current.report.outcomes.set(photo.id, { type: 'failed', message: copy.missingSource })
        continue
      }
      const frame = getEffectiveFrame(photo, commonFrame)
      const { camera, lens } = getEffectiveMetadata(photo, corrections)
      jobs.push({
        id: photo.id,
        path: photo.source.path,
        frame,
        text: resolveTextLayers(photo, frame, corrections),
        metadata: { camera, lens },
      })
    }

    setConfirmation(null)
    setActionError(null)
    if (!jobs.length) {
      setReport(current.report)
      setPhase('result')
      return
    }

    const invalidCount = batch.length - jobs.length
    activeRun.current = current
    const releaseCloseGuard = registerWindowCloseGuard(() => {
      if (!current.cancelling) showConfirmation('cancel')
      return true
    })
    setProgress({ processed: invalidCount, total: batch.length })
    setPhase('progress')
    onBusyChange(true)

    try {
      const runId = await beginExport(preferences.destination, jobs, getExportSettings(preferences, capabilities), (event) => {
        if (activeRun.current !== current) return
        if (event.type === 'photo') {
          current.report.outcomes.set(event.id, event.outcome)
          setProgress({ processed: event.processed + invalidCount, total: event.total + invalidCount })
          return
        }

        for (const id of event.deletedIds) current.report.outcomes.delete(id)
        for (const job of jobs) {
          if (!current.report.outcomes.has(job.id)) {
            current.report.outcomes.set(job.id, event.cancelled ? { type: 'cancelled' } : { type: 'failed', message: copy.unprocessedSource })
          }
        }
        current.report.cancelled = event.cancelled
        current.report.cleanupErrors.push(...event.cleanupErrors)
        activeRun.current = null
        releaseCloseGuard()
        setReport(current.report)
        setCanCancel(false)
        setCancelling(false)
        setConfirmation(null)
        setPhase('result')
        onBusyChange(false)
      })
      if (activeRun.current === current) {
        current.runId = runId
        setCanCancel(true)
      }
    } catch (error) {
      if (activeRun.current !== current) return
      activeRun.current = null
      releaseCloseGuard()
      setConfirmation(null)
      setCanCancel(false)
      setPhase(previous ? 'result' : 'settings')
      setActionError({ description: copy.exportFailed, detail: exportError(error) })
      onBusyChange(false)
    }
  }

  const requestCancel = async (policy: CancelPolicy) => {
    const current = activeRun.current
    if (!current?.runId || current.cancelling) return

    current.cancelling = true
    setConfirmation(null)
    setCancelling(true)
    setActionError(null)
    try {
      await cancelExport(current.runId, policy)
    } catch (error) {
      if (activeRun.current !== current) return
      current.cancelling = false
      setCancelling(false)
      setActionError({ description: copy.cancelFailed, detail: exportError(error) })
    }
  }

  const finish = async () => {
    setFinishing(true)
    setActionError(null)
    onBusyChange(true)
    try {
      await onFinish()
    } catch (error) {
      setActionError({ description: copy.finishFailed, detail: exportError(error) })
    } finally {
      setFinishing(false)
      onBusyChange(false)
    }
  }

  const showConfirmation = (kind: NonNullable<typeof confirmation>) => {
    dialogTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirmation(kind)
  }

  const restoreDialogFocus = () => {
    const target = dialogTrigger.current
    if (target?.isConnected && !target.matches(':disabled')) target.focus()
    else heading.current?.focus()
  }

  const incomplete = photos.filter((photo) => !photo.completed).length
  const pendingMetadata = photos.filter(isReadingMetadata).length
  const settingsReady = !!capabilities?.formats.length
  const canExport = settingsReady && destinationApproved && !pickingDestination && !!photos.length && !pendingMetadata
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canExport) return
    if (incomplete) showConfirmation('incomplete')
    else void runExport(photos)
  }

  const failed = report ? photos.filter((photo) => report.outcomes.get(photo.id)?.type === 'failed') : []
  const saved = report ? [...report.outcomes.values()].filter((result) => result.type === 'success').length : 0
  const stopped = report ? [...report.outcomes.values()].filter((result) => result.type === 'cancelled').length : 0
  const percent = progress.total > 0 ? progress.processed / progress.total : 0
  const percentLabel = new Intl.NumberFormat(language, { style: 'percent' }).format(percent)
  const title = phase === 'settings' ? copy.settingsTitle : phase === 'progress' ? copy.progressTitle : report?.cancelled ? copy.cancelledTitle : copy.resultTitle

  return (
    <main className="export-view">
      <section className="export-card" aria-labelledby="export-title">
        <h1 id="export-title" ref={heading} tabIndex={-1}>{title}</h1>
        {phase === 'settings' && (
          <form className="export-form" onSubmit={submit}>
            <ExportPreferencesContent values={values} language={language} />
            {settingsReady && pendingMetadata > 0 && <p className="export-message" role="status">{copy.loadingMetadata(pendingMetadata)}</p>}
            <div className="export-actions">
              <button className="button button--quiet" type="button" onClick={onBackToReview}><ArrowLeft size={15} aria-hidden="true" /> {copy.backToReview}</button>
              <button className="button button--primary" type="submit" disabled={!canExport}>
                <Download size={16} aria-hidden="true" /> {copy.export}
              </button>
            </div>
          </form>
        )}

        {phase === 'progress' && (
          <div className="export-progress">
            <div className="export-progress__label">
              <span id="export-progress-label">{copy.progressCount(progress.processed, progress.total)}</span>
              <strong>{percentLabel}</strong>
            </div>
            <progress max={progress.total} value={progress.processed} aria-labelledby="export-progress-label" />
            <div className="export-actions export-actions--end">
              <button className="button button--secondary" type="button" disabled={!canCancel || cancelling} onClick={() => showConfirmation('cancel')}>
                {cancelling ? copy.cancelling : copy.cancel}
              </button>
            </div>
          </div>
        )}

        {phase === 'result' && report && (
          <div className="export-result">
            <p className="export-summary">
              <span className={saved ? 'export-summary__saved' : undefined}>{saved > 0 && <Check size={17} aria-hidden="true" />}{copy.savedCount(saved)}</span>
              {failed.length > 0 && <span className="export-summary__failed">{copy.failedCount(failed.length)}</span>}
              {stopped > 0 && <span>{copy.skippedCount(stopped)}</span>}
            </p>
            {saved > 0 && <p className="export-result__destination" title={preferences.destination}>{preferences.destination}</p>}
            {!!failed.length && (
              <div className="export-failed">
                <h2>{copy.failedTitle}</h2>
                <ul>
                  {failed.map((photo) => {
                    const outcome = report.outcomes.get(photo.id)
                    return <li key={photo.id}><strong>{photo.name}</strong><span>{outcome?.type === 'failed' && outcome.message}</span></li>
                  })}
                </ul>
              </div>
            )}
            {!!report.cleanupErrors.length && (
              <div className="export-error" role="alert">
                <strong>{copy.cleanupFailed}</strong>
                <ul>{report.cleanupErrors.map((error, index) => <li key={index}>{error}</li>)}</ul>
              </div>
            )}
            <div className="export-actions export-result__actions">
              <button className="button button--quiet" type="button" onClick={onBackToEditing} disabled={finishing}><ArrowLeft size={15} aria-hidden="true" /> {copy.backToEditing}</button>
              <div>
                {failed.length > 0 && (
                  <button className="button button--secondary" type="button" onClick={() => { void runExport(failed, report) }} disabled={finishing}>
                    <RotateCcw size={15} aria-hidden="true" /> {copy.retryFailed}
                  </button>
                )}
                <button className="button button--secondary" type="button" onClick={() => { setActionError(null); setPhase('settings') }} disabled={finishing}>{copy.exportAgain}</button>
                <button className="button button--primary" type="button" onClick={() => { void finish() }} disabled={finishing}>{copy.finish}</button>
              </div>
            </div>
          </div>
        )}

        {actionError && <div className="export-error" role="alert"><strong>{actionError.description}</strong><span>{actionError.detail}</span></div>}
      </section>

      <ExportConfirmation open={confirmation === 'incomplete'} onClose={() => setConfirmation(null)} restoreFocus={restoreDialogFocus} title={copy.incompleteTitle} description={copy.incompleteBody(incomplete)}>
        <button className="button button--secondary" type="button" onClick={onBackToEditing}>{copy.backToEditing}</button>
        <button className="button button--primary" type="button" onClick={() => { void runExport(photos) }}>{copy.exportAnyway}</button>
      </ExportConfirmation>
      <ExportConfirmation open={confirmation === 'cancel'} onClose={() => setConfirmation(null)} restoreFocus={restoreDialogFocus} title={copy.cancelTitle} description={copy.cancelBody}>
        <button className="button button--quiet" type="button" onClick={() => setConfirmation(null)}>{copy.continue}</button>
        <button className="button button--secondary" type="button" disabled={!canCancel} onClick={() => { void requestCancel('keep') }}>{copy.keep}</button>
        <button className="button button--secondary export-delete-button" type="button" disabled={!canCancel} onClick={() => { void requestCancel('delete') }}>{copy.delete}</button>
      </ExportConfirmation>
    </main>
  )
}
