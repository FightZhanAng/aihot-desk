import { app, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 资源目录。开发时是项目根的 resources/，打包后由 electron-builder 的
 * extraResources 复制到 <app>/resources/assets/。
 */
export function assetsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'assets') : join(app.getAppPath(), 'resources')
}

export function appIconPath(): string {
  return join(assetsDir(), 'icon.png')
}

export function trayIconPath(): string {
  return join(assetsDir(), 'tray.png')
}

export function preloadPath(): string {
  // electron-vite 5 默认产出 ESM，扩展名是 .mjs；留个 .js 兜底，
  // 免得哪天改了产物格式就静默挂掉
  const esm = join(__dirname, '../preload/index.mjs')
  return existsSync(esm) ? esm : join(__dirname, '../preload/index.js')
}

/** 加载主页面：开发走 dev server，生产走打包后的 HTML */
export function loadRenderer(win: BrowserWindow): void {
  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) {
    void win.loadURL(`${devServer}/index.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 统一的窗口加固：禁止新开窗口、禁止外部导航（外部链接一律交给系统浏览器） */
export function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL']
    if (devServer && url.startsWith(devServer)) return
    event.preventDefault()
  })
}
