/**
 * 大疆机场3 / M4T(D) 机载 AI · H.264 SEI 解析
 * 参考：SEI payloadType=0xF5，SubType=0x0007（AI 目标）
 * 坐标：cx/cy/w/h 为画面万分比（0~10000）
 */

const OBJ_TYPE = {
  0: '无效',
  1: '未知',
  2: '人',
  3: '车',
  4: '船',
}

export function objTypeLabel(typeCode) {
  return OBJ_TYPE[typeCode] || `类型${typeCode}`
}

function removeEmulationPrevention(bytes) {
  const out = []
  for (let i = 0; i < bytes.length; i++) {
    if (i >= 2 && bytes[i] === 0x03 && bytes[i - 1] === 0x00 && bytes[i - 2] === 0x00) {
      continue
    }
    out.push(bytes[i])
  }
  return new Uint8Array(out)
}

function parseAiObjectData(dv, start, byteLength) {
  let p = start
  if (p + 22 > byteLength) return null

  const result = {
    version: dv.getUint8(p),
    time_stamp: dv.getUint32(p + 1, true),
    frame_type: dv.getUint8(p + 5),
    track_id: dv.getUint16(p + 18, true),
    obj_group_count: dv.getUint8(p + 21),
    groups: [],
  }
  p += 22

  for (let i = 0; i < result.obj_group_count; i++) {
    if (p + 2 > byteLength) break
    const groupType = dv.getUint8(p)
    const groupCount = dv.getUint8(p + 1)
    p += 2
    const group = { type: groupType, count: groupCount, objects: [] }

    if (groupType === 10) {
      // dji_ai_obj_2d_box_with_distance · 16 bytes / obj
      for (let j = 0; j < groupCount; j++) {
        if (p + 16 > byteLength) break
        const type = dv.getUint8(p + 2)
        group.objects.push({
          id: dv.getUint16(p, true),
          type,
          type_desc: objTypeLabel(type),
          state: dv.getUint8(p + 3),
          cx: dv.getUint16(p + 4, true),
          cy: dv.getUint16(p + 6, true),
          w: dv.getUint16(p + 8, true),
          h: dv.getUint16(p + 10, true),
          distance: dv.getUint32(p + 12, true),
        })
        p += 16
      }
    } else {
      for (let j = 0; j < groupCount; j++) {
        if (p + 3 > byteLength) break
        const type = dv.getUint8(p)
        group.objects.push({
          type,
          type_desc: objTypeLabel(type),
          count: dv.getUint16(p + 1, true),
        })
        p += 3
      }
    }
    result.groups.push(group)
  }
  return result
}

function parseSeiPayloadList(rbsp) {
  const dv = new DataView(rbsp.buffer, rbsp.byteOffset, rbsp.byteLength)
  let offset = 0
  const byteLength = rbsp.byteLength

  while (offset < byteLength) {
    let payloadType = 0
    while (offset < byteLength && rbsp[offset] === 0xff) {
      payloadType += 255
      offset++
    }
    if (offset >= byteLength) break
    payloadType += rbsp[offset++]

    let payloadSize = 0
    while (offset < byteLength && rbsp[offset] === 0xff) {
      payloadSize += 255
      offset++
    }
    if (offset >= byteLength) break
    payloadSize += rbsp[offset++]

    // 0xF5=大疆自定义；兼容误标到 type5 的情况：仍扫内部 0x0007
    if (payloadType === 0xf5 || payloadType === 5) {
      const payloadEnd = Math.min(offset + payloadSize, byteLength)
      let inner = offset
      while (inner + 4 <= payloadEnd) {
        const subType = dv.getUint16(inner, true)
        const subLen = dv.getUint16(inner + 2, true)
        inner += 4
        if (subType === 0x0007) {
          const parsed = parseAiObjectData(dv, inner, byteLength)
          if (parsed) return parsed
        }
        // 防御：异常 subLen
        if (subLen <= 0 || inner + subLen > payloadEnd) break
        inner += subLen
      }
    }
    offset += payloadSize
  }
  return null
}

/**
 * 解析 AVCC 长度前缀后的单条 H.264 SEI NALU（首字节为 nal_header）
 */
export function parseDjiAiFromSeiNalu(nalu) {
  if (!nalu || nalu.length < 2) return null
  if ((nalu[0] & 0x1f) !== 6) return null
  const rbsp = removeEmulationPrevention(nalu.subarray(1))
  return parseSeiPayloadList(rbsp)
}

/**
 * H.265 SEI NALU：nal header 2 字节，其后为 rbsp
 */
export function parseDjiAiFromHevcSeiNalu(nalu) {
  if (!nalu || nalu.length < 3) return null
  const hevcType = (nalu[0] >> 1) & 0x3f
  if (hevcType !== 39 && hevcType !== 40) return null
  const rbsp = removeEmulationPrevention(nalu.subarray(2))
  return parseSeiPayloadList(rbsp)
}

/**
 * 从任意带 startcode 的缓冲中找 SEI（WebRTC Insertable Streams 场景）
 */
export function parseDjiAiFromAnnexB(buffer) {
  if (!buffer || buffer.length < 5) return null
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let i = 0
  while (i < bytes.length - 4) {
    let sc = 0
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) sc = 4
    else if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) sc = 3
    if (!sc) {
      i++
      continue
    }
    const nh = i + sc
    if (nh >= bytes.length) break
    if ((bytes[nh] & 0x1f) === 6) {
      let next = nh + 1
      while (next < bytes.length - 3) {
        if (bytes[next] === 0 && bytes[next + 1] === 0 && bytes[next + 2] === 1) break
        if (bytes[next] === 0 && bytes[next + 1] === 0 && bytes[next + 2] === 0 && bytes[next + 3] === 1) break
        next++
      }
      const parsed = parseDjiAiFromSeiNalu(bytes.subarray(nh, next))
      if (parsed) return parsed
    }
    i = nh + 1
  }
  return null
}

/** 展平为前端画框用目标列表 */
export function flattenAiTargets(aiPayload) {
  if (!aiPayload) return []
  const out = []
  for (const g of aiPayload.groups || []) {
    if (g.type !== 10) continue
    for (const o of g.objects || []) {
      if (!o || o.w <= 0 || o.h <= 0) continue
      // 万分比坐标粗校验
      if (o.cx > 10000 || o.cy > 10000 || o.w > 10000 || o.h > 10000) continue
      out.push({
        id: o.id,
        /** 官方 drc_ai_spotlight_zoom_track.data.target_index */
        targetIndex: Number(o.id),
        type: o.type,
        label: o.type_desc || objTypeLabel(o.type),
        cx: o.cx,
        cy: o.cy,
        w: o.w,
        h: o.h,
        distanceMm: o.distance,
      })
    }
  }
  // 不再因 frame_type===0 直接丢弃：现场偏移偏差时仍可能带有效 groups
  return out
}
