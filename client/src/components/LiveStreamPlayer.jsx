import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import flvjs from 'flv.js'
import { Video, VideoOff, RefreshCw, Loader2, Plane } from 'lucide-react'
import SupplementLightControl, { isDockSeriesAirport } from './SupplementLightControl'
import { fetchStreamUrl } from '../lib/stream-url'

const DOCK_CAMERA_OPTIONS = [
  { position: 0, label: '舱内推流' },
  { position: 1, label: '舱外推流' },
]

function getToken() {
  return localStorage.getItem('auth_token') || ''
}

export function isDockSharedOutAirport(deviceType, deviceId) {
  return isDockSeriesAirport(deviceType, deviceId)
}

/** @deprecated 与 isDockSharedOutAirport 相同，覆盖 Dock / Dock2 / Dock3 */
export const isDock3SharedOutAirport = isDockSharedOutAirport

function suffixToKey(suffix) {
  return String(suffix || '_out').replace(/\.live\.flv$/, '') || '_out'
}

function Dock3CameraSwitcher({ cameraPosition, switching, onSelect }) {
  return (
    <div
      className="flex flex-col rounded-sm overflow-hidden border border-white/20 shadow-lg min-w-[108px]"
      role="group"
      aria-label="机场相机推流切换"
    >
      {DOCK_CAMERA_OPTIONS.map((opt) => {
        const active = cameraPosition === opt.position
        return (
          <button
            key={opt.position}
            type="button"
            disabled={switching}
            onClick={() => onSelect(opt.position)}
            className={`px-3 py-2.5 text-sm font-medium text-center transition-colors duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed border-b border-white/10 last:border-b-0 ${
              active
                ? 'bg-blue-600 text-white'
                : 'bg-gray-900/90 text-gray-200 hover:bg-gray-800/95'
            }`}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export default function LiveStreamPlayer({
  deviceId,
  deviceType,
  deviceName = '',
  regionId = '',
  mqttProfileId = '',
  dock3SharedOut: dock3SharedOutProp,
  supplementLightState,
  showSupplementLight: showSupplementLightProp,
  liveCameraPosition: liveCameraPositionProp,
}) {
  const videoRef = useRef(null)
  const flvPlayerRef = useRef(null)
  const [playSource, setPlaySource] = useState('dock')
  const [localCameraPosition, setLocalCameraPosition] = useState(null)
  const [currentStream, setCurrentStream] = useState('out')
  const [reloadKey, setReloadKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [cameraSwitching, setCameraSwitching] = useState(false)
  const [cameraHint, setCameraHint] = useState('')
  const [dock3VideoId, setDock3VideoId] = useState(null)
  const [configCameraPosition, setConfigCameraPosition] = useState(null)

  const dock3SharedOut =
    dock3SharedOutProp ?? isDock3SharedOutAirport(deviceType, deviceId)

  const showSupplementLight =
    showSupplementLightProp ?? isDockSeriesAirport(deviceType, deviceId)

  const dockOutLabel = useMemo(
    () => (deviceId ? `${deviceId}_out.live.flv` : ''),
    [deviceId],
  )

  const isDock3View = dock3SharedOut && playSource === 'dock'

  const osdCameraPosition =
    liveCameraPositionProp === 0 || liveCameraPositionProp === 1
      ? liveCameraPositionProp
      : null
  const cameraPositionRaw = localCameraPosition ?? osdCameraPosition ?? configCameraPosition
  const cameraPosition =
    cameraPositionRaw === 0 || cameraPositionRaw === 1 ? cameraPositionRaw : null

  useEffect(() => {
    if (liveCameraPositionProp === 0 || liveCameraPositionProp === 1) {
      setConfigCameraPosition(liveCameraPositionProp)
    }
  }, [liveCameraPositionProp])

  useEffect(() => {
    if (localCameraPosition !== null && osdCameraPosition === localCameraPosition) {
      setLocalCameraPosition(null)
    }
  }, [liveCameraPositionProp, localCameraPosition, osdCameraPosition])

  /** 仅「机场画面↔无人机」或手动刷新时变；舱内/舱外切换绝不改 URL */
  const streamSuffix = useMemo(() => {
    if (deviceType !== 'airport') return '_flight.live.flv'
    if (dock3SharedOut) {
      return playSource === 'flight' ? '_flight.live.flv' : '_out.live.flv'
    }
    const map = { out: '_out.live.flv', in: '_in.live.flv', flight: '_flight.live.flv' }
    return map[currentStream] || '_out.live.flv'
  }, [deviceType, dock3SharedOut, playSource, currentStream])

  const [streamUrl, setStreamUrl] = useState('')
  const streamSuffixKey = useMemo(() => suffixToKey(streamSuffix), [streamSuffix])

  useEffect(() => {
    if (!deviceId) {
      setStreamUrl('')
      return undefined
    }
    let cancelled = false
    fetchStreamUrl(deviceId, streamSuffixKey, regionId, mqttProfileId)
      .then((url) => { if (!cancelled) setStreamUrl(url) })
      .catch(() => { if (!cancelled) setStreamUrl('') })
    return () => { cancelled = true }
  }, [deviceId, streamSuffixKey, regionId, mqttProfileId, reloadKey])

  useEffect(() => {
    if (!dock3SharedOut || !deviceId) return
    fetch(`/api/live/dock3-config/${encodeURIComponent(deviceId)}`, {
      headers: { 'x-auth-token': getToken() },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.videoId) setDock3VideoId(data.videoId)
        if (data.liveCameraPosition === 0 || data.liveCameraPosition === 1) {
          setConfigCameraPosition(data.liveCameraPosition)
        }
      })
      .catch(() => {})
  }, [deviceId, dock3SharedOut])

  const requestCameraChange = useCallback(
    async (position) => {
      const res = await fetch('/api/live/camera-change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': getToken(),
        },
        body: JSON.stringify({
          deviceId,
          cameraPosition: position,
          videoId: dock3VideoId || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `切换失败 ${res.status}`)
      return data
    },
    [deviceId, dock3VideoId],
  )

  const switchDockCamera = useCallback(
    async (position) => {
      if (cameraPosition !== null && position === cameraPosition) return
      setCameraSwitching(true)
      setCameraHint('')
      try {
        await requestCameraChange(position)
        setLocalCameraPosition(position)
        setCameraHint(position === 0 ? '已切换至舱内推流' : '已切换至舱外推流')
        // 推流地址始终是 _out，不 reload 播放器
      } catch (e) {
        setCameraHint(e.message || '相机切换失败')
      } finally {
        setCameraSwitching(false)
      }
    },
    [cameraPosition, requestCameraChange],
  )

  const selectPlaySource = useCallback(
    (source) => {
      if (!dock3SharedOut) return
      setPlaySource(source)
      setCameraHint('')
      setReloadKey((k) => k + 1)
    },
    [dock3SharedOut],
  )

  const selectLegacyStream = useCallback((streamId) => {
    setCurrentStream(streamId)
    setReloadKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!videoRef.current || !deviceId || !streamUrl) return undefined

    let cancelled = false
    const cleanup = () => {
      if (flvPlayerRef.current) {
        flvPlayerRef.current.destroy()
        flvPlayerRef.current = null
      }
    }

    const loadStream = async () => {
      cleanup()
      setIsLoading(true)
      setHasError(false)

      if (!flvjs.isSupported()) {
        setHasError(true)
        setIsLoading(false)
        return
      }

      const url = streamUrl
      const flvPlayer = flvjs.createPlayer(
        {
          type: 'flv',
          url,
          isLive: true,
          hasAudio: false,
          hasVideo: true,
          cors: true,
        },
        {
          enableStashBuffer: false,
          stashInitialSize: 128,
        },
      )

      flvPlayer.attachMediaElement(videoRef.current)

      const onPlaying = () => {
        if (!cancelled) setIsLoading(false)
      }
      const onError = () => {
        if (!cancelled) {
          setHasError(true)
          setIsLoading(false)
        }
      }

      videoRef.current.addEventListener('playing', onPlaying)
      videoRef.current.addEventListener('error', onError)

      try {
        await flvPlayer.load()
        await flvPlayer.play()
        if (!cancelled) flvPlayerRef.current = flvPlayer
      } catch (error) {
        console.error('Failed to load stream:', error)
        if (!cancelled) {
          setHasError(true)
          setIsLoading(false)
        }
      }

      const loadTimeout = window.setTimeout(() => {
        if (!cancelled) setIsLoading(false)
      }, 12000)

      return () => {
        videoRef.current?.removeEventListener('playing', onPlaying)
        videoRef.current?.removeEventListener('error', onError)
        window.clearTimeout(loadTimeout)
      }
    }

    let teardownListeners = () => {}
    loadStream().then((fn) => {
      teardownListeners = fn || (() => {})
    })

    return () => {
      cancelled = true
      teardownListeners()
      cleanup()
    }
  }, [deviceId, streamUrl, reloadKey])

  const handleRetry = () => {
    setHasError(false)
    setReloadKey((k) => k + 1)
  }

  const statusLabel = isDock3View
    ? cameraPosition === 0 || cameraPosition === 1
      ? DOCK_CAMERA_OPTIONS.find((o) => o.position === cameraPosition)?.label
      : '未知'
    : { out: '外部监控', in: '内部监控', flight: '无人机画面' }[currentStream]

  return (
    <div className="bg-black rounded-lg overflow-hidden">
      <div className="flex items-center justify-between bg-gray-800 px-4 py-2 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Video className="text-white shrink-0" size={20} />
          <span className="text-white font-medium">实时监控</span>
        </div>
        {dock3SharedOut ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => selectPlaySource('dock')}
              className={`px-3 py-1 text-sm rounded transition-colors cursor-pointer ${
                playSource === 'dock'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              机场画面
            </button>
            <button
              type="button"
              onClick={() => selectPlaySource('flight')}
              className={`px-3 py-1 text-sm rounded transition-colors cursor-pointer inline-flex items-center gap-1 ${
                playSource === 'flight'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              <Plane size={14} aria-hidden />
              无人机
            </button>
          </div>
        ) : (
          deviceType === 'airport' && (
            <div className="flex gap-1 flex-wrap justify-end">
              {['out', 'in', 'flight'].map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectLegacyStream(id)}
                  className={`px-3 py-1 text-sm rounded transition-colors cursor-pointer ${
                    currentStream === id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {{ out: '外部监控', in: '内部监控', flight: '无人机画面' }[id]}
                </button>
              ))}
            </div>
          )
        )}
      </div>

      <div className="relative aspect-video bg-gray-900">
        <video ref={videoRef} className="w-full h-full" muted autoPlay playsInline />

        {showSupplementLight && deviceType === 'airport' && !(dock3SharedOut && playSource === 'flight') && (
          <div className="absolute top-3 left-3 z-20">
            <SupplementLightControl
              deviceId={deviceId}
              supplementLightState={supplementLightState}
            />
          </div>
        )}

        {isDock3View && (
          <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-2">
            <button
              type="button"
              onClick={handleRetry}
              disabled={cameraSwitching}
              className="p-2 rounded bg-gray-900/85 text-white border border-white/15 hover:bg-gray-800 transition-colors cursor-pointer disabled:opacity-50"
              title="刷新画面（仍使用 _out 地址）"
              aria-label="刷新画面"
            >
              <RefreshCw size={18} className={cameraSwitching ? 'animate-spin' : ''} />
            </button>
            <Dock3CameraSwitcher
              cameraPosition={cameraPosition}
              switching={cameraSwitching}
              onSelect={switchDockCamera}
            />
            {cameraSwitching && (
              <span className="text-xs text-amber-200 bg-black/70 px-2 py-1 rounded">
                切换相机中…
              </span>
            )}
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/75 z-10 pointer-events-none">
            <RefreshCw className="text-blue-500 animate-spin" size={48} />
            <p className="text-white mt-4 text-sm">正在连接直播流…</p>
          </div>
        )}

        {hasError && !isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/75 z-10">
            <VideoOff className="text-red-500" size={48} />
            <p className="text-white mt-4 text-sm">无法连接直播流</p>
            <p className="text-gray-400 text-xs mt-2 font-mono break-all px-4 text-center">{streamUrl}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors cursor-pointer"
            >
              重试
            </button>
          </div>
        )}
      </div>

      <div className="bg-gray-800 px-4 py-2 flex flex-col gap-1 text-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-gray-400">
            {isDock3View ? (
              <>
                推流地址固定 <span className="text-gray-300 font-mono text-xs">{dockOutLabel}</span>
                <span className="mx-1">·</span>
                当前相机 <span className="text-gray-300">{statusLabel}</span>
              </>
            ) : (
              <>当前: {statusLabel}</>
            )}
          </span>
          <span className="text-gray-500 text-xs font-mono shrink-0">{deviceId}</span>
        </div>
        {cameraHint && (
          <p className="text-amber-400/90 text-xs">{cameraHint}</p>
        )}
      </div>
    </div>
  )
}
