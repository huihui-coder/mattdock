import { useCallback, useEffect, useState } from 'react'
import { Lightbulb, LightbulbOff, Loader2 } from 'lucide-react'

function getToken() {
  return localStorage.getItem('auth_token') || ''
}

function readLightOn(state) {
  if (state === undefined || state === null) return false
  return Number(state) === 1
}

/** supplement_light_state: 0 关闭，非 0 开启 */
export default function SupplementLightControl({ deviceId, supplementLightState }) {
  const osdOn = readLightOn(supplementLightState)
  /** 下发成功后本地翻转（0/1）；OSD 上报一致后交还设备数据 */
  const [localOn, setLocalOn] = useState(null)
  const isOn = localOn !== null ? localOn === 1 : osdOn
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')

  useEffect(() => {
    if (localOn !== null && osdOn === (localOn === 1)) {
      setLocalOn(null)
    }
  }, [supplementLightState, localOn, osdOn])

  const toggle = useCallback(async () => {
    const action = isOn ? 'close' : 'open'
    setBusy(true)
    setHint('')
    try {
      const res = await fetch('/api/dock/supplement-light', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': getToken(),
        },
        body: JSON.stringify({ deviceId, action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `操作失败 ${res.status}`)
      const status = data.status
      if (status && status !== 'ok' && status !== 'sent' && status !== 'in_progress') {
        throw new Error(`设备返回: ${status}`)
      }
      setLocalOn(action === 'open' ? 1 : 0)
      setHint(action === 'open' ? '已下发打开补光灯' : '已下发关闭补光灯')
    } catch (e) {
      setHint(e.message || '补光灯控制失败')
    } finally {
      setBusy(false)
    }
  }, [deviceId, isOn])

  const tooltip = isOn ? '关闭补光灯' : '打开补光灯'
  const Icon = isOn ? Lightbulb : LightbulbOff

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title={tooltip}
        aria-label={tooltip}
        className={`p-2 rounded border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          isOn
            ? 'bg-amber-500/90 text-white border-amber-400/50 hover:bg-amber-500'
            : 'bg-gray-900/85 text-gray-300 border-white/15 hover:bg-gray-800 hover:text-white'
        }`}
      >
        {busy ? (
          <Loader2 size={18} className="animate-spin" />
        ) : (
          <Icon size={18} aria-hidden />
        )}
      </button>
      {hint && (
        <span className="text-xs text-amber-200 bg-black/70 px-2 py-1 rounded max-w-[140px] text-right">
          {hint}
        </span>
      )}
    </div>
  )
}

const NON_DOCK_TYPES = new Set(['drone', 'single', 'remote', 'airport_drone'])

/** 非 NEST 前缀的 gateway SN 均为 Dock 系列 */
export function isDockSeriesAirport(deviceType, deviceId) {
  const id = String(deviceId || '').trim()
  if (!id || id.startsWith('NEST')) return false
  const type = String(deviceType || '').toLowerCase()
  if (NON_DOCK_TYPES.has(type)) return false
  return true
}
