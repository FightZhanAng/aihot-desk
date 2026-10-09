import type { HotspotApi } from './index'

declare global {
  interface Window {
    hotspot: HotspotApi
  }
}

export {}
