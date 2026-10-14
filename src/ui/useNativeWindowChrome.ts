import { useEffect } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { recordMetric } from '../diagnostics/performance'

export function useNativeWindowChrome(theme: 'navy' | 'dark' | 'light') {
  useEffect(() => {
    if (!isTauri()) return
    const shell = document.querySelector('.studio-shell')
    if (!shell) return
    const style = getComputedStyle(shell)
    const color = (token: string) => {
      let value = style.getPropertyValue(token).trim()
      if (/^#[\da-f]{3}$/i.test(value)) value = '#' + [...value.slice(1)].map(char => char + char).join('')
      if (!/^#[\da-f]{6}$/i.test(value)) throw new Error('Native chrome token must be RGB hex')
      return [1,3,5].map(offset => parseInt(value.slice(offset,offset+2),16))
    }
    try {
      void invoke<{ highContrast: boolean; attributes: [number,number][] }>('set_window_chrome', { colors: { dark: theme !== 'light', caption: color('--surface-appbar'), text: color('--text-strong'), border: color('--border-subtle') } })
        .then(result => recordMetric('window.chrome', { theme, highContrast: result.highContrast, unsupportedAttributes: result.attributes.filter(([,hr])=>hr<0).length }))
        .catch(() => recordMetric('window.chrome-unavailable', { theme }))
    } catch { recordMetric('window.chrome-token-invalid', { theme }) }
  }, [theme])
}
