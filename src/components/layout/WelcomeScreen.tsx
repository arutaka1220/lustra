import { ArrowRight, FolderOpen, History, Image, ImagePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '../../store/session-store'
import { useRecentThumbnail } from '../../store/session-persistence'

type WelcomeScreenProps = {
  onImportPhotos: () => void
  onImportFolder: () => void
}

function RecentThumbnail({ sessionId }: { sessionId: string }) {
  const url = useRecentThumbnail(sessionId)
  return <span className="recent-session__thumb">{url ? <img src={url} alt="" loading="lazy" /> : <Image size={18} />}</span>
}

export function WelcomeScreen({ onImportPhotos, onImportFolder }: WelcomeScreenProps) {
  const { t, i18n } = useTranslation()
  const photos = useSessionStore((state) => state.photos)
  const parkedSession = useSessionStore((state) => state.parkedSession)
  const recentSessions = useSessionStore((state) => state.recentSessions)
  const suspendedSessions = useSessionStore((state) => state.suspendedSessions)
  const activeRecentId = useSessionStore((state) => state.activeRecentId)
  const removedPhotos = useSessionStore((state) => state.removedPhotos)
  const restorePhoto = useSessionStore((state) => state.restorePhoto)
  const resumeCurrent = useSessionStore((state) => state.resumeCurrentSession)
  const resumeSuspended = useSessionStore((state) => state.resumeSuspendedSession)
  const openRecent = useSessionStore((state) => state.openRecentSession)
  const setScreen = useSessionStore((state) => state.setScreen)
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <main className="start-screen">
      <div className="start-screen__content">
        <h1>{t('welcome.title')}</h1>
        <p>{t('welcome.body')}</p>
        {photos.length > 0 && <div className="resume-actions">
          <button className="button button--primary" onClick={() => setScreen('edit')}>{t(activeRecentId ? 'session.continueRecent' : 'session.resume')} <ArrowRight size={16} /></button>
          {Boolean(parkedSession?.photos.length) && <button className="button button--secondary" onClick={resumeCurrent}>{t('session.resumeCurrent')}</button>}
        </div>}
        {!photos.length && parkedSession?.photos.length ? <div className="resume-actions">
          <button className="button button--primary" onClick={resumeCurrent}>{t('session.resumeCurrent')} <ArrowRight size={16} /></button>
        </div> : null}
        <section className="start-dropzone" aria-label={t('welcome.import')}>
          <div className="start-dropzone__icon"><ImagePlus size={21} strokeWidth={1.8} /></div>
          <strong>{t('welcome.dropTitle')}</strong>
          <span>{t('welcome.dropBody')}</span>
          <div className="start-dropzone__actions">
            <button className="button button--primary" onClick={onImportPhotos}>{t('welcome.import')}</button>
            <button className="button button--secondary" onClick={onImportFolder}><FolderOpen size={16} /> {t('welcome.addFolder')}</button>
          </div>
        </section>
        <div className="start-screen__footnote">JPEG · PNG · WebP</div>
        {suspendedSessions.length > 0 && <section className="recent-sessions" aria-labelledby="suspended-title">
          <h2 id="suspended-title"><History size={16} /> {t('session.suspended')}</h2>
          <ul>{suspendedSessions.map((session) => <li key={session.id}>
            <button className="recent-session" onClick={() => resumeSuspended(session.id)} aria-label={t('session.resumeNamed', { name: session.photos[0]?.name ?? session.id })}>
              <RecentThumbnail sessionId={session.id} />
              <span><strong>{dateFormat.format(new Date(session.updatedAt))}</strong><small>{t('session.photoCount', { count: session.photos.length })}</small></span>
              <ArrowRight size={16} className="recent-session__arrow" />
            </button>
          </li>)}</ul>
        </section>}
        {recentSessions.length > 0 && <section className="recent-sessions" aria-labelledby="recent-title">
          <h2 id="recent-title"><History size={16} /> {t('session.recent')}</h2>
          <ul>
            {recentSessions.map((session) => <li key={session.id}>
                <button className="recent-session" onClick={() => openRecent(session.id)}>
                  <RecentThumbnail sessionId={session.id} />
                  <span><strong>{dateFormat.format(new Date(session.updatedAt))}</strong><small>{t('session.photoCount', { count: session.photos.length })}</small></span>
                  <ArrowRight size={16} className="recent-session__arrow" />
                </button>
              </li>)}
          </ul>
        </section>}
        {removedPhotos.length > 0 && <details className="recently-removed recently-removed--start">
          <summary>{t('session.removed')} ({removedPhotos.length})</summary>
          <ul>{removedPhotos.map(({ photo }) => <li key={photo.id}><span>{photo.name}</span><button className="button button--secondary button--small" onClick={() => restorePhoto(photo.id)}>{t('session.restore')}</button></li>)}</ul>
        </details>}
      </div>
    </main>
  )
}
