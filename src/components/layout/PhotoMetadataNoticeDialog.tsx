import * as Dialog from '@radix-ui/react-dialog'
import { Aperture, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type PhotoMetadataNoticeDialogProps = {
  open: boolean
  onDismiss: () => void
}

export function PhotoMetadataNoticeDialog({ open, onDismiss }: PhotoMetadataNoticeDialogProps) {
  const { t } = useTranslation()
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onDismiss() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="settings-dialog">
          <div className="settings-dialog__top">
            <div className="dialog-icon"><Aperture size={17} /></div>
            <Dialog.Close asChild><button className="icon-button" aria-label={t('common.close')}><X size={16} /></button></Dialog.Close>
          </div>
          <Dialog.Title className="dialog-title">{t('import.noticeTitle')}</Dialog.Title>
          <Dialog.Description className="dialog-description">
            {t('import.noticeBody')}
          </Dialog.Description>
          <div className="dialog-actions"><button className="button button--primary" onClick={onDismiss}>{t('import.noticeDismiss')}</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
