import { useEffect, useRef, useState } from 'react'
import flvjs from 'flv.js'
import { Video, VideoOff, RefreshCw } from 'lucide-react'

export default function LiveStreamPlayer({ deviceId, deviceType }) {
  const videoRef = useRef(null)
  const flvPlayerRef = useRef(null)
  const [currentStream, setCurrentStream] = useState('out')
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  const streams = deviceType === 'airport' ? [
    { id: 'out', label: '外部监控', suffix: '_out.live.flv' },
    { id: 'in', label: '内部监控', suffix: '_in.live.flv' },
    { id: 'flight', label: '无人机画面', suffix: '_flight.live.flv' }
  ] : [
    { id: 'flight', label: '无人机画面', suffix: '_flight.live.flv' }
  ]

  const getStreamUrl = (streamType) => {
    return `https://whgadkjw.weihai.cn/live/${deviceId}${streams.find(s => s.id === streamType)?.suffix || ''}`
  }

  useEffect(() => {
    if (!videoRef.current) return

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

      const streamUrl = getStreamUrl(currentStream)

      if (flvjs.isSupported()) {
        const flvPlayer = flvjs.createPlayer({
          type: 'flv',
          url: streamUrl,
          isLive: true,
          hasAudio: false,
          hasVideo: true,
          cors: true
        })

        flvPlayer.attachMediaElement(videoRef.current)
        
        try {
          await flvPlayer.load()
          await flvPlayer.play()
          flvPlayerRef.current = flvPlayer
          setIsLoading(false)
        } catch (error) {
          console.error('Failed to load stream:', error)
          setHasError(true)
          setIsLoading(false)
        }
      } else {
        console.error('FLV is not supported')
        setHasError(true)
        setIsLoading(false)
      }
    }

    loadStream()

    return () => {
      cleanup()
    }
  }, [deviceId, currentStream, deviceType])

  const handleRetry = () => {
    if (flvPlayerRef.current) {
      flvPlayerRef.current.destroy()
      flvPlayerRef.current = null
    }
    setIsLoading(true)
    setHasError(false)
  }

  return (
    <div className="bg-black rounded-lg overflow-hidden">
      <div className="flex items-center justify-between bg-gray-800 px-4 py-2">
        <div className="flex items-center gap-2">
          <Video className="text-white" size={20} />
          <span className="text-white font-medium">实时监控</span>
        </div>
        {streams.length > 1 && (
          <div className="flex gap-1">
            {streams.map(stream => (
              <button
                key={stream.id}
                onClick={() => setCurrentStream(stream.id)}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  currentStream === stream.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {stream.label}
              </button>
            ))}
          </div>
        )}
      </div>
      
      <div className="relative aspect-video bg-gray-900">
        <video
          ref={videoRef}
          className="w-full h-full"
          muted
          autoPlay
          playsInline
        />
        
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 bg-opacity-75">
            <RefreshCw className="text-blue-500 animate-spin" size={48} />
            <p className="text-white mt-4">正在连接直播流...</p>
          </div>
        )}
        
        {hasError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 bg-opacity-75">
            <VideoOff className="text-red-500" size={48} />
            <p className="text-white mt-4">无法连接直播流</p>
            <button
              onClick={handleRetry}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              重试
            </button>
          </div>
        )}
      </div>
      
      <div className="bg-gray-800 px-4 py-2 flex items-center justify-between">
        <span className="text-gray-400 text-sm">
          当前: {streams.find(s => s.id === currentStream)?.label}
        </span>
        <span className="text-gray-400 text-sm">
          {deviceId}
        </span>
      </div>
    </div>
  )
}
