import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import flvjs from 'flv.js'
import { Video, VideoOff, RefreshCw, Plane } from 'lucide-react'
import { fetchStreamUrl } from '../lib/stream-url'

const NON_DOCK_TYPES = new Set(['drone', 'single', 'remote', 'airport_drone'])

export function isDockSharedOutAirport(deviceType, deviceId) {
  const id = String(deviceId || '').trim()
  if (!id || id.startsWith('NEST')) return false
  const type = String(deviceType || '').toLowerCase()
  if (NON_DOCK_TYPES.has(type)) return false
  return true
}

/** @deprecated 与 isDockSharedOutAirport 相同，覆盖 Dock / Dock2 / Dock3 */
export const isDock3SharedOutAirport = isDockSharedOutAirport

function suffixToKey(suffix) {
  return String(suffix || '_out').replace(/\.live\.flv$/, '') || '_out'
}

export default function LiveStreamPlayer({
  deviceId,
  deviceType,
  deviceName = '',
  regionId = '',
  mqttProfileId = '',
  dock3SharedOut: dock3SharedOutProp,
}) {
  const videoRef = useRef(null)
  const flvPlayerRef = useRef(null)
  const [playSource, setPlaySource] = useState('dock')
  const [currentStream, setCurrentStream] = useState('out')
  const [reloadKey, setReloadKey] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  const dock3SharedOut =
    dock3SharedOutProp ?? isDock3SharedOutAirport(deviceType, deviceId)

  const dockOutLabel = useMemo(
    () => (deviceId ? `${deviceId}_out.live.flv` : ''),
    [deviceId],
  )

  const isDock3View = dock3SharedOut && playSource === 'dock'

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

  const selectPlaySource = useCallback(
    (source) => {
      if (!dock3SharedOut) return
      setPlaySource(source)
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
    ? '机场画面'
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

        {isDock3View && (
          <div className="absolute top-3 right-3 z-20">
            <button
              type="button"
              onClick={handleRetry}
              className="p-2 rounded bg-gray-900/85 text-white border border-white/15 hover:bg-gray-800 transition-colors cursor-pointer"
              title="刷新画面"
              aria-label="刷新画面"
            >
              <RefreshCw size={18} />
            </button>
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
                推流地址 <span className="text-gray-300 font-mono text-xs">{dockOutLabel}</span>
                <span className="mx-1">·</span>
                当前: <span className="text-gray-300">{statusLabel}</span>
              </>
            ) : (
              <>当前: {statusLabel}</>
            )}
          </span>
          <span className="text-gray-500 text-xs font-mono shrink-0">{deviceId}</span>
        </div>
      </div>
    </div>
  )
}
