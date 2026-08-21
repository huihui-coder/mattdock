/**
 * 挂钩 flv.js：从 H.264/H.265 FLV 视频标签中抽取大疆 AI SEI
 * 双通道：demuxer NALU 钩子 + IO 原始 chunk 扫描（流媒体偶发剥 SEI 时便于排查）
 */

import {
  flattenAiTargets,
  parseDjiAiFromAnnexB,
  parseDjiAiFromSeiNalu,
  parseDjiAiFromHevcSeiNalu,
} from './dji-ai-sei'

function getController(player) {
  return player?._transmuxer?._controller || null
}

function getDemuxer(player) {
  return getController(player)?._demuxer || null
}

function tryParseAiFromAvccNalu(nalu) {
  if (!nalu || nalu.length < 2) return null
  // H.264 SEI = 6
  if ((nalu[0] & 0x1f) === 6) {
    return parseDjiAiFromSeiNalu(nalu)
  }
  // H.265 PREFIX/SUFFIX SEI = 39 / 40
  const hevcType = (nalu[0] >> 1) & 0x3f
  if (hevcType === 39 || hevcType === 40) {
    return parseDjiAiFromHevcSeiNalu(nalu)
  }
  return null
}

/**
 * 在任意字节流中找 AVCC/AnnexB SEI，并尝试解 DJI AI
 */
function scanBufferForAi(bytes) {
  if (!bytes || bytes.length < 8) return null
  // 1) Annex-B startcode
  const annex = parseDjiAiFromAnnexB(bytes)
  if (annex) return annex

  // 2) 暴力扫：当作 length-prefixed NALU 流
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let lengthSize of [4, 3]) {
    let offset = 0
    while (offset + lengthSize + 1 < bytes.length) {
      let naluSize = lengthSize === 4
        ? v.getUint32(offset, false)
        : ((bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2])
      if (naluSize <= 0 || naluSize > bytes.length - offset - lengthSize || naluSize > 2_000_000) {
        break
      }
      const nalu = bytes.subarray(offset + lengthSize, offset + lengthSize + naluSize)
      const parsed = tryParseAiFromAvccNalu(nalu)
      if (parsed) return parsed
      offset += lengthSize + naluSize
    }
  }

  // 3) 在缓冲里直接找 0xF5 + little-endian subType 0x0007
  for (let i = 0; i < bytes.length - 8; i++) {
    if (bytes[i] !== 0xf5) continue
    // 常见形态：… F5 <size…> 07 00 <len> …
    for (let j = i + 1; j < Math.min(i + 12, bytes.length - 4); j++) {
      if (bytes[j] === 0x07 && bytes[j + 1] === 0x00) {
        const fromNal = tryParseAiFromAvccNalu(bytes.subarray(Math.max(0, i - 1)))
        if (fromNal) return fromNal
        const annex2 = parseDjiAiFromAnnexB(bytes.subarray(Math.max(0, i - 6)))
        if (annex2) return annex2
      }
    }
  }
  return null
}

/**
 * @param {object} player flv.js player
 * @param {(targets: Array) => void} onTargets
 * @param {(status: object) => void} [onStatus]
 * @returns {() => void} detach
 */
