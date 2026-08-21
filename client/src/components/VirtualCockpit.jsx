import { useState, useEffect, useRef } from 'react'
import flvjs from 'flv.js'
import { X, Signal, Battery, Satellite, Wind, Thermometer, Home, MapPin, Wifi, Maximize2, Boxes, Siren, Bell, PanelLeft, Keyboard, Filter, Search, Sparkles, Settings, Camera, Loader2, ChevronLeft, ChevronRight, Brain, Activity, ScanEye } from 'lucide-react'
import LogoMark from './LogoMark'
import { fetchStreamUrl } from '../lib/stream-url'
import { deviceStreamQueryParams } from '../lib/scope-query'
import { attachFlvSeiTap } from '../lib/flv-sei-tap'
const CESIUM_TK = '9eb56d3fe1e23a9bf19af660b3a9e37c'
const TEST_VIDEO_URL = '/api/proxy-video'

/** 机载 AI 模型：仅使用 drc_ai_info_push 上报的列表（无固定人/车/船兜底） */
function normalizeDockAiModels(info) {
  const list = Array.isArray(info?.models) ? info.models : []
  return list
    .map((m, i) => {
      const index = Number.isFinite(Number(m.index)) ? Number(m.index) : i
      const name = String(m.signedName || m.name || `模型 ${index}`).trim()
      if (!name) return null
      return { index, name }
    })
    .filter(Boolean)
}

function getAuthToken() {
  return localStorage.getItem('auth_token') || ''
}

function resolveDockGatewaySn(device) {
  if (!device) return ''
  if (device.deviceType === 'airport') return device.deviceId
  return device.gateway || device.deviceId || ''
}

function CesiumMap({ lat, lng, label, alertMode = false }) {
  const containerRef = useRef(null)
  const viewerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return

    function initCesium() {
      const Cesium = window.Cesium
      if (!Cesium) return

      Cesium.Ion.defaultAccessToken = undefined

      const viewer = new Cesium.Viewer(containerRef.current, {
        baseLayerPicker: false, geocoder: false, homeButton: false,
        sceneModePicker: false, navigationHelpButton: false,
        animation: false, timeline: false, fullscreenButton: false,
        infoBox: false, selectionIndicator: false,
        imageryProvider: false,
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        sceneMode: Cesium.SceneMode.SCENE3D,
      })

      // 隐藏 Cesium logo 和底部信用
      viewer.cesiumWidget.creditContainer.style.display = 'none'

      // 天地图卫星底图（与 b3dm-viewer.html 一致）
      viewer.imageryLayers.addImageryProvider(
        new Cesium.WebMapTileServiceImageryProvider({
          url: `https://t{s}.tianditu.gov.cn/img_w/wmts?tk=${CESIUM_TK}`,
          layer: 'img', style: 'default', tileMatrixSetID: 'w', format: 'tiles',
          subdomains: ['0','1','2','3','4','5','6','7'],
          tilingScheme: new Cesium.WebMercatorTilingScheme(), maximumLevel: 18
        })
      )
      viewer.imageryLayers.addImageryProvider(
        new Cesium.WebMapTileServiceImageryProvider({
          url: `https://t{s}.tianditu.gov.cn/cia_w/wmts?tk=${CESIUM_TK}`,
          layer: 'cia', style: 'default', tileMatrixSetID: 'w', format: 'tiles',
          subdomains: ['0','1','2','3','4','5','6','7'],
          tilingScheme: new Cesium.WebMercatorTilingScheme(), maximumLevel: 18
        })
      )

      // 告警模式下使用更高的缩放级别（更低的相机高度）
      const cameraHeight = alertMode ? 150 : 400
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(lng, lat, cameraHeight),
        orientation: { pitch: Cesium.Math.toRadians(-60) },
        duration: 0
      })

      // 标注点 - 告警模式下使用特殊样式
      const markerColor = alertMode ? '#f59e0b' : '#ef4444'
      const markerScale = alertMode ? 1.5 : 1.2
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lng, lat, 5),
        billboard: {
          image: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="32" viewBox="0 0 24 32">' +
            `<path d="M12 0C7.58 0 4 3.58 4 8c0 6 8 24 8 24s8-18 8-24C20 3.58 16.42 0 12 0z" fill="${markerColor}"/>` +
            '<circle cx="12" cy="8" r="4" fill="white"/></svg>'
          ),
          verticalOrigin: 1, // BOTTOM
          heightReference: 0,
          scale: markerScale
        },
        label: {
          text: alertMode ? `⚠️ ${label}` : label,
          font: alertMode ? 'bold 14px Microsoft YaHei, sans-serif' : '13px Microsoft YaHei, sans-serif',
          fillColor: alertMode ? Cesium.Color.fromCssColorString('#f59e0b') : Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: 1, // FILL_AND_OUTLINE
          pixelOffset: new Cesium.Cartesian2(0, -40),
          heightReference: 0,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      })

      viewerRef.current = viewer
    }

    if (window.Cesium) {
      initCesium()
    } else {
      // 加载 Cesium CSS
      if (!document.getElementById('cesium-css')) {
        const link = document.createElement('link')
        link.id = 'cesium-css'
        link.rel = 'stylesheet'
        link.href = 'https://cesium.com/downloads/cesiumjs/releases/1.115/Build/Cesium/Widgets/widgets.css'
        document.head.appendChild(link)
      }
      const script = document.createElement('script')
      script.src = 'https://cesium.com/downloads/cesiumjs/releases/1.115/Build/Cesium/Cesium.js'
      script.onload = () => setTimeout(initCesium, 100)
      document.head.appendChild(script)
    }

    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }
    }
  }, [lat, lng, label])

  return <div ref={containerRef} className="w-full h-full" />
}

function getObjectContainRect(video, boxW, boxH) {
  const vw = video?.videoWidth || 0
  const vh = video?.videoHeight || 0
  if (!vw || !vh || !boxW || !boxH) return null
  const scale = Math.min(boxW / vw, boxH / vh)
  const w = vw * scale
  const h = vh * scale
  return {
    left: (boxW - w) / 2,
    top: (boxH - h) / 2,
    width: w,
    height: h,
  }
}

/** 万分比中心框 → canvas 像素矩形 */
function targetToCanvasRect(t, content) {
  const x1 = ((t.cx - t.w / 2) / 10000) * content.width + content.left
  const y1 = ((t.cy - t.h / 2) / 10000) * content.height + content.top
  const x2 = ((t.cx + t.w / 2) / 10000) * content.width + content.left
  const y2 = ((t.cy + t.h / 2) / 10000) * content.height + content.top
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  }
}

function FlvPlayer({ url, className = '', isMainStream = false, seiEnabled = false, onAiTargets, onSeiStatus }) {
  const videoRef = useRef(null)
  const playerRef = useRef(null)
  const seiDetachRef = useRef(null)
  const onAiTargetsRef = useRef(onAiTargets)
  const onSeiStatusRef = useRef(onSeiStatus)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const timeoutRef = useRef(null)
  const hasDataRef = useRef(false)

  useEffect(() => {
    onAiTargetsRef.current = onAiTargets
  }, [onAiTargets])

  useEffect(() => {
    onSeiStatusRef.current = onSeiStatus
  }, [onSeiStatus])

  useEffect(() => {
    if (!url || !videoRef.current) return undefined
    setError(false)
    setLoading(true)
    hasDataRef.current = false

    if (seiDetachRef.current) {
      seiDetachRef.current()
      seiDetachRef.current = null
    }
    if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null }

    if (!flvjs.isSupported()) { setError(true); return undefined }

    // enableWorker 必须为 false，才能挂钩 demuxer 抽 SEI
    const player = flvjs.createPlayer(
      { type: 'flv', url, isLive: true, hasAudio: false, cors: true },
      { enableWorker: false },
    )
    player.attachMediaElement(videoRef.current)
    player.load()
    player.play().catch(() => {})

    if (seiEnabled) {
      seiDetachRef.current = attachFlvSeiTap(
        player,
        (targets) => { onAiTargetsRef.current?.(targets) },
        (status) => { onSeiStatusRef.current?.(status) },
      )
    }

    timeoutRef.current = setTimeout(() => {
      if (!hasDataRef.current) {
        console.log('FLV 3秒超时，切换到本地视频')
        setError(true)
        if (seiDetachRef.current) {
          seiDetachRef.current()
          seiDetachRef.current = null
        }
        if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null }
      }
    }, 3000)

    player.on(flvjs.Events.ERROR, () => {
      clearTimeout(timeoutRef.current)
      setError(true)
    })

    player.on(flvjs.Events.METADATA_ARRIVED, () => {
      hasDataRef.current = true
      clearTimeout(timeoutRef.current)
      setLoading(false)
    })

    player.on(flvjs.Events.STATISTICS_INFO, () => {
      if (!hasDataRef.current) {
        hasDataRef.current = true
        clearTimeout(timeoutRef.current)
        setLoading(false)
      }
    })

    playerRef.current = player

    return () => {
      clearTimeout(timeoutRef.current)
      if (seiDetachRef.current) {
        seiDetachRef.current()
        seiDetachRef.current = null
      }
      if (playerRef.current) { playerRef.current.destroy(); playerRef.current = null }
    }
  }, [url, seiEnabled])

  return (
    <div className={`relative bg-black flex items-center justify-center overflow-hidden ${className}`}>
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {error ? (
        <video
          className="w-full h-full object-contain"
          src={TEST_VIDEO_URL}
          crossOrigin="anonymous"
          data-main-stream={isMainStream ? "true" : undefined}
          muted
          autoPlay
          loop
          playsInline
          onEnded={(e) => { e.target.currentTime = 0; e.target.play() }}
        />
      ) : (
        <video
          ref={videoRef}
          crossOrigin="anonymous"
          data-main-stream={isMainStream ? "true" : undefined}
          className="w-full h-full object-contain"
          muted
          playsInline
          onLoadedData={() => setLoading(false)}
        />
      )}
    </div>
  )
}

