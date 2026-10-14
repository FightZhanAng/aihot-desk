import type { ReactElement } from 'react'
import type { AppInfo, Settings, UpdateState } from '@shared/types'
import { updateBusy, updateNeedsAttention, updateStatusText } from '@shared/update'
import { CloseIcon, FolderIcon } from './Icons'

/*
 * 设置抽屉。每一项都要能一句话说清楚它改变什么 ——
 * 「自动刷新」旁边写的是它实际做的事，不是"性能优化"这种空话。
 */

const THEME_CHOICES: { value: Settings['theme']; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

const REFRESH_CHOICES: { value: number; label: string }[] = [
  { value: 0, label: '关闭' },
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' }
]

interface SettingsDrawerProps {
  open: boolean
  settings: Settings | null
  appInfo: AppInfo | null
  update: UpdateState | null
  onClose: () => void
  onPatch: (patch: Partial<Settings>) => void
  onCheckUpdate: () => void
  onDownloadUpdate: () => void
  onInstallUpdate: () => void
  onOpenRelease: () => void
  onOpenDataDir: () => void
  onOpenSite: () => void
}

export function SettingsDrawer({
  open,
  settings,
  appInfo,
  update,
  onClose,
  onPatch,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenRelease,
  onOpenDataDir,
  onOpenSite
}: SettingsDrawerProps): ReactElement {
  return (
    <>
      <div className={`drawer__scrim${open ? ' is-open' : ''}`} onClick={onClose} />
      <aside className={`drawer${open ? ' is-open' : ''}`} aria-hidden={!open}>
        <div className="drawer__head">
          <span className="drawer__title">设置</span>
          <button type="button" className="icon-btn" onClick={onClose} title="关闭">
            <CloseIcon />
          </button>
        </div>

        <div className="drawer__body">
          <div className="field">
            <span className="field__label">主题</span>
            <div className="seg">
              {THEME_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={`seg__btn${settings?.theme === choice.value ? ' is-active' : ''}`}
                  onClick={() => onPatch({ theme: choice.value })}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field__label">自动刷新</span>
            <div className="seg">
              {REFRESH_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={`seg__btn${settings?.refreshMinutes === choice.value ? ' is-active' : ''}`}
                  onClick={() => onPatch({ refreshMinutes: choice.value })}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            <span className="field__hint">
              后台按这个间隔向 AIHOT 取一次数。热榜接口本身有 60 秒的缓存，比这更快的刷新不会拿到更新的内容。
            </span>
          </div>

          <div className="field">
            <span className="field__label">通知</span>
            <div className="switchrow">
              <span className="field__hint" style={{ flex: 1 }}>
                有新事件进入热榜前三时，发一条系统通知。
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={settings?.notifyOnHot ?? false}
                className={`switch${settings?.notifyOnHot ? ' is-on' : ''}`}
                onClick={() => onPatch({ notifyOnHot: !(settings?.notifyOnHot ?? false) })}
                title="新热点通知"
              />
            </div>
          </div>

          {/* 版本：当前值、检查动作、状态、以及随状态变化的主按钮 */}
          <div className="field">
            <span className="field__label">版本</span>
            <div className="updater">
              <div className="updater__row">
                <span className="updater__version">v{appInfo?.version ?? update?.current ?? '—'}</span>
                {/*
                  下载完的更新只等安装：这一态下「检查更新」是禁用的 ——
                  再查一次会把状态挪走，「重启并安装」的入口就没了（见 main/updater.ts）。
                */}
                <button
                  type="button"
                  className="btn"
                  onClick={onCheckUpdate}
                  disabled={
                    update ? updateBusy(update.status) || update.status === 'downloaded' : false
                  }
                  title={update?.status === 'downloaded' ? '更新已下载，重启即可安装' : undefined}
                >
                  {update?.status === 'checking' ? '检查中…' : '检查更新'}
                </button>
              </div>

              {update && (
                <div
                  className={`updater__status${updateNeedsAttention(update.status) ? ' is-alert' : ''}`}
                  data-testid="update-status"
                  title={update.message || undefined}
                >
                  {updateStatusText(update)}
                </div>
              )}

              {update?.status === 'downloading' && (
                <div className="updater__bar" role="progressbar" aria-valuenow={Math.round(update.percent)}>
                  <i style={{ width: `${Math.max(0, Math.min(100, update.percent))}%` }} />
                </div>
              )}

              {update?.notes && update.status === 'available' && (
                <p className="updater__notes">{update.notes}</p>
              )}

              <div className="updater__actions">
                {update?.status === 'available' && update.canDownload && (
                  <button type="button" className="btn btn--primary" onClick={onDownloadUpdate}>
                    下载新版本 {update.latest}
                  </button>
                )}
                {update?.status === 'downloaded' && (
                  <button type="button" className="btn btn--primary" onClick={onInstallUpdate}>
                    重启并安装 {update.latest}
                  </button>
                )}
                <button type="button" className="btn" onClick={onOpenRelease}>
                  打开发布页
                </button>
              </div>

              <div className="switchrow" style={{ marginTop: 2 }}>
                <span className="field__hint" style={{ flex: 1 }}>
                  每天自动检查一次新版本。下载与安装永远由你决定。
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings?.autoCheckUpdate ?? true}
                  className={`switch${settings?.autoCheckUpdate ? ' is-on' : ''}`}
                  onClick={() => onPatch({ autoCheckUpdate: !(settings?.autoCheckUpdate ?? true) })}
                  title="自动检查更新"
                />
              </div>
            </div>
          </div>

          <div className="about">
            <div className="about__row">
              <span>Electron</span>
              <span>{appInfo?.electron ?? '—'}</span>
            </div>
            <div className="about__row">
              <span>数据来源</span>
              <span>AIHOT</span>
            </div>
            <div className="about__row" style={{ marginTop: 4 }}>
              <span>数据与内容版权归 AIHOT 及原始信源所有</span>
            </div>
            <button type="button" className="icon-btn" onClick={onOpenSite}>
              <FolderIcon />
              <span>打开 aihot.news</span>
            </button>
            <button type="button" className="icon-btn" onClick={onOpenDataDir}>
              <FolderIcon />
              <span>打开数据目录</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