export function attachFlvSeiTap(player, onTargets, onStatus) {
  if (!player || typeof onTargets !== 'function') return () => {}

  let detached = false
  let hookedDemux = false
  let hookedIo = false
  let lastSig = ''
  let timer = null
  let seiHit = 0
  let naluSeen = 0
  let lastHint = ''

  const report = (hint) => {
    if (hint) lastHint = hint
    onStatus?.({
      hooked: hookedDemux || hookedIo,
      hookedDemux,
      hookedIo,
      seiHit,
      naluSeen,
      hint: lastHint,
    })
  }

  const emitParsed = (parsed, source) => {
    if (!parsed) return
    seiHit += 1
    const targets = flattenAiTargets(parsed)
    const sig = targets.map((t) => `${t.id}:${t.cx}:${t.cy}:${t.w}:${t.h}`).join('|')
    // 有目标或从有→无都要推，避免 UI 卡在旧框；空且与上次相同则跳过
    if (sig === lastSig && targets.length === 0) {
      report(`SEI@${source} 空目标`)
      return
    }
    if (sig === lastSig) return
    lastSig = sig
    onTargets(targets)
    report(`SEI@${source} 目标=${targets.length}`)
    if (targets.length) {
      console.log(`[机载AI] SEI 命中(${source}) targets=`, targets.length, targets.slice(0, 3))
    }
  }

  const scanAvcPacket = (arrayBuffer, dataOffset, dataSize, lengthSizeHint) => {
    if (detached || dataSize < 5) return
    const lengthSize = lengthSizeHint || 4
    const v = new DataView(arrayBuffer, dataOffset, dataSize)
    let offset = 0
    while (offset + lengthSize < dataSize) {
      let naluSize = v.getUint32(offset, false)
      if (lengthSize === 3) naluSize >>>= 8
      if (naluSize <= 0 || offset + lengthSize + naluSize > dataSize) break
      naluSeen += 1
      const nalu = new Uint8Array(arrayBuffer, dataOffset + offset + lengthSize, naluSize)
      const parsed = tryParseAiFromAvccNalu(nalu)
      if (parsed) emitParsed(parsed, 'demux')
      offset += lengthSize + naluSize
    }
  }

  const hookDemuxer = (demuxer) => {
    if (!demuxer || demuxer.__djiSeiHooked) return !!demuxer.__djiSeiHooked
    if (typeof demuxer._parseAVCVideoData === 'function') {
      const orig = demuxer._parseAVCVideoData.bind(demuxer)
      demuxer._parseAVCVideoData = function (arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition, frameType, cts) {
        try {
          scanAvcPacket(arrayBuffer, dataOffset, dataSize, this._naluLengthSize || 4)
        } catch {
          /* ignore */
        }
        return orig(arrayBuffer, dataOffset, dataSize, tagTimestamp, tagPosition, frameType, cts)
      }
    }
    // 部分构建会走 HEVC 路径
    if (typeof demuxer._parseHEVCVideoData === 'function') {
      const origH = demuxer._parseHEVCVideoData.bind(demuxer)
      demuxer._parseHEVCVideoData = function (arrayBuffer, dataOffset, dataSize, ...rest) {
        try {
          scanAvcPacket(arrayBuffer, dataOffset, dataSize, this._naluLengthSize || 4)
        } catch {
          /* ignore */
        }
        return origH(arrayBuffer, dataOffset, dataSize, ...rest)
      }
    }
    demuxer.__djiSeiHooked = true
    return true
  }

  const hookIo = (controller) => {
    if (!controller || controller.__djiSeiIoHooked) return !!controller.__djiSeiIoHooked
    if (typeof controller._onLoaderChunkArrival !== 'function') return false
    const orig = controller._onLoaderChunkArrival.bind(controller)
    let stash = new Uint8Array(0)
    controller._onLoaderChunkArrival = function (data, byteStart, receivedLength) {
      try {
        if (!detached && data) {
          const chunk = data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : (data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null)
          if (chunk && chunk.length) {
            // 保留尾部，避免 SEI 跨包
            const merged = new Uint8Array(stash.length + chunk.length)
            merged.set(stash, 0)
            merged.set(chunk, stash.length)
            const parsed = scanBufferForAi(merged)
            if (parsed) emitParsed(parsed, 'io')
            stash = merged.subarray(Math.max(0, merged.length - 64 * 1024))
          }
        }
      } catch {
        /* ignore */
      }
      return orig(data, byteStart, receivedLength)
    }
    controller.__djiSeiIoHooked = true
    return true
  }

  const tryAttach = () => {
    if (detached) return
    const demuxer = getDemuxer(player)
    const controller = getController(player)
    if (!hookedDemux && demuxer && hookDemuxer(demuxer)) {
      hookedDemux = true
      console.log('[机载AI] SEI tap → demuxer')
      report('demuxer 已挂接')
    }
    if (!hookedIo && controller && hookIo(controller)) {
      hookedIo = true
      console.log('[机载AI] SEI tap → IO chunk')
      report('IO 已挂接')
    }
    if ((hookedDemux || hookedIo) && timer) {
      clearInterval(timer)
      timer = null
    }
  }

  tryAttach()
  if (!hookedDemux && !hookedIo) {
    timer = setInterval(tryAttach, 150)
    setTimeout(() => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      if (!hookedDemux && !hookedIo && !detached) {
        console.warn('[机载AI] SEI tap 挂接失败')
        report('挂接失败：无法访问 flv demuxer/IO')
      }
    }, 15000)
  }

  report(hookedDemux || hookedIo ? '挂接中…' : '等待挂接…')

  return () => {
    detached = true
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
}