export default function VirtualCockpit({ device, onClose }) {
  const deviceId = device.deviceId
  const { regionId, mqttProfileId } = deviceStreamQueryParams(device)
  // 'flight' | 'out' | 'in' | 'map'
  const [mainView, setMainView] = useState('flight')
  const [mapPanelView, setMapPanelView] = useState('map')
  const [bottomStream, setBottomStream] = useState('out')
  const [bottomPanelView, setBottomPanelView] = useState('out')
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)
  const [showVirtualKeyboard, setShowVirtualKeyboard] = useState(true)
  const [showAiAlertPanel, setShowAiAlertPanel] = useState(false)
  const [showAiSearch, setShowAiSearch] = useState(false)
  const [showDockAiPanel, setShowDockAiPanel] = useState(false)
  const [dockAiInfo, setDockAiInfo] = useState(null)
  const [dockAiBusy, setDockAiBusy] = useState(false)
  const [dockAiHint, setDockAiHint] = useState('')
  const [dockAiTargetCount, setDockAiTargetCount] = useState(0)
  const [dockSeiStatus, setDockSeiStatus] = useState(null)
  const [dockTracking, setDockTracking] = useState(false)
  const [dockTrackIndex, setDockTrackIndex] = useState(null)
  const [dockDrcStatus, setDockDrcStatus] = useState(null)
  const [dockDrcConnected, setDockDrcConnected] = useState(false)
  const dockAiTargetsRef = useRef([])
  const dockTrackIndexRef = useRef(null)
  const dockAiCanvasRef = useRef(null)

  const handleDockAiTargets = (targets) => {
    const list = Array.isArray(targets) ? targets : []
    dockAiTargetsRef.current = list
    setDockAiTargetCount((n) => (n === list.length ? n : list.length))
  }

  const handleDockSeiStatus = (status) => {
    setDockSeiStatus(status || null)
  }

  const syncDockTrackState = (info) => {
    if (!info) return
    const tracking = !!info.spotlightTracking
    const idx = Number.isInteger(Number(info.spotlightTargetIndex))
      ? Number(info.spotlightTargetIndex)
      : null
    setDockTracking(tracking)
    setDockTrackIndex(tracking ? idx : null)
    dockTrackIndexRef.current = tracking ? idx : null
  }
  const [customStreamUrl, setCustomStreamUrl] = useState('')
  const [customStreamInput, setCustomStreamInput] = useState('')
  // AI搜索标签（多模态提示词）
  const [aiSearchTags, setAiSearchTags] = useState(['大型', '机械结构', '用于工程作业'])
  const [tagInput, setTagInput] = useState('')
  const [captureInterval, setCaptureInterval] = useState(3)
  const [lastTokenUsage, setLastTokenUsage] = useState(null)
  const [totalTokenUsage, setTotalTokenUsage] = useState(0)
  const [streams, setStreams] = useState({ out: '', in: '', flight: '' })
  // AI多模态模型选择
  const [aiModel, setAiModel] = useState('qwen3-vl-flash')
  const [aiModels, setAiModels] = useState([
    { value: 'qwen3-vl-flash', label: 'Qwen3-VL-Flash (轻量快速)', description: '剩150,950/共1,000,000', remaining: 150950, total: 1000000 },
    { value: 'qwen3-vl-flash-2026-01-22', label: 'Qwen3-VL-Flash 2026-01-22', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-flash-2025-10-15', label: 'Qwen3-VL-Flash 2025-10-15', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-plus', label: 'Qwen3-VL-Plus (更强能力)', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-plus-2025-09-23', label: 'Qwen3-VL-Plus 2025-09-23', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-plus-2025-12-19', label: 'Qwen3-VL-Plus 2025-12-19', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-235b-a22b-instruct', label: 'Qwen3-VL-235B (最大)', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-235b-a22b-thinking', label: 'Qwen3-VL-235B-Thinking (推理)', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-32b-instruct', label: 'Qwen3-VL-32B', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-32b-thinking', label: 'Qwen3-VL-32B-Thinking', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-30b-a3b-instruct', label: 'Qwen3-VL-30B-A3B', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-8b-a3b-instruct', label: 'Qwen3-VL-8B-A3B', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-7b-a2b-instruct', label: 'Qwen3-VL-7B-A2B', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 },
    { value: 'qwen3-vl-4b-a2b-thinking', label: 'Qwen3-VL-4B-Thinking', description: '剩1,000,000/共1,000,000', remaining: 1000000, total: 1000000 }
  ])

  // 页面加载时读取所有模型的额度记录
  useEffect(() => {
    fetch('/api/ai/token-usage')
      .then(res => res.json())
      .then(data => {
        setAiModels(prev => prev.map(m => {
          const saved = data[m.value]
          if (!saved) return m
          return {
            ...m,
            total: saved.total || m.total,
            remaining: saved.remaining ?? m.remaining,
            description: `剩${(saved.remaining ?? m.remaining).toLocaleString()}/共${(saved.total || m.total).toLocaleString()}`
          }
        }))
        console.log('[AI额度] 已加载所有模型额度:', Object.keys(data).join(', '))
      })
      .catch(err => console.error('[AI额度] 加载额度记录失败:', err))
  }, [])

  const [aiAlerts, setAiAlerts] = useState([])
  const [activeAlert, setActiveAlert] = useState(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [showAlertDetail, setShowAlertDetail] = useState(false)
  const [detailIndex, setDetailIndex] = useState(0)
  const [showAlertInMap, setShowAlertInMap] = useState(false)
  const [mapAlertIndex, setMapAlertIndex] = useState(0)
  const mapCanvasRef = useRef(null)
  const [drawMode, setDrawMode] = useState('frontend')
  // 图片缩放和拖动状态
  const [imageZoom, setImageZoom] = useState(1)
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const captureTimerRef = useRef(null)
  const canvasRef = useRef(null)
  const detailCanvasRef = useRef(null)
  const metrics = device.metrics || {}
  const dockGatewaySn = resolveDockGatewaySn(device)
  const dockAiModels = normalizeDockAiModels(dockAiInfo)
  const dockIdentifyOn = Number(dockAiInfo?.identifyOn) === 1
  const dockSelectedIndex = Number.isInteger(Number(dockAiInfo?.selectedIndex))
    ? Number(dockAiInfo.selectedIndex)
    : null
  // 机场绑定无人机是否开机/在线（OSD sub_device.device_online_status）
  const dockDroneOnline =
    Number(device?.osdSnapshot?.sub_device?.device_online_status) === 1
    || Number(metrics?.subDeviceOnline?.value) === 1
  const dockAiDisabledReason = dockDroneOnline ? '' : '绑定无人机未开机，AI识别不可用'

  // 识别关时清空框；开时按 SEI 目标叠画（object-contain 对齐）
  useEffect(() => {
    if (!dockIdentifyOn) {
      dockAiTargetsRef.current = []
      setDockAiTargetCount(0)
      // 关识别时若仍在跟随，下发停止
      if (dockTracking && dockGatewaySn) {
        fetch('/api/drc/ai-spotlight-stop', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-auth-token': getAuthToken(),
          },
          body: JSON.stringify({ deviceId: dockGatewaySn }),
        }).catch(() => {})
      }
      setDockTracking(false)
      setDockTrackIndex(null)
      dockTrackIndexRef.current = null
      const canvas = dockAiCanvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }, [dockIdentifyOn])

  useEffect(() => {
    const canvas = dockAiCanvasRef.current
    if (!canvas || mainView !== 'flight' || !dockIdentifyOn) return undefined

    let raf = 0
    const paint = () => {
      const parent = canvas.parentElement
      if (!parent) return
      const cw = parent.clientWidth
      const ch = parent.clientHeight
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, cw, ch)

      const targets = dockAiTargetsRef.current
      if (!targets.length) return

      const video = parent.querySelector('video[data-main-stream="true"]')
        || parent.querySelector('video')
      const content = getObjectContainRect(video, cw, ch)
      if (!content) return

      const trackIdx = dockTrackIndexRef.current
      for (const t of targets) {
        const r = targetToCanvasRect(t, content)
        if (r.w < 2 || r.h < 2) continue
        const isTrack = trackIdx != null && Number(t.targetIndex) === Number(trackIdx)
        ctx.strokeStyle = isTrack ? '#f59e0b' : '#22c55e'
        ctx.lineWidth = isTrack ? 3 : 2
        ctx.strokeRect(r.x, r.y, r.w, r.h)

        const distM = Number.isFinite(t.distanceMm) ? (t.distanceMm / 1000).toFixed(1) : null
        const base = distM ? `${t.label} ${distM}m` : t.label
        const label = isTrack ? `跟随 · ${base}` : base
        ctx.font = '12px sans-serif'
        const tw = ctx.measureText(label).width + 8
        const ty = Math.max(14, r.y - 2)
        ctx.fillStyle = isTrack ? 'rgba(245,158,11,0.95)' : 'rgba(34,197,94,0.9)'
        ctx.fillRect(r.x, ty - 14, tw, 16)
        ctx.fillStyle = '#fff'
        ctx.fillText(label, r.x + 4, ty - 2)
      }
    }

    const loop = () => {
      paint()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [dockIdentifyOn, mainView])

  const refreshDockAiInfo = async () => {
    if (!dockGatewaySn) return
    try {
      const res = await fetch(`/api/drc/ai-info/${encodeURIComponent(dockGatewaySn)}`, {
        headers: { 'x-auth-token': getAuthToken() },
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `加载失败 ${res.status}`)
      setDockAiInfo(data.info || null)
      syncDockTrackState(data.info)
      if (data.drcStatus) setDockDrcStatus(data.drcStatus)
      setDockDrcConnected(!!data.drcConnected)
      if (data.hint) setDockAiHint(data.hint)
      else if (!data.info?.models?.length) setDockAiHint('')
      else setDockAiHint('')
    } catch (e) {
      setDockAiHint(e.message || '加载机载 AI 状态失败')
    }
  }

  const enterDockDrc = async () => {
    if (!dockGatewaySn || dockAiBusy) return
    setDockAiBusy(true)
    setDockAiHint('')
    try {
      const res = await fetch('/api/drc/mode-enter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': getAuthToken(),
        },
        body: JSON.stringify({ deviceId: dockGatewaySn }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.hint || `进入 DRC 失败 ${res.status}`)
      if (data.drcStatus) setDockDrcStatus(data.drcStatus)
      setDockAiHint(data.hint || '已下发进入 DRC，等待 status=已连接…')
      // 进入后稍等再拉一次模型列表
      setTimeout(() => { refreshDockAiInfo() }, 2000)
    } catch (e) {
      setDockAiHint(e.message || '进入 DRC 失败')
    } finally {
      setDockAiBusy(false)
    }
  }

  const exitDockDrc = async () => {
    if (!dockGatewaySn || dockAiBusy) return
    setDockAiBusy(true)
    setDockAiHint('')
    try {
      const res = await fetch('/api/drc/mode-exit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': getAuthToken(),
        },
        body: JSON.stringify({ deviceId: dockGatewaySn }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `退出 DRC 失败 ${res.status}`)
      if (data.drcStatus) {
        setDockDrcStatus(data.drcStatus)
        setDockDrcConnected(Number(data.drcStatus.drcState) === 2)
      } else {
        setDockDrcConnected(false)
      }
      setDockAiHint('已退出 DRC')
    } catch (e) {
      setDockAiHint(e.message || '退出 DRC 失败')
    } finally {
      setDockAiBusy(false)
    }
  }

  const setDockIdentify = async (on) => {
    if (!dockGatewaySn || dockAiBusy) return
    if (on && !dockDroneOnline) {
      setDockAiHint(dockAiDisabledReason || '绑定无人机未开机，无法开启 AI 识别')
      return
    }
    setDockAiBusy(true)
    setDockAiHint('')
    try {
      const res = await fetch('/api/drc/ai-identify-set', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': getAuthToken(),
        },
        body: JSON.stringify({ deviceId: dockGatewaySn, on: on ? 1 : 0 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.hint || `操作失败 ${res.status}`)
      if (data.info) {
        setDockAiInfo(data.info)
        syncDockTrackState(data.info)
      }
      setDockAiHint(on ? '已开启 AI 识别 · 点击检测框可跟随目标' : '已关闭 AI 识别')
    } catch (e) {
      setDockAiHint(e.message || '识别开关下发失败')
    } finally {
      setDockAiBusy(false)
    }
  }

  const selectDockAiModel = async (index) => {
    if (!dockGatewaySn || dockAiBusy) return
    if (!dockDroneOnline) {
      setDockAiHint(dockAiDisabledReason || '绑定无人机未开机')
      return
    }
    if (!dockIdentifyOn) {
      setDockAiHint('请先打开 AI 识别开关')
      return
    }
    const prevInfo = dockAiInfo
    setDockAiInfo((prev) => ({
      ...(prev || { gatewaySn: dockGatewaySn, models: dockAiModels }),
      selectedIndex: index,
      updatedAt: new Date().toISOString(),
    }))
    setDockAiBusy(true)
    setDockAiHint('')
    try {
      const res = await fetch('/api/drc/ai-model-select', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': getAuthToken(),
        },
        body: JSON.stringify({ deviceId: dockGatewaySn, index }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.hint || `选择失败 ${res.status}`)
      if (data.info) {
        setDockAiInfo(data.info)
        syncDockTrackState(data.info)
      }
      const name = dockAiModels.find((m) => m.index === index)?.name || `模型 ${index}`
      const timeoutNote = data.reply?.timedOut || data.timedOut ? '（设备未回包，已按已下发处理）' : ''
      setDockAiHint(`已选择模型：${name}${timeoutNote}`)
    } catch (e) {
      setDockAiInfo(prevInfo)
      setDockAiHint(e.message || '模型选择下发失败')
    } finally {
      setDockAiBusy(false)
    }
  }

  const startDockSpotlightTrack = async (targetIndex) => {
    if (!dockGatewaySn || dockAiBusy) return
    if (!dockDroneOnline) {
      setDockAiHint(dockAiDisabledReason || '绑定无人机未开机')
      return
    }
    if (!dockIdentifyOn) {
      setDockAiHint('请先打开 AI 识别开关')
      return
    }
    const idx = Number(targetIndex)
    if (!Number.isInteger(idx) || idx < 0) {
      setDockAiHint('无效目标 index')
      return
    }
    setDockAiBusy(true)
    setDockAiHint('')
    // 乐观：先高亮
    setDockTracking(true)
    setDockTrackIndex(idx)
    dockTrackIndexRef.current = idx
    try {
      const res = await fetch('/api/drc/ai-spotlight-track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': getAuthToken(),
        },
        body: JSON.stringify({ deviceId: dockGatewaySn, targetIndex: idx }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.hint || `跟随失败 ${res.status}`)
      if (data.info) {
        setDockAiInfo(data.info)
        syncDockTrackState(data.info)
      }
      const t = dockAiTargetsRef.current.find((x) => Number(x.targetIndex) === idx)
      const timeoutNote = data.timedOut ? '（设备未回包，已按已下发处理）' : ''
      setDockAiHint(`已跟随目标 #${idx}${t ? `（${t.label}）` : ''}${timeoutNote}`)
    } catch (e) {
      setDockTracking(false)
      setDockTrackIndex(null)
      dockTrackIndexRef.current = null
      setDockAiHint(e.message || '目标跟随下发失败')
    } finally {
      setDockAiBusy(false)
    }
  }

  const stopDockSpotlightTrack = async () => {
    if (!dockGatewaySn || dockAiBusy) return
    setDockAiBusy(true)
    setDockAiHint('')
    try {
      const res = await fetch('/api/drc/ai-spotlight-stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': getAuthToken(),
        },
        body: JSON.stringify({ deviceId: dockGatewaySn }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.hint || `停止失败 ${res.status}`)
      if (data.info) {
        setDockAiInfo(data.info)
        syncDockTrackState(data.info)
      } else {
        setDockTracking(false)
        setDockTrackIndex(null)
        dockTrackIndexRef.current = null
      }
      setDockAiHint('已停止目标跟随')
    } catch (e) {
      setDockAiHint(e.message || '停止跟随下发失败')
    } finally {
      setDockAiBusy(false)
    }
  }

  const onDockAiCanvasClick = (e) => {
    if (!dockDroneOnline || !dockIdentifyOn || dockAiBusy || mainView !== 'flight') return
    const canvas = dockAiCanvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const video = parent.querySelector('video[data-main-stream="true"]')
      || parent.querySelector('video')
    const content = getObjectContainRect(video, canvas.clientWidth, canvas.clientHeight)
    if (!content) return

    const targets = dockAiTargetsRef.current
    // 后画的在上层，从后往前命中
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i]
      const r = targetToCanvasRect(t, content)
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        startDockSpotlightTrack(t.targetIndex)
        return
      }
    }
  }

  useEffect(() => {
    if (!showDockAiPanel) return undefined
    refreshDockAiInfo()
    const timer = setInterval(refreshDockAiInfo, 3000)
    return () => clearInterval(timer)
  }, [showDockAiPanel, dockGatewaySn])

  // 实时接收 drc_ai_info_push → WS → 更新模型列表
  useEffect(() => {
    if (!dockGatewaySn) return undefined
    const onPush = (ev) => {
      const data = ev?.detail
      const sn = String(data?.gatewaySn || data?.deviceId || '')
      if (sn && sn !== String(dockGatewaySn)) return
      if (data?.info) {
        setDockAiInfo(data.info)
        syncDockTrackState(data.info)
        const n = Array.isArray(data.info.models) ? data.info.models.length : 0
        if (n > 0) {
          setDockAiHint(`已收到模型列表（drc_ai_info_push）共 ${n} 项`)
        }
      }
    }
    const onStatus = (ev) => {
      const data = ev?.detail
      const sn = String(data?.gatewaySn || data?.deviceId || '')
      if (sn && sn !== String(dockGatewaySn)) return
      if (data?.status) {
        setDockDrcStatus(data.status)
        setDockDrcConnected(Number(data.status.drcState) === 2)
        if (Number(data.status.drcState) === 2) {
          setDockAiHint('DRC 已连接，等待模型列表上报…')
          refreshDockAiInfo()
        }
      }
    }
    window.addEventListener('drc_ai_info', onPush)
    window.addEventListener('drc_status', onStatus)
    return () => {
      window.removeEventListener('drc_ai_info', onPush)
      window.removeEventListener('drc_status', onStatus)
    }
  }, [dockGatewaySn])

  useEffect(() => {
    if (!deviceId) return undefined
    let cancelled = false
    Promise.all([
      fetchStreamUrl(deviceId, '_out', regionId, mqttProfileId),
      fetchStreamUrl(deviceId, '_in', regionId, mqttProfileId),
      fetchStreamUrl(deviceId, '_flight', regionId, mqttProfileId),
    ])
      .then(([out, inUrl, flight]) => {
        if (!cancelled) setStreams({ out, in: inUrl, flight })
      })
      .catch(() => {
        if (!cancelled) setStreams({ out: '', in: '', flight: '' })
      })
    return () => { cancelled = true }
  }, [deviceId, regionId, mqttProfileId])

  const droneInDock = metrics.droneInDock?.value
  const droneBattery = metrics.droneBattery?.value
  const windSpeed = metrics.windSpeed?.value
  const envTemp = metrics.environmentTemp?.value
  const subDeviceOnline = device.osdSnapshot?.sub_device?.device_online_status ?? null

  const swapWithMain = (panel, view) => {
    const previousMainView = mainView
    setMainView(view)
    if (panel === 'map') {
      setMapPanelView(previousMainView)
    } else {
      setBottomPanelView(previousMainView)
      if (previousMainView === 'out' || previousMainView === 'in') {
        setBottomStream(previousMainView)
      }
    }
  }

  const renderView = (view, className = 'w-full h-full', isMainStream = false) => {
    // 主画面无人机流始终挂 SEI tap（避免开关识别时重建播放器）
    const seiOn = isMainStream && view === 'flight'
    if (isMainStream && customStreamUrl) {
      return (
        <FlvPlayer
          url={customStreamUrl}
          className={className}
          isMainStream={true}
          seiEnabled={seiOn}
          onAiTargets={seiOn ? handleDockAiTargets : undefined}
          onSeiStatus={seiOn ? handleDockSeiStatus : undefined}
        />
      )
    }
    if (view === 'map') {
      return (
        <div className={`${className} relative bg-black flex items-center justify-center overflow-hidden`}>
          <img src="/images/image.png" alt="机场位置地图" className="w-full h-full object-cover" />
        </div>
      )
    }
    return (
      <FlvPlayer
        url={streams[view]}
        className={className}
        isMainStream={isMainStream}
        seiEnabled={seiOn}
        onAiTargets={seiOn ? handleDockAiTargets : undefined}
        onSeiStatus={seiOn ? handleDockSeiStatus : undefined}
      />
    )
  }

  useEffect(() => {
    fetch('/api/ai/token-usage')
      .then(res => res.json())
      .then(data => {
        const current = data[aiModel]
        if (!current) return
        setTotalTokenUsage(current.used || 0)
        setLastTokenUsage(current.lastUsage || null)
        setAiModels(prev => prev.map(m => (
          m.value === aiModel
            ? { ...m, total: current.total || m.total, remaining: current.remaining ?? m.remaining, description: `剩${(current.remaining ?? m.remaining).toLocaleString()}/共${(current.total || m.total).toLocaleString()}` }
            : m
        )))
        console.log(`[AI检索] 已加载服务端Token记录 - 模型:${aiModel}, 累计:${current.used || 0}, 剩余:${current.remaining}`)
      })
      .catch(err => console.error('[AI检索] 获取Token记录失败:', err))
  }, [aiModel])

  // 定时截帧分析
  useEffect(() => {
    if (!isAnalyzing) {
      clearInterval(captureTimerRef.current)
      return
    }
    console.log(`[AI检索] ✅ 启动分析 - 截帧间隔: ${captureInterval}秒`)
    const captureAndAnalyze = async () => {
      // 精准获取主画面video（带data-main-stream标识的直播流，或错误状态下的测试视频）
      const video = document.querySelector('video[data-main-stream="true"]') 
        || document.querySelector('video[src*="test"]') 
        || document.querySelector('video')
      if (!video || video.readyState < 2) {
        console.log('[AI检索] ⏸ 视频未就绪，跳过本次截帧')
        return
      }
      console.log('[AI检索] 📸 正在截帧...')
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 360
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
      console.log(`[AI检索] 截帧完成 - 尺寸: ${canvas.width}x${canvas.height}`)
      await analyzeFrame(base64, canvas.width, canvas.height)
    }
    captureTimerRef.current = setInterval(captureAndAnalyze, captureInterval * 1000)
    captureAndAnalyze()
    return () => {
      clearInterval(captureTimerRef.current)
      console.log('[AI检索] ⏹ 停止分析')
    }
  }, [isAnalyzing, captureInterval, showAiSearch])

  // 在Canvas上绘制框选
  const drawBoxes = (alert) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const parent = canvas.parentElement
    canvas.width = parent.clientWidth
    canvas.height = parent.clientHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!alert || !alert.boxes || alert.boxes.length === 0) {
      console.log('[AI检索] 没有目标需要绘制')
      return
    }
    const scaleX = canvas.width / alert.videoWidth
    const scaleY = canvas.height / alert.videoHeight
    let drawCount = 0
    alert.boxes.forEach((box, idx) => {
      // 支持 bbox 或 bbox_2d 字段
      const bbox = box.bbox || box.bbox_2d || box
      if (!Array.isArray(bbox) || bbox.length < 4) {
        console.log(`[AI检索] 跳过无效边界框 #${idx}:`, box)
        return
      }
      const [x1, y1, x2, y2] = bbox
      // 检查坐标是否有效
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
        console.log(`[AI检索] 跳过无效坐标 #${idx}`)
        return
      }
      const px1 = Math.min(x1, x2) * scaleX
      const py1 = Math.min(y1, y2) * scaleY
      const px2 = Math.max(x1, x2) * scaleX
      const py2 = Math.max(y1, y2) * scaleY
      // 绘制框
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 3
      ctx.strokeRect(px1, py1, px2 - px1, py2 - py1)
      // 绘制标签背景
      const label = box.label || `目标${idx + 1}`
      ctx.fillStyle = '#ef4444'
      const textWidth = ctx.measureText(label).width
      ctx.fillRect(px1, py1 - 20, textWidth + 8, 20)
      // 绘制文字
      ctx.fillStyle = '#fff'
      ctx.font = '14px sans-serif'
      ctx.fillText(label, px1 + 4, py1 - 5)
      drawCount++
    })
    console.log(`[AI检索] ✅ 绘制了 ${drawCount} 个框`)
    // 5秒后清除
    setTimeout(() => ctx.clearRect(0, 0, canvas.width, canvas.height), 5000)
  }

  // 在地图区域绘制告警框选
  const drawBoxesOnMap = (alert) => {
    const canvas = mapCanvasRef.current
    if (!canvas || !alert) return
    const ctx = canvas.getContext('2d')
    // 获取canvas的直接父元素（图片包装层）
    const container = canvas.parentElement
    const imgWrapper = container?.querySelector('div') // 图片包装层
    const img = imgWrapper?.querySelector('img')
    if (!img || !container) {
      console.log('[AI地图] 未找到图片元素')
      return
    }
    
    // 获取容器的实际尺寸
    const containerWidth = container.clientWidth
    const containerHeight = container.clientHeight
    
    // 获取图片的自然尺寸
    const imgNaturalWidth = img.naturalWidth || alert.videoWidth || 1000
    const imgNaturalHeight = img.naturalHeight || alert.videoHeight || 1000
    
    // 计算图片在容器中的显示尺寸（object-contain模式）
    const fitScale = Math.min(containerWidth / imgNaturalWidth, containerHeight / imgNaturalHeight)
    const imgDisplayWidth = imgNaturalWidth * fitScale
    const imgDisplayHeight = imgNaturalHeight * fitScale
    const imgLeft = (containerWidth - imgDisplayWidth) / 2
    const imgTop = (containerHeight - imgDisplayHeight) / 2
    
    // canvas使用高分辨率（考虑zoom）避免模糊
    // 内部像素 = 显示尺寸 * zoom * DPR
    const dpr = window.devicePixelRatio || 1
    const canvasWidth = imgDisplayWidth * imageZoom * dpr
    const canvasHeight = imgDisplayHeight * imageZoom * dpr
    
    canvas.width = canvasWidth
    canvas.height = canvasHeight
    // CSS显示尺寸保持为图片显示尺寸，位置居中
    canvas.style.width = `${imgDisplayWidth}px`
    canvas.style.height = `${imgDisplayHeight}px`
    canvas.style.left = `${imgLeft}px`
    canvas.style.top = `${imgTop}px`
    
    // 重置变换并应用DPR缩放
    ctx.setTransform(dpr * imageZoom, 0, 0, dpr * imageZoom, 0, 0)
    ctx.clearRect(0, 0, imgDisplayWidth, imgDisplayHeight)
    
    console.log(`[AI地图] 绘制准备 - canvas像素:${canvasWidth.toFixed(0)}x${canvasHeight.toFixed(0)}, 显示:${imgDisplayWidth.toFixed(0)}x${imgDisplayHeight.toFixed(0)}, zoom:${imageZoom.toFixed(2)}, DPR:${dpr}`)
    
    if (!alert.boxes || alert.boxes.length === 0) {
      console.log('[AI地图] 无目标框')
      return
    }
    
    // AI返回的坐标是0-1000归一化的，基准固定为1000
    const baseWidth = 1000
    const baseHeight = 1000
    const scaleX = imgDisplayWidth / baseWidth
    const scaleY = imgDisplayHeight / baseHeight
    
    alert.boxes.forEach((box, idx) => {
      const bbox = box.bbox || box.bbox_2d
      console.log(`[AI地图] 目标 #${idx}:`, bbox, box.label)
      if (!Array.isArray(bbox) || bbox.length < 4) return
      const [x1, y1, x2, y2] = bbox
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return
      
      // 转换为canvas内部坐标（相对于图片）
      const px1 = Math.min(x1, x2) * scaleX
      const py1 = Math.min(y1, y2) * scaleY
      const px2 = Math.max(x1, x2) * scaleX
      const py2 = Math.max(y1, y2) * scaleY
      
      console.log(`[AI地图] 绘制框 #${idx}: 原始[${x1},${y1},${x2},${y2}] -> canvas[${px1.toFixed(1)},${py1.toFixed(1)},${px2.toFixed(1)},${py2.toFixed(1)}]`)
      
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2 / imageZoom // 线宽反比于zoom，保持视觉一致
      ctx.strokeRect(px1, py1, px2 - px1, py2 - py1)
      
      const label = box.label || `目标${idx + 1}`
      // 字体大小反比于zoom，但最小保证可读
      const fontSize = Math.max(8, 12 / imageZoom)
      ctx.font = `bold ${fontSize}px sans-serif`
      const textWidth = ctx.measureText(label).width
      
      // 标签背景
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(px1, py1 - fontSize - 4, textWidth + 6, fontSize + 4)
      // 标签文字
      ctx.fillStyle = '#fff'
      ctx.fillText(label, px1 + 3, py1 - 4)
    })
    console.log(`[AI地图] ✅ 绘制完成`)
  }

  // 详情弹窗绘制框选
  const drawBoxesOnDetail = (alert) => {
    const canvas = detailCanvasRef.current
    if (!canvas || !alert) return
    const ctx = canvas.getContext('2d')
    const parent = canvas.parentElement
    const img = parent.querySelector('img')
    if (!img) {
      console.log('[AI详情] 未找到图片元素')
      return
    }
    // 等待图片加载完成获取实际显示尺寸
    const rect = img.getBoundingClientRect()
    const parentRect = parent.getBoundingClientRect()
    // 计算图片在容器内的实际显示位置和尺寸
    const imgDisplayWidth = rect.width
    const imgDisplayHeight = rect.height
    const imgLeft = rect.left - parentRect.left
    const imgTop = rect.top - parentRect.top
    // 设置 canvas 尺寸匹配父容器
    canvas.width = parent.clientWidth
    canvas.height = parent.clientHeight
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    console.log(`[AI详情] 绘制准备 - canvas:${canvas.width}x${canvas.height}, 图片显示:${imgDisplayWidth.toFixed(0)}x${imgDisplayHeight.toFixed(0)}, 原始:${alert.videoWidth}x${alert.videoHeight}, boxes:${alert.boxes?.length || 0}`)
    if (!alert.boxes || alert.boxes.length === 0) {
      console.log('[AI详情] 无目标框')
      return
    }
    const naturalWidth = img.naturalWidth || alert.videoWidth
    const naturalHeight = img.naturalHeight || alert.videoHeight
    const baseWidth = 1000
    const baseHeight = 1000
    // 计算缩放比例（优先基于图片实际像素）
    const scaleX = imgDisplayWidth / baseWidth
    const scaleY = imgDisplayHeight / baseHeight
    console.log(`[AI详情] 缩放比例: scaleX=${scaleX.toFixed(3)}, scaleY=${scaleY.toFixed(3)}, 图片偏移: left=${imgLeft.toFixed(1)}, top=${imgTop.toFixed(1)}, natural:${naturalWidth}x${naturalHeight}, base:${baseWidth}x${baseHeight}`)
    alert.boxes.forEach((box, idx) => {
      const bbox = box.bbox || box.bbox_2d
      console.log(`[AI详情] 目标 #${idx}:`, box)
      if (!Array.isArray(bbox) || bbox.length < 4) {
        console.log(`[AI详情] 跳过 - 边界框无效`)
        return
      }
      const [x1, y1, x2, y2] = bbox
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
        console.log(`[AI详情] 跳过 - 坐标undefined`)
        return
      }
      // 转换为canvas坐标（相对于图片显示位置）
      const px1 = imgLeft + Math.min(x1, x2) * scaleX
      const py1 = imgTop + Math.min(y1, y2) * scaleY
      const px2 = imgLeft + Math.max(x1, x2) * scaleX
      const py2 = imgTop + Math.max(y1, y2) * scaleY
      console.log(`[AI详情] 绘制框 #${idx}: 原始[${x1},${y1},${x2},${y2}] -> 屏幕[${px1.toFixed(1)},${py1.toFixed(1)},${px2.toFixed(1)},${py2.toFixed(1)}]`)
      // 绘制框
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 3
      ctx.strokeRect(px1, py1, px2 - px1, py2 - py1)
      // 绘制标签背景
      const label = box.label || `目标${idx + 1}`
      ctx.fillStyle = '#ef4444'
      const textWidth = ctx.measureText(label).width
      ctx.fillRect(px1, py1 - 20, textWidth + 8, 20)
      // 绘制文字
      ctx.fillStyle = '#fff'
      ctx.font = '14px sans-serif'
      ctx.fillText(label, px1 + 4, py1 - 5)
    })
    console.log(`[AI详情] ✅ 绘制完成`)
  }

  // 详情弹窗切换记录时重绘框选
  useEffect(() => {
    if (showAlertDetail && aiAlerts[detailIndex]) {
      // 延迟等待图片渲染完成
      const timer = setTimeout(() => {
        drawBoxesOnDetail(aiAlerts[detailIndex])
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [detailIndex, showAlertDetail])

  // 在地图区域显示告警时绘制框选
  useEffect(() => {
    if (showAlertInMap && aiAlerts[mapAlertIndex]) {
      const timer = setTimeout(() => {
        drawBoxesOnMap(aiAlerts[mapAlertIndex])
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [mapAlertIndex, showAlertInMap, aiAlerts, imageZoom, imagePan])

  // 切换告警图片时重置缩放和位置
  useEffect(() => {
    setImageZoom(1)
    setImagePan({ x: 0, y: 0 })
  }, [mapAlertIndex])

  // 调用 Qwen API
  const analyzeFrame = async (base64Image, frameWidth = 640, frameHeight = 360) => {
    console.log('[AI检索] 🚀 analyzeFrame 函数被调用')
    const prompt = aiSearchTags.length > 0 
      ? `检测图中具有以下特征的目标：${aiSearchTags.join('、')}` 
      : '检测图中异常目标和事件'
    console.log(`[AI检索] 开始分析 - 模型: ${aiModel} - 提示词: "${prompt}" - 图片大小: ${Math.round(base64Image.length / 1024)}KB`)
    try {
      const startTime = Date.now()
      // 使用服务端代理获取真实额度
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: aiModel,
          messages: [{
              role: 'user',
              content: [
                { image: `data:image/jpeg;base64,${base64Image}` },
                { text: `请在图中检索并框选用户指定目标：「${prompt}」。只检测当前画面中真实、清晰、实体存在且与该描述明确匹配的目标；忽略视频转场造成的半透明重影、倒影、屏幕叠加画面、UI文字和模糊残影。例如用户输入“白色车辆”时只返回白色车辆，不要返回其他颜色车辆；用户输入“车辆”时返回画面中清晰可见的车辆。请返回目标最紧贴外轮廓的边界框，坐标范围固定为0-1000，格式：[{"label":"目标描述","bbox_2d":[x1,y1,x2,y2]}]。如果没有匹配目标，返回空数组[]。不要解释，不要输出Markdown，只返回JSON数组。最多返回20个最明显目标。` }
              ]
            }]
        })
      })
      if (!res.ok) {
        const errorText = await res.text()
        console.error(`[AI检索] API错误 ${res.status}:`, errorText)
        return
      }
      // 从服务端代理返回的数据获取真实额度
      const data = await res.json()
      console.log('[AI检索] 📊 检查额度信息...')
      
      const usage = data.usage
      if (usage && typeof usage.total_tokens === 'number') {
        const usedTokens = usage.total_tokens
        const usageSummary = data._usageSummary
        setLastTokenUsage(usage)
        setTotalTokenUsage(usageSummary?.used ?? 0)
        console.log(`[AI检索] ✅ 获取到本次Token消耗 - 输入:${usage.input_tokens || 0}, 输出:${usage.output_tokens || 0}, 总计:${usedTokens}`)
        setAiModels(prev => {
          const oldModel = prev.find(m => m.value === aiModel)
          if (!oldModel) return prev
          const remaining = usageSummary?.remaining ?? Math.max(0, oldModel.remaining - usedTokens)
          const total = usageSummary?.total ?? oldModel.total
          console.log(`[AI检索] 服务端累计额度 - 累计:${(usageSummary?.used ?? 0).toLocaleString()}, 剩余:${remaining.toLocaleString()}`)
          return prev.map(m => 
            m.value === aiModel 
              ? { ...m, total, remaining, description: `剩${remaining.toLocaleString()}/共${total.toLocaleString()}` }
              : m
          )
        })
      } else {
        console.log('[AI检索] ⚠️ 未获取到usage.total_tokens，额度显示保持不变')
      }
      // data已经在上面解析过了
      const text = data.output?.choices?.[0]?.message?.content?.[0]?.text || data.choices?.[0]?.message?.content || '[]'
      const clean = text.replace(/```json|```/g, '').trim()
      console.log(`[AI检索] API返回原始内容:`, text.substring(0, 200), '...')
      let boxes = []
      try { 
        const parsed = JSON.parse(clean)
        boxes = Array.isArray(parsed) ? parsed : []
      } catch {
        // 尝试从文本中提取JSON
        const match = text.match(/\[[\s\S]*\]/)
        if (match) {
          try { boxes = JSON.parse(match[0]) } catch {}
        }
      }
      console.log(`[AI检索] 解析到 ${boxes.length} 个目标:`, boxes.map(b => b.label || '未知').join(', ') || '无目标')
      // 过滤掉空边界框（API返回的占位符）
      const validBoxes = boxes.filter(box => {
        const bbox = box.bbox || box.bbox_2d
        return Array.isArray(bbox) && bbox.length === 4 && bbox.every(v => typeof v === 'number' && v > 0)
      })
      console.log(`[AI检索] 过滤后有效目标: ${validBoxes.length}/${boxes.length}`)
      if (validBoxes.length > 0) {
        console.log(`[AI检索] ✅ 生成告警记录，ID: ${Date.now()}`)
        const alert = {
          id: Date.now(),
          time: new Date().toLocaleTimeString('zh-CN'),
          query: prompt,
          boxes: validBoxes,
          frameBase64: `data:image/jpeg;base64,${base64Image}`,
          videoWidth: frameWidth,
          videoHeight: frameHeight
        }
        if (drawMode === 'python') {
          try {
            const drawRes = await fetch('/api/draw-boxes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ image: base64Image, boxes: validBoxes, videoWidth: frameWidth, videoHeight: frameHeight })
            })
            if (!drawRes.ok) {
              throw new Error(`Python绘制接口失败: ${drawRes.status}`)
            }
            const drawData = await drawRes.json()
            if (drawData.success && drawData.image) {
              alert.frameBase64 = `data:image/jpeg;base64,${drawData.image}`
              alert.drawnByPython = true
            }
          } catch (e) {
            console.warn('[AI检索] Python 绘制失败，回退前端模式:', e.message)
          }
        }
        setAiAlerts(prev => [...prev, alert])
      } else {
        console.log('[AI检索] ℹ️ 未发现有效目标，跳过保存')
      }
    } catch (e) {
      console.error('[AI检索] ❌ 分析失败:', e.message)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ fontFamily: 'sans-serif' }}>
      {/* 顶部座舱栏 */}
      <div className="h-8 bg-[#232323] border-b border-[#3a3a3a] text-xs text-gray-300 select-none grid grid-cols-3 items-center">
        <div className="h-full flex items-center">
          <LogoMark variant="icon" className="mx-2" />
          <div className="h-4 w-px bg-white/15" />
          <button className="w-9 h-full flex items-center justify-center hover:bg-white/10 text-white" title="设备">
            <Boxes size={16} />
          </button>
          <div className="h-4 w-px bg-white/15" />
          <button
            onClick={() => setShowAiAlertPanel(v => !v)}
            className={`w-9 h-full flex items-center justify-center hover:bg-white/10 text-white ${showAiAlertPanel ? 'bg-white/10' : ''}`}
            title="AI告警"
          >
            <Siren size={16} />
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full ${subDeviceOnline === 1 ? 'bg-green-400' : 'bg-gray-400'}`} />
          <span className="truncate text-gray-100">
            {subDeviceOnline === 1 ? '已获取控制权-飞行器已连接' : '无控制权-飞行器未连接'}
          </span>
        </div>

        <div className="h-full flex items-center justify-end">
          <button className="w-9 h-full flex items-center justify-center hover:bg-white/10 text-white" title="消息">
            <Bell size={15} />
          </button>
          <div className="h-4 w-px bg-white/15" />
          <button className="w-9 h-full flex items-center justify-center hover:bg-white/10 text-white" title="布局">
            <PanelLeft size={15} />
          </button>
          <button
            onClick={() => setShowKeyboardHelp(true)}
            className="w-9 h-full flex items-center justify-center hover:bg-white/10 text-white"
            title="快捷键"
          >
            <Keyboard size={15} />
          </button>
          <button
            onClick={onClose}
            className="w-9 h-full flex items-center justify-center hover:bg-white/10 text-white"
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* 飞行状态栏 */}
      <div className="h-7 bg-[#111] border-b border-[#2d2d2d] flex items-center justify-center gap-4 text-[11px] text-gray-300">
        <span className="font-medium text-gray-100">{device.deviceName || deviceId}</span>
        <span className="flex items-center gap-1">
          <Satellite size={12} className="text-blue-400" />
          RTK {subDeviceOnline === 1 ? '已连接' : '未连接'}
        </span>
        <span className="flex items-center gap-1">
          <Battery size={12} className={droneBattery >= 50 ? 'text-green-400' : droneBattery >= 20 ? 'text-yellow-400' : 'text-red-400'} />
          <span className={droneBattery >= 50 ? 'text-green-400' : droneBattery >= 20 ? 'text-yellow-400' : 'text-red-400'}>
            {droneBattery != null ? `${droneBattery}%` : '--'}
          </span>
        </span>
        {windSpeed != null && (
          <span className="flex items-center gap-1"><Wind size={12} className="text-cyan-400" />{windSpeed} m/s</span>
        )}
        {envTemp != null && (
          <span className="flex items-center gap-1"><Thermometer size={12} className="text-orange-400" />{envTemp}°C</span>
        )}
        <span className={`flex items-center gap-1 ${droneInDock === 1 ? 'text-green-400' : 'text-orange-400'}`}>
          <Home size={12} />{droneInDock === 1 ? '在巢' : droneInDock === 0 ? '离巢' : '--'}
        </span>
        {device.metrics.modeCode && (
          <span className="flex items-center gap-1 text-indigo-400">
            <Activity size={12} />
            {device.metrics.modeCode.statusText}
          </span>
        )}
        {device.location && (
          <span className="flex items-center gap-1 text-gray-400">
            <MapPin size={11} />{device.location.latitude.toFixed(4)}, {device.location.longitude.toFixed(4)}
          </span>
        )}
      </div>

      {/* 主体区域 */}
      <div className="flex flex-1 overflow-hidden">
        {showAiAlertPanel && (
          <div className="w-[156px] flex-shrink-0 bg-[#181818] border-r border-[#303030] text-white relative">
            <div className="h-full flex flex-col">
              <div className="h-10 px-3 flex items-center justify-between border-b border-white/10 bg-[#202020]">
                <span className="text-sm font-medium">目标告警记录</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">{aiAlerts.length}</span>
                  <button className="p-1 hover:bg-white/10 rounded text-gray-300 hover:text-white" title="筛选">
                    <Filter size={14} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                {aiAlerts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-xs text-gray-500">
                    <Siren size={20} className="mb-2 opacity-40" />
                    无告警事件
                  </div>
                ) : (
                  [...aiAlerts].reverse().map((alert) => {
                    const realIdx = aiAlerts.indexOf(alert)
                    return (
                    <button
                      key={alert.id}
                      onClick={() => {
                        setMapAlertIndex(realIdx)
                        setShowAlertInMap(true)
                      }}
                      className={`w-full px-2 py-2 text-left border-b border-white/5 hover:bg-white/5 transition-colors ${
                        activeAlert?.id === alert.id ? 'bg-blue-900/30 border-l-2 border-l-blue-500' : ''
                      }`}
                    >
                      <div className="flex gap-2">
                        {/* 缩略图 */}
                        {alert.frameBase64 && (
                          <img
                            src={alert.frameBase64}
                            alt="检测截图"
                            className="w-16 h-12 object-cover rounded bg-gray-800 flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className="text-[10px] text-blue-400">{alert.time}</span>
                            <span className="text-[9px] px-1 py-0.5 bg-red-600/80 rounded">AI</span>
                          </div>
                          <div className="text-xs text-gray-300 truncate">{alert.query}</div>
                          <div className="text-[10px] text-gray-500">{alert.boxes.length}个目标</div>
                        </div>
                      </div>
                    </button>
                  )})
                )}
              </div>
            </div>
            <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-10 flex items-center justify-center">
              <div className="w-1 h-10 bg-[#4a4a4a] rounded-full" />
            </div>
          </div>
        )}
        {/* 左侧：地图 + 内部监控小窗 */}
        <div className="w-[432px] flex flex-col border-r border-gray-800 flex-shrink-0">
          {/* 左上视图 - 告警详情模式 */}
          {showAlertInMap && aiAlerts[mapAlertIndex] ? (
            <div className="flex-1 bg-gray-950 relative flex flex-col overflow-hidden">
              {/* 顶部信息栏 */}
              <div className="h-8 px-2 flex items-center justify-between bg-[#202020] border-b border-[#333] flex-shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white">AI检测详情</span>
                  <span className="text-[10px] text-gray-400">{mapAlertIndex + 1} / {aiAlerts.length}</span>
                </div>
                <button
                  onClick={() => setShowAlertInMap(false)}
                  className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"
                  title="返回地图"
                >
                  <X size={14} />
                </button>
              </div>
              {/* 告警图片 - 上对齐 */}
              <div className="flex-shrink-0 relative bg-black overflow-hidden flex flex-col" style={{ height: '360px' }}>
                <div 
                  className="relative w-full h-full overflow-hidden cursor-grab active:cursor-grabbing"
                  onMouseDown={(e) => {
                    setIsDragging(true)
                    setDragStart({ x: e.clientX - imagePan.x, y: e.clientY - imagePan.y })
                  }}
                  onMouseMove={(e) => {
                    if (isDragging) {
                      setImagePan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
                    }
                  }}
                  onMouseUp={() => setIsDragging(false)}
                  onMouseLeave={() => setIsDragging(false)}
                  onWheel={(e) => {
                    e.preventDefault()
                    const container = e.currentTarget
                    const rect = container.getBoundingClientRect()
                    // 鼠标相对于容器中心的位置
                    const mouseX = e.clientX - rect.left - rect.width / 2
                    const mouseY = e.clientY - rect.top - rect.height / 2
                    
                    const delta = e.deltaY > 0 ? 0.9 : 1.1
                    const newZoom = Math.max(0.5, Math.min(5, imageZoom * delta))
                    
                    // 基于鼠标位置的缩放：调整pan使鼠标指向的点保持不动
                    const zoomRatio = newZoom / imageZoom
                    const newPanX = mouseX - (mouseX - imagePan.x) * zoomRatio
                    const newPanY = mouseY - (mouseY - imagePan.y) * zoomRatio
                    
                    setImageZoom(newZoom)
                    setImagePan({ x: newPanX, y: newPanY })
                  }}
                >
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{
                      transform: `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom})`,
                      transformOrigin: 'center center',
                      transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                    }}
                  >
                    <img
                      src={aiAlerts[mapAlertIndex].frameBase64}
                      alt="AI检测画面"
                      className="max-w-full max-h-full object-contain"
                      onLoad={() => drawBoxesOnMap(aiAlerts[mapAlertIndex])}
                      draggable={false}
                    />
                  </div>
                  <canvas
                    ref={mapCanvasRef}
                    className="absolute pointer-events-none"
                    style={{
                      transform: `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom})`,
                      transformOrigin: 'center center',
                      transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                    }}
                  />
                  {/* 左右切换按钮 */}
                  {aiAlerts.length > 1 && (
                    <>
                      <button
                        onClick={() => {
                          const newIdx = mapAlertIndex > 0 ? mapAlertIndex - 1 : aiAlerts.length - 1
                          setMapAlertIndex(newIdx)
                        }}
                        className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 bg-black/60 hover:bg-black/80 rounded text-white/80 hover:text-white z-10"
                        title="上一张"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        onClick={() => {
                          const newIdx = mapAlertIndex < aiAlerts.length - 1 ? mapAlertIndex + 1 : 0
                          setMapAlertIndex(newIdx)
                        }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 bg-black/60 hover:bg-black/80 rounded text-white/80 hover:text-white z-10"
                        title="下一张"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </>
                  )}
                </div>
                {/* 缩放控制按钮 */}
                <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/70 rounded px-2 py-1 z-10">
                  <button
                    onClick={() => {
                      const newZoom = Math.max(0.5, imageZoom - 0.2)
                      const zoomRatio = newZoom / imageZoom
                      // 以视图中心为基准缩放
                      setImagePan(prev => ({ x: prev.x * zoomRatio, y: prev.y * zoomRatio }))
                      setImageZoom(newZoom)
                    }}
                    className="p-1 hover:bg-white/20 rounded text-white/80 hover:text-white"
                    title="缩小"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                  </button>
                  <span className="text-xs text-white/80 w-12 text-center">{Math.round(imageZoom * 100)}%</span>
                  <button
                    onClick={() => {
                      const newZoom = Math.min(5, imageZoom + 0.2)
                      const zoomRatio = newZoom / imageZoom
                      // 以视图中心为基准缩放
                      setImagePan(prev => ({ x: prev.x * zoomRatio, y: prev.y * zoomRatio }))
                      setImageZoom(newZoom)
                    }}
                    className="p-1 hover:bg-white/20 rounded text-white/80 hover:text-white"
                    title="放大"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="16"/>
                      <line x1="8" y1="12" x2="16" y2="12"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => {
                      setImageZoom(1)
                      setImagePan({ x: 0, y: 0 })
                    }}
                    className="p-1 hover:bg-white/20 rounded text-white/80 hover:text-white ml-1"
                    title="重置"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                      <path d="M3 3v5h5"/>
                    </svg>
                  </button>
                </div>
              </div>
              {/* 地图区域 - 显示告警位置 */}
              <div className="flex-1 relative border-t border-[#333]">
                {/* 地图上方时间信息 */}
                <div className="absolute top-2 left-2 right-2 z-10 flex items-center justify-between bg-black/70 rounded px-2 py-1">
                  <span className="text-[10px] text-gray-400">告警时间</span>
                  <span className="text-[10px] text-gray-200">
                    {new Date(aiAlerts[mapAlertIndex].timestamp).toLocaleString()}
                  </span>
                </div>
                {device.location ? (
                  <CesiumMap 
                    lat={device.location.latitude} 
                    lng={device.location.longitude} 
                    label={device.deviceName || device.deviceId}
                    alertMode={true}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-600">
                    <MapPin size={24} className="opacity-30" />
                    <span className="text-xs">暂无位置信息</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* 左上视图 - 正常地图模式 */
            <div className="flex-1 bg-gray-950 relative flex items-center justify-center overflow-hidden">
              {renderView(mapPanelView)}
              <div className="absolute top-2 left-2 bg-black bg-opacity-60 text-xs text-gray-300 px-2 py-1 rounded">
                {mapPanelView === 'map' ? '机场位置' : mapPanelView === 'flight' ? '无人机画面' : mapPanelView === 'out' ? '外部监控' : '内部监控'}
              </div>
              <button
                onClick={() => swapWithMain('map', mapPanelView)}
                className={`absolute top-2 right-2 p-1 rounded transition-colors ${
                  mainView === mapPanelView ? 'bg-blue-600 text-white' : 'bg-black bg-opacity-60 text-gray-300 hover:bg-blue-700 hover:text-white'
                }`}
                title="与主屏交换"
              >
                <Maximize2 size={13} />
              </button>
            </div>
          )}

          {/* 左下角监控小窗（可切换）- 告警模式下隐藏 */}
          {!showAlertInMap && <div className="h-44 flex-shrink-0 relative border-t border-gray-800 flex flex-col">
            {/* 切换 tab + 投射按钮 */}
            <div className="flex bg-gray-900 border-b border-gray-800 items-center">
              {[{ id: 'out', label: '外部' }, { id: 'in', label: '内部' }].map(s => (
                <button
                  key={s.id}
                  onClick={() => { setBottomStream(s.id); setBottomPanelView(s.id) }}
                  className={`flex-1 py-1 text-xs font-medium transition-colors ${
                    bottomPanelView === s.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {s.label}监控
                </button>
              ))}
              <button
                onClick={() => swapWithMain('bottom', bottomPanelView)}
                className={`px-2 py-1 transition-colors ${
                  mainView === bottomPanelView
                    ? 'text-blue-400'
                    : 'text-gray-500 hover:text-blue-400'
                }`}
                title="与主屏交换"
              >
                <Maximize2 size={13} />
              </button>
            </div>
            <div className="flex-1 relative">
              {renderView(bottomPanelView)}
              {(bottomPanelView === 'map' || bottomPanelView === 'flight') && (
                <div className="absolute top-1.5 left-2 bg-black bg-opacity-60 text-xs text-gray-300 px-1.5 py-0.5 rounded">
                  {bottomPanelView === 'map' ? '机场位置' : '无人机画面'}
                </div>
              )}
            </div>
          </div>}
        </div>

        {/* 右侧：大屏 */}
        <div className="flex-1 flex flex-col bg-black">
          {/* 顶部信息栏 */}
          <div className="flex items-center px-3 py-1.5 bg-gray-900 border-b border-gray-800">
            <span className="text-xs text-gray-400">
              {mainView === 'flight' ? '无人机画面' : mainView === 'out' ? '外部监控' : mainView === 'in' ? '内部监控' : '机场位置地图'}
            </span>
            <div className="ml-auto text-xs text-gray-500 flex items-center gap-1">
              <Signal size={11} />
              <span>实时直播</span>
            </div>
          </div>

          {/* 主画面 */}
          <div className="flex-1 relative flex flex-col">
            {/* 自定义推流地址输入框 */}
            <div className="flex items-center gap-2 px-2 py-1 bg-[#0a1929] border-b border-gray-700">
              <span className="text-xs text-gray-400 whitespace-nowrap">推流地址</span>
              <input
                type="text"
                value={customStreamInput}
                onChange={e => setCustomStreamInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { const u = customStreamInput.trim(); console.log(`[自定义推流] 🔗 应用地址: ${u || '(清空，恢复推流)'}`); setCustomStreamUrl(u) } }}
                placeholder="输入视频URL后按回车，留空则使用无人机推流"
                className="flex-1 bg-[#0d2137] border border-gray-600 rounded px-2 py-0.5 text-xs text-white placeholder-gray-500 outline-none focus:border-blue-500"
              />
              <button
                onClick={() => { const u = customStreamInput.trim(); console.log(`[自定义推流] 🔗 应用地址: ${u || '(清空，恢复推流)'}`); setCustomStreamUrl(u) }}
                className="text-xs px-2 py-0.5 bg-blue-600 hover:bg-blue-500 rounded text-white"
              >应用</button>
              {customStreamUrl && (
                <button
                  onClick={() => { setCustomStreamUrl(''); setCustomStreamInput('') }}
                  className="text-xs px-2 py-0.5 bg-gray-600 hover:bg-gray-500 rounded text-white"
                >清除</button>
              )}
            </div>
            <div className="flex-1 relative">
            {renderView(mainView, 'w-full h-full', true)}
            {mainView === 'flight' && (
              <>
                {/* 侧边工具：AI检索 / AI识别 */}
                <div className="absolute left-4 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (isAnalyzing) {
                        setIsAnalyzing(false)
                        if (captureTimerRef.current) {
                          clearInterval(captureTimerRef.current)
                          captureTimerRef.current = null
                        }
                      } else {
                        setShowDockAiPanel(false)
                        setShowAiSearch(true)
                      }
                    }}
                    className="flex flex-col items-center gap-1 text-white group"
                    title={isAnalyzing ? '点击停止AI检索' : 'AI检索'}
                  >
                    <div className={`relative w-14 h-14 rounded-lg border flex items-center justify-center shadow-lg transition-colors ${
                      isAnalyzing
                        ? 'bg-red-600/80 border-red-400 animate-pulse'
                        : 'bg-[#0b376f] border-[#1177d8] group-hover:bg-[#0d4d99]'
                    }`}>
                      {isAnalyzing
                        ? <Loader2 size={30} className="text-white animate-spin" />
                        : <Search size={30} className="text-cyan-300" />}
                      {!isAnalyzing && <Sparkles size={13} className="absolute right-2 top-2 text-cyan-300" />}
                    </div>
                    <span className={`text-base font-bold drop-shadow ${isAnalyzing ? 'text-red-300' : ''}`}>
                      {isAnalyzing ? '检索中...' : 'AI检索'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowAiSearch(false)
                      setShowDockAiPanel((v) => !v)
                    }}
                    className={`flex flex-col items-center gap-1 text-white group ${
                      !dockDroneOnline ? 'opacity-45' : ''
                    }`}
                    title={dockDroneOnline ? 'AI识别' : dockAiDisabledReason}
                  >
                    <div className={`relative w-14 h-14 rounded-lg border flex items-center justify-center shadow-lg transition-colors ${
                      !dockDroneOnline
                        ? 'bg-[#1a1a1a] border-gray-600'
                        : (showDockAiPanel || dockIdentifyOn
                          ? 'bg-emerald-700/90 border-emerald-400'
                          : 'bg-[#0b376f] border-[#1177d8] group-hover:bg-[#0d4d99]')
                    }`}>
                      <ScanEye size={30} className={dockDroneOnline ? 'text-emerald-200' : 'text-gray-500'} />
                      {dockIdentifyOn && dockDroneOnline && (
                        <span className="absolute -right-1 -top-1 w-3 h-3 rounded-full bg-emerald-400 border border-black/40" />
                      )}
                    </div>
                    <span className="text-base font-bold drop-shadow">AI识别</span>
                  </button>
                </div>

                {/* AI识别浮窗 */}
                {showDockAiPanel && (
                  <div className="absolute left-24 top-1/2 -translate-y-1/2 z-40 w-[280px] bg-[#1a1a1a]/95 border border-white/15 rounded-lg shadow-2xl backdrop-blur-sm">
                    <div className="h-10 px-3 flex items-center justify-between border-b border-white/10">
                      <span className="text-sm font-medium text-white">AI识别</span>
                      <button
                        type="button"
                        onClick={() => setShowDockAiPanel(false)}
                        className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="p-3 space-y-4">
                      {!dockDroneOnline && (
                        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-5 text-amber-200">
                          绑定无人机未开机（未连接），AI识别开关已禁用。请先开机并确认飞行器已连接。
                        </div>
                      )}

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-xs text-gray-400">DRC 链路</div>
                            <div className={`text-sm mt-0.5 ${
                              dockDrcConnected ? 'text-emerald-400' : 'text-gray-400'
                            }`}>
                              {dockDrcStatus?.drcStateText
                                || (dockDrcConnected ? '已连接' : '未连接')}
                              {dockDrcStatus?.drcState != null ? ` (${dockDrcStatus.drcState})` : ''}
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            {!dockDrcConnected ? (
                              <button
                                type="button"
                                disabled={dockAiBusy || !dockDroneOnline}
                                onClick={enterDockDrc}
                                className="h-8 px-2.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40"
                              >
                                进入 DRC
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={dockAiBusy}
                                onClick={exitDockDrc}
                                className="h-8 px-2.5 rounded text-xs font-medium bg-[#3a3a3a] hover:bg-[#444] text-gray-200 disabled:opacity-40"
                              >
                                退出
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="text-[10px] leading-4 text-gray-500">
                          模型列表依赖 DRC 已连接（drc_status_notify=2）后设备上报 ai_model_list。
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs text-gray-400">AI识别开关</div>
                            <div className={`text-sm mt-0.5 ${
                              !dockDroneOnline
                                ? 'text-gray-600'
                                : (dockIdentifyOn ? 'text-emerald-400' : 'text-gray-500')
                            }`}>
                              {!dockDroneOnline ? '不可用' : (dockIdentifyOn ? '开' : '关')}
                            </div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={dockIdentifyOn}
                            aria-label="AI识别开关"
                            disabled={dockAiBusy || !dockDroneOnline}
                            onClick={() => setDockIdentify(!dockIdentifyOn)}
                            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
                              dockIdentifyOn && dockDroneOnline ? 'bg-emerald-500' : 'bg-[#3a3a3a]'
                            }`}
                          >
                            <span
                              className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 ${
                                dockIdentifyOn ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      </div>

                      {dockIdentifyOn && (
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="text-xs text-gray-400">AI模型</div>
                            <div className="text-[10px] text-gray-500">来自 drc_ai_info_push</div>
                          </div>
                          {dockAiModels.length > 0 ? (
                            <div className="grid grid-cols-1 gap-2">
                              {dockAiModels.map((m) => {
                                const active = dockSelectedIndex === m.index
                                return (
                                  <button
                                    key={`${m.index}-${m.name}`}
                                    type="button"
                                    disabled={dockAiBusy || !dockDroneOnline}
                                    onClick={() => selectDockAiModel(m.index)}
                                    className={`min-h-9 px-2 py-1.5 rounded text-left text-sm font-medium transition-colors disabled:opacity-50 ${
                                      active
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-[#2a2a2a] text-gray-200 hover:bg-[#333]'
                                    }`}
                                  >
                                    <span className="block truncate">{m.name}</span>
                                    <span className={`block text-[10px] mt-0.5 ${active ? 'text-blue-100' : 'text-gray-500'}`}>
                                      index={m.index}
                                    </span>
                                  </button>
                                )
                              })}
                            </div>
                          ) : (
                            <div className="rounded border border-white/10 bg-black/30 px-2.5 py-2 text-[11px] leading-5 text-gray-400">
                              尚未收到模型列表。订阅主题：
                              <code className="text-gray-300">thing/product/{'{gateway_sn}'}/drc/up</code>
                              ，method=
                              <code className="text-gray-300">drc_ai_info_push</code>
                              。需 DRC 已连接后设备主动上报
                              <code className="text-gray-300">ai_model_list</code>
                              。
                            </div>
                          )}
                          {Array.isArray(dockAiInfo?.models) && dockAiInfo.models.length > 0 && (
                            <div className="mt-2 max-h-24 overflow-auto rounded bg-black/40 px-2 py-1.5 text-[10px] leading-4 text-gray-500 font-mono">
                              {dockAiInfo.models.map((m) => (
                                <div key={`raw-${m.index}-${m.name || m.signedName}`}>
                                  [{m.index}] {m.signedName || m.name}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {dockIdentifyOn && (
                        <div className="space-y-2">
                          <div className="text-xs text-gray-400">目标跟随</div>
                          {dockTracking ? (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm text-amber-300">
                                跟随中 #{dockTrackIndex ?? '—'}
                              </span>
                              <button
                                type="button"
                                disabled={dockAiBusy || !dockDroneOnline}
                                onClick={stopDockSpotlightTrack}
                                className="h-8 px-3 rounded text-xs font-medium bg-red-600/90 hover:bg-red-500 text-white disabled:opacity-50"
                              >
                                停止跟随
                              </button>
                            </div>
                          ) : (
                            <p className="text-[11px] leading-5 text-gray-500">
                              点击画面中的检测框，机载云台将对准该目标持续跟随。
                            </p>
                          )}
                        </div>
                      )}

                      {dockAiBusy && (
                        <div className="flex items-center gap-2 text-xs text-amber-300">
                          <Loader2 size={12} className="animate-spin" />
                          下发中…
                        </div>
                      )}
                      {dockAiHint && (
                        <p className="text-[11px] leading-5 text-gray-400 break-words">{dockAiHint}</p>
                      )}
                      {dockIdentifyOn && (
                        <p className="text-[11px] leading-5 text-gray-500">
                          识别框来自直播 SEI。
                          {dockSeiStatus
                            ? ` 状态：${dockSeiStatus.hooked ? '已挂接' : '未挂接'} · SEI命中 ${dockSeiStatus.seiHit || 0} · ${dockSeiStatus.hint || ''}`
                            : ' 等待播流挂接…'}
                          {dockIdentifyOn && dockSeiStatus?.hooked && (dockSeiStatus.seiHit || 0) === 0
                            ? ' 若长期无框：流媒体可能剥离了 SEI，需在推流/转封装侧保留 SEI。'
                            : ''}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Canvas 覆盖层 - AI检索框选 */}
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full z-20 pointer-events-none"
                  style={{ objectFit: 'contain' }}
                />
                {/* Canvas 覆盖层 - 机载 AI 识别框（SEI），可点击选中跟随 */}
                <canvas
                  ref={dockAiCanvasRef}
                  onClick={onDockAiCanvasClick}
                  className={`absolute inset-0 w-full h-full z-[21] ${
                    dockIdentifyOn && dockDroneOnline ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'
                  }`}
                />
                {dockIdentifyOn && dockDroneOnline && (
                  <div className={`absolute right-3 bottom-3 z-30 px-2 py-1 rounded bg-black/55 text-[11px] border ${
                    dockTracking
                      ? 'text-amber-300 border-amber-500/40'
                      : 'text-emerald-300 border-emerald-500/30'
                  }`}>
                    {dockTracking
                      ? `跟随中 · #${dockTrackIndex ?? '—'}`
                      : (dockAiTargetCount > 0
                        ? `机载识别 · ${dockAiTargetCount} 目标 · 点击框跟随`
                        : (dockSeiStatus?.seiHit > 0
                          ? '机载识别 · SEI有、暂无目标'
                          : (dockSeiStatus?.hooked
                            ? '机载识别 · 等待SEI（流内可能无SEI）'
                            : '机载识别 · SEI挂接中…')))}
                  </div>
                )}
              </>
            )}
            </div>
          </div>
        </div>
      </div>

      {/* 底部状态条 */}
      <div className="px-4 py-1.5 bg-gray-900 border-t border-gray-700 flex items-center justify-between text-xs text-gray-500">
        <span>SN: {deviceId}</span>
        <span className="flex items-center gap-1.5">
          <LogoMark variant="icon" className="!h-4 !w-6" />
          虚拟座舱 · {device.deviceName || deviceId}
        </span>
        <span className={`flex items-center gap-1 ${
          subDeviceOnline === 1 ? 'text-green-400' : 'text-red-400'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${subDeviceOnline === 1 ? 'bg-green-400' : 'bg-red-400'}`} />
          {subDeviceOnline === 1 ? '无人机已连接' : '无控制权·飞行器未连接'}
        </span>
      </div>

      {/* AI检索弹窗 */}
      {showAiSearch && (
        <div className="absolute inset-0 z-[70] bg-black/60 flex items-center justify-center">
          <div className="bg-[#1a1a1a] border border-[#333] rounded-lg shadow-2xl w-[480px]">
            <div className="h-10 px-4 flex items-center justify-between border-b border-white/10">
              <span className="text-sm font-medium text-white">AI多模态检索</span>
              <button
                onClick={() => { setShowAiSearch(false); setIsAnalyzing(false) }}
                className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* 搜索标签 */}
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">告警标签（多模态分析提示词）</label>
                <div className="min-h-[72px] p-2 bg-[#252525] border border-[#444] rounded flex flex-wrap gap-2">
                  {aiSearchTags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-600/80 text-white text-xs rounded hover:bg-purple-500/80 transition-colors"
                    >
                      {tag}
                      <button
                        onClick={() => setAiSearchTags(aiSearchTags.filter((_, i) => i !== idx))}
                        className="hover:text-white/80"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && tagInput.trim()) {
                        e.preventDefault()
                        if (!aiSearchTags.includes(tagInput.trim())) {
                          setAiSearchTags([...aiSearchTags, tagInput.trim()])
                        }
                        setTagInput('')
                      }
                    }}
                    placeholder={aiSearchTags.length === 0 ? "输入标签按回车添加..." : ""}
                    className="flex-1 min-w-[80px] bg-transparent text-sm text-white placeholder-gray-500 outline-none"
                  />
                </div>
                <p className="text-[11px] text-gray-500 mt-1.5">基于告警标签进行目标搜索，并保存告警记录</p>
              </div>
              {/* 绘制模式 */}
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block">边界框绘制模式</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDrawMode('frontend')}
                    className={`flex-1 h-9 rounded text-sm border transition-colors ${
                      drawMode === 'frontend'
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-[#252525] border-[#444] text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    前端 Canvas
                  </button>
                  <button
                    onClick={() => setDrawMode('python')}
                    className={`flex-1 h-9 rounded text-sm border transition-colors ${
                      drawMode === 'python'
                        ? 'bg-green-700 border-green-500 text-white'
                        : 'bg-[#252525] border-[#444] text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    Python Pillow
                  </button>
                </div>
                <p className="text-[11px] text-gray-600 mt-1">
                  {drawMode === 'python' ? '✅ Python 在原图上绘制，坐标精确' : '🖼 Canvas 覆盖层，不修改原图'}
                </p>
              </div>
              {/* 截帧间隔 */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="text-xs text-gray-400 mb-1.5 block flex items-center gap-1">
                    <Camera size={12} />
                    截帧间隔（秒）
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      value={captureInterval}
                      onChange={(e) => setCaptureInterval(Number(e.target.value))}
                      className="flex-1 h-1 bg-[#444] rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-sm text-white w-8 text-center">{captureInterval}s</span>
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-gray-400 mb-1.5 block">最低间隔</label>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Settings size={12} />
                    最小 1 秒
                  </div>
                </div>
              </div>
              {/* AI模型选择 */}
              <div className="mt-4">
                <label className="text-xs text-gray-400 mb-1.5 block flex items-center gap-1">
                  <Brain size={12} />
                  多模态模型
                </label>
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="w-full h-9 px-3 bg-[#333] text-white text-sm rounded border border-[#444] focus:border-[#666] focus:outline-none cursor-pointer"
                >
                  {aiModels.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label} - {model.description}
                    </option>
                  ))}
                </select>
                {/* 额度进度条 */}
                <div className="mt-2">
                  <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                    <span>剩余额度</span>
                    <span>{(() => {
                      const model = aiModels.find(m => m.value === aiModel)
                      if (!model) return '-'
                      const percent = Math.round((model.remaining / model.total) * 100)
                      return `${model.remaining.toLocaleString()}/${model.total.toLocaleString()} (${percent}%)`
                    })()}</span>
                  </div>
                  <div className="w-full h-2 bg-[#333] rounded-full overflow-hidden">
                    {(() => {
                      const model = aiModels.find(m => m.value === aiModel)
                      if (!model) return null
                      const percent = Math.round((model.remaining / model.total) * 100)
                      let color = 'bg-green-500'
                      if (percent < 30) color = 'bg-red-500'
                      else if (percent < 60) color = 'bg-yellow-500'
                      return (
                        <div 
                          className={`h-full ${color} transition-all duration-300`}
                          style={{ width: `${percent}%` }}
                        />
                      )
                    })()}
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-[10px] text-gray-500">
                    <div className="bg-[#252525] rounded px-2 py-1">
                      <span className="text-gray-400">本次消耗：</span>
                      <span className="text-cyan-400">{lastTokenUsage ? lastTokenUsage.total_tokens?.toLocaleString() : 0}</span>
                    </div>
                    <div className="bg-[#252525] rounded px-2 py-1">
                      <span className="text-gray-400">累计消耗：</span>
                      <span className="text-cyan-400">{totalTokenUsage.toLocaleString()}</span>
                    </div>
                    {lastTokenUsage && (
                      <div className="col-span-2 text-[10px] text-gray-600">
                        输入 {lastTokenUsage.input_tokens || 0} / 输出 {lastTokenUsage.output_tokens || 0}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {/* 说明 */}
              <div className="text-xs text-gray-500 leading-5 bg-[#252525] rounded p-3">
                <p>• 系统将每隔 {captureInterval} 秒自动截取无人机画面</p>
                <p>• 调用 {aiModels.find(m => m.value === aiModel)?.label || 'Qwen3-VL'} 多模态模型分析画面内容</p>
                <p>• 检测结果将自动写入左侧「目标告警记录」面板</p>
                <p>• 点击告警可查看框选结果（{drawMode === 'python' ? 'Python Pillow 原图绘制' : '前端 Canvas 绘制'}）</p>
              </div>
              {/* 按钮 */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowAiSearch(false); setIsAnalyzing(false) }}
                  className="flex-1 h-9 bg-[#333] hover:bg-[#444] text-white text-sm rounded transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => { setIsAnalyzing(true); setShowAiSearch(false); setShowAiAlertPanel(true) }}
                  disabled={aiSearchTags.length === 0 || isAnalyzing}
                  className="flex-1 h-9 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900/50 text-white text-sm rounded transition-colors flex items-center justify-center gap-2"
                >
                  {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  开始分析
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showKeyboardHelp && (
        <div className="absolute right-3 top-10 z-[60] w-[560px] bg-[#1f1f1f] border border-white/10 rounded shadow-2xl text-gray-200 overflow-hidden">
          <div className="h-10 px-4 flex items-center justify-between border-b border-white/10 bg-[#252525]">
            <span className="text-sm font-medium text-white">快捷键说明</span>
            <button
              onClick={() => setShowKeyboardHelp(false)}
              className="p-1 hover:bg-white/10 rounded text-gray-300 hover:text-white"
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-4 py-3 flex items-center gap-2 border-b border-white/10">
            <button
              onClick={() => setShowVirtualKeyboard(v => !v)}
              className={`relative w-8 h-[18px] rounded transition-colors ${showVirtualKeyboard ? 'bg-blue-600' : 'bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 w-3.5 h-3.5 rounded bg-white transition-all ${showVirtualKeyboard ? 'left-[17px]' : 'left-0.5'}`} />
            </button>
            <span className="text-xs text-gray-300">飞行界面显示操控按键</span>
          </div>

          <div className="p-4 grid grid-cols-[220px_1fr] gap-5">
            <div className="bg-[#151515] border border-white/10 rounded p-3">
              <div className="grid grid-cols-10 gap-1 text-[10px] text-center text-gray-300">
                {['Esc','1','2','3','4','5','6','7','8','9','0','Q','W','E','R','T','Y','U','I','O','P','A','S','D','F','G','H','J','K','L','Z','X','C','V','B','N','M'].map(k => (
                  <div key={k} className="h-6 leading-6 rounded bg-[#2b2b2b] border border-white/10">{k}</div>
                ))}
              </div>
              <div className="mt-2 h-7 leading-7 text-center text-xs rounded bg-[#2b2b2b] border border-white/10 text-gray-300">Space</div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-xs text-gray-400 mb-3">在直播画面内鼠标可以进行如下操作</div>
                <div className="flex gap-3">
                  <div className="w-12 h-12 rounded-full border border-white/20 flex items-center justify-center text-gray-300">左键</div>
                  <ul className="text-xs leading-6 text-gray-300">
                    <li>鼠标左键双击看向目标</li>
                    <li>鼠标左键长按拖拽微调云台方向</li>
                    <li>鼠标左键单击测温（红外镜头）</li>
                  </ul>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-full border border-white/20 flex items-center justify-center text-gray-300">滚轮</div>
                <ul className="text-xs leading-6 text-gray-300">
                  <li>鼠标中键滑动滚轮进行变焦</li>
                </ul>
              </div>
              <div className="flex gap-3">
                <div className="w-12 h-12 rounded-full border border-white/20 flex items-center justify-center text-gray-300">右键</div>
                <ul className="text-xs leading-6 text-gray-300">
                  <li>鼠标右键框选目标自动变焦</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-t border-white/10 text-xs text-gray-400 leading-6 bg-[#1a1a1a]">
            <span>如何进行 </span>
            <button className="text-blue-400 hover:text-blue-300">飞行控制</button>
            <span> 操作，可点击链接查看说明书。如仍有疑问，可点击 </span>
            <button className="text-blue-400 hover:text-blue-300">客服咨询</button>
            <span> 向司空2团队反馈您的问题</span>
            <div>不同机型的快捷键功能存在差异，详情请见说明书</div>
          </div>
        </div>
      )}

      {/* 告警详情弹窗 */}
      {showAlertDetail && aiAlerts[detailIndex] && (
        <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center">
          <div className="bg-[#1a1a1a] border border-[#333] rounded-lg shadow-2xl w-[900px] max-h-[90vh] flex flex-col">
            {/* 头部 */}
            <div className="h-12 px-4 flex items-center justify-between border-b border-white/10 bg-[#202020] rounded-t-lg">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-white">AI检测详情</span>
                <span className="text-xs text-gray-400">
                  {detailIndex + 1} / {aiAlerts.length}
                </span>
              </div>
              <button
                onClick={() => setShowAlertDetail(false)}
                className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 p-4 overflow-hidden flex gap-4">
              {/* 左侧：图片 + 框选 */}
              <div className="flex-1 relative bg-black rounded overflow-hidden flex items-center justify-center">
                <img
                  src={aiAlerts[detailIndex].frameBase64}
                  alt="检测截图"
                  className="max-w-full max-h-[60vh] object-contain"
                  onLoad={() => {
                    // 图片加载完成后绘制框选
                    setTimeout(() => drawBoxesOnDetail(aiAlerts[detailIndex]), 100)
                  }}
                />
                {!aiAlerts[detailIndex].drawnByPython && (
                  <canvas
                    ref={detailCanvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none z-10"
                  />
                )}
              </div>

              {/* 右侧：信息 */}
              <div className="w-[200px] flex flex-col gap-3">
                <div className="bg-[#252525] rounded p-3">
                  <div className="text-[10px] text-gray-500 mb-1">检测时间</div>
                  <div className="text-sm text-white">{aiAlerts[detailIndex].time}</div>
                </div>
                <div className="bg-[#252525] rounded p-3">
                  <div className="text-[10px] text-gray-500 mb-1">搜索词</div>
                  <div className="text-sm text-white">{aiAlerts[detailIndex].query}</div>
                </div>
                <div className="bg-[#252525] rounded p-3">
                  <div className="text-[10px] text-gray-500 mb-1">检测结果</div>
                  <div className="text-sm text-white">{aiAlerts[detailIndex].boxes.length} 个目标</div>
                </div>
                <div className="flex-1 bg-[#252525] rounded p-3 overflow-y-auto">
                  <div className="text-[10px] text-gray-500 mb-2">目标列表</div>
                  {aiAlerts[detailIndex].boxes.map((box, i) => (
                    <div key={i} className="text-xs text-gray-300 py-1 border-b border-white/5">
                      {i + 1}. {box.label || '目标'}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 底部：切换按钮 */}
            <div className="h-14 px-4 flex items-center justify-between border-t border-white/10 bg-[#202020] rounded-b-lg">
              <button
                onClick={() => {
                  const newIndex = detailIndex > 0 ? detailIndex - 1 : aiAlerts.length - 1
                  setDetailIndex(newIndex)
                }}
                disabled={aiAlerts.length <= 1}
                className="px-4 py-2 bg-[#333] hover:bg-[#444] disabled:bg-[#252525] disabled:text-gray-600 text-white text-sm rounded transition-colors flex items-center gap-2"
              >
                <span>←</span> 上一条
              </button>
              <button
                onClick={() => {
                  const newIndex = detailIndex < aiAlerts.length - 1 ? detailIndex + 1 : 0
                  setDetailIndex(newIndex)
                }}
                disabled={aiAlerts.length <= 1}
                className="px-4 py-2 bg-[#333] hover:bg-[#444] disabled:bg-[#252525] disabled:text-gray-600 text-white text-sm rounded transition-colors flex items-center gap-2"
              >
                下一条 <span>→</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
