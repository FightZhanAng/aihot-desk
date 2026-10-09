/*
 * 图标生成 —— 纯 Node，零依赖。
 *
 * 为什么不用 SVG + nativeImage：Electron 的 nativeImage 不支持 SVG，
 * 且失败得完全静默（isEmpty=true，托盘里什么都看不见，不报错不打警告）。
 * 为什么不用 sharp/canvas：原生模块要处理 electron-rebuild 和 ABI 匹配，
 * 为一个图标不值得。
 *
 * 图形就是应用里的"信号带"：五根逐级增高的圆头竖条。
 *   - 应用图标：信号红圆角方底 + 白色信号条（任务栏深色浅色都醒目）
 *   - 托盘图标：透明底 + 信号红信号条
 *
 * 4×4 超采样做抗锯齿；PNG 与 ICO 都是手写的（见下方编码部分）。
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ------------------------------------------------------------ 绘制 */

// 信号红（浅色主题的 --signal）与墨色。图标不跟主题走，用固定值。
const RED = [0xd9, 0x2d, 0x1c]
const WHITE = [0xff, 0xff, 0xff]

/** 五根信号条的高度比（相对可用高度） */
const BAR_RATIOS = [0.26, 0.45, 0.64, 0.83, 1.0]

/**
 * 归一化坐标下的几何：坐标系是 0..1 的正方形。
 * 返回一个判定函数 (x, y) => 'bar' | 'plate' | null
 */
function makeShape({ withPlate }) {
  const barW = 0.108
  const gap = 0.062
  const totalW = BAR_RATIOS.length * barW + (BAR_RATIOS.length - 1) * gap
  const startX = (1 - totalW) / 2
  const bottom = 0.795
  const maxH = 0.6
  const cornerR = 0.05 // 圆头半径 = 半条宽

  // 预计算每根条的矩形
  const bars = BAR_RATIOS.map((ratio, i) => {
    const left = startX + i * (barW + gap)
    const h = ratio * maxH
    return { left, right: left + barW, top: bottom - h, bottom }
  })

  const plateR = 0.23

  return (x, y) => {
    for (const bar of bars) {
      if (inCapsule(x, y, bar, cornerR)) return 'bar'
    }
    if (withPlate && inRoundRect(x, y, 0, 0, 1, 1, plateR)) return 'plate'
    return null
  }
}

function inRoundRect(x, y, left, top, right, bottom, r) {
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = Math.min(Math.max(x, left + r), right - r)
  const cy = Math.min(Math.max(y, top + r), bottom - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

/** 圆头竖条：中间矩形 + 上下两个半圆 */
function inCapsule(x, y, bar, r) {
  if (x < bar.left || x > bar.right) return false
  if (y < bar.top || y > bar.bottom) return false
  const cx = (bar.left + bar.right) / 2
  const cyTop = bar.top + r
  const cyBottom = bar.bottom - r
  if (y >= cyTop && y <= cyBottom) return true
  const cy = y < cyTop ? cyTop : cyBottom
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

/**
 * 光栅化。SS×SS 超采样：每个子像素判定归属，最后平均 —— 边缘就是覆盖率。
 */
function rasterize(size, { withPlate, barColor, plateColor }) {
  const shape = makeShape({ withPlate })
  const SS = 4
  const data = Buffer.alloc(size * size * 4)

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size
          const y = (py + (sy + 0.5) / SS) / size
          const hit = shape(x, y)
          if (hit === 'bar') {
            r += barColor[0]
            g += barColor[1]
            b += barColor[2]
            a += 255
          } else if (hit === 'plate') {
            r += plateColor[0]
            g += plateColor[1]
            b += plateColor[2]
            a += 255
          }
        }
      }
      const n = SS * SS
      const idx = (py * size + px) * 4
      data[idx] = Math.round(r / n)
      data[idx + 1] = Math.round(g / n)
      data[idx + 2] = Math.round(b / n)
      data[idx + 3] = Math.round(a / n)
    }
  }
  return data
}

/* ------------------------------------------------------------ PNG 编码 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // 每行前置一个 filter 字节（0 = None）
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ------------------------------------------------------------ ICO 编码 */

/** 单帧：大尺寸用 PNG 内嵌，小尺寸用经典 BMP（兼容性最好） */
function icoFrame(size, rgba) {
  if (size >= 128) {
    return encodePng(size, rgba)
  }

  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8) // BMP 的规范要求高度写两倍
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16) // BI_RGB
  header.writeUInt32LE(size * size * 4, 20)

  // BGRA、自下而上
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4
      const dst = ((size - 1 - y) * size + x) * 4
      pixels[dst] = rgba[src + 2]
      pixels[dst + 1] = rgba[src + 1]
      pixels[dst + 2] = rgba[src]
      pixels[dst + 3] = rgba[src + 3]
    }
  }

  // AND 掩码：每行按 4 字节对齐，全 0（透明度交给 alpha 通道）
  const maskRow = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRow * size)

  return Buffer.concat([header, pixels, mask])
}

function encodeIco(frames) {
  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(frames.length, 4)

  const entries = []
  let offset = 6 + frames.length * 16
  const blobs = []
  for (const { size, data } of frames) {
    const entry = Buffer.alloc(16)
    entry[0] = size >= 256 ? 0 : size
    entry[1] = size >= 256 ? 0 : size
    entry[2] = 0
    entry[3] = 0
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    blobs.push(data)
    offset += data.length
  }

  return Buffer.concat([dir, ...entries, ...blobs])
}

/* ------------------------------------------------------------ 输出 */

const outDir = join(ROOT, 'resources')
mkdirSync(outDir, { recursive: true })

// 应用图标：红底白条
const appShape = { withPlate: true, barColor: WHITE, plateColor: RED }

const icon256 = rasterize(256, appShape)
writeFileSync(join(outDir, 'icon.png'), encodePng(256, icon256))

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoFrames = icoSizes.map((size) => ({
  size,
  data: icoFrame(size, rasterize(size, appShape))
}))
writeFileSync(join(outDir, 'icon.ico'), encodeIco(icoFrames))

// 托盘：透明底红条。32×32 给 2 倍图（Windows 托盘标称 16×16 / 150% DPI 是 24×24）
const trayShape = { withPlate: false, barColor: RED, plateColor: RED }
writeFileSync(join(outDir, 'tray.png'), encodePng(32, rasterize(32, trayShape)))

// 自查：打印产物摘要，出错时肉眼可见
console.log('icon.png   ', encodePng(256, icon256).length, 'bytes')
console.log('icon.ico   ', icoFrames.reduce((n, f) => n + f.data.length, 0) + 6 + icoFrames.length * 16, 'bytes,', icoSizes.join('/'))
console.log('tray.png   ', encodePng(32, rasterize(32, trayShape)).length, 'bytes')
