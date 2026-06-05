const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const { buildStreamUrl, getDefaultStreamConfig } = require('./region-connectivity');

const STREAM_BASE = getDefaultStreamConfig().baseUrl;

const SUFFIX_LABELS = {
  _out: '机场外部画面',
  _in: '机场内部画面',
  _flight: '无人机画面',
};

/**
 * 从直播流截取一帧 JPEG
 * @returns {Promise<{ buffer: Buffer, base64: string, mime: string, suffix: string, label: string } | null>}
 */
function captureStreamSnapshot(deviceId, suffix = '_out', timeoutMs = 15000, regionId = null) {
  const streamUrl = regionId
    ? buildStreamUrl(regionId, deviceId, suffix)
    : `${STREAM_BASE}/${deviceId}${suffix}.live.flv`;
  const tmpFile = path.join(os.tmpdir(), `snapshot_${crypto.randomBytes(6).toString('hex')}.jpg`);
  const args = [
    '-y',
    '-rw_timeout', '15000000',
    '-fflags', 'nobuffer',
    '-analyzeduration', '500000',
    '-probesize', '500000',
    '-i', streamUrl,
    '-frames:v', '1',
    '-update', '1',
    '-q:v', '2',
    tmpFile,
  ];

  const readSnapshot = () => {
    if (!fs.existsSync(tmpFile)) return null;
    try {
      const buffer = fs.readFileSync(tmpFile);
      fs.unlinkSync(tmpFile);
      if (!buffer.length) return null;
      return {
        buffer,
        base64: buffer.toString('base64'),
        mime: 'image/jpeg',
        suffix,
        label: SUFFIX_LABELS[suffix] || suffix,
      };
    } catch {
      try {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      } catch {
        /* ignore */
      }
      return null;
    }
  };

  return new Promise((resolve) => {
    execFile('ffmpeg', args, { timeout: timeoutMs, windowsHide: true }, (err) => {
      const shot = readSnapshot();
      if (shot) {
        resolve(shot);
        return;
      }
      const regionHint = regionId ? ` region=${regionId}` : '';
      if (err) {
        console.warn(
          `[StreamSnapshot] ffmpeg 失败 ${deviceId}${suffix}${regionHint}:`,
          err.message || err,
        );
        console.warn(`[StreamSnapshot] 推流地址: ${streamUrl.replace(/token=[^&]+/, 'token=***')}`);
      } else {
        console.warn(`[StreamSnapshot] 未生成截图文件 ${deviceId}${suffix}${regionHint}`);
        console.warn(`[StreamSnapshot] 推流地址: ${streamUrl.replace(/token=[^&]+/, 'token=***')}`);
      }
      resolve(null);
    });
  });
}

async function captureStreamSnapshots(deviceId, suffixes, regionId = null) {
  const shots = await Promise.all(
    suffixes.map((suffix) => captureStreamSnapshot(deviceId, suffix, 15000, regionId)),
  );
  return shots.filter(Boolean);
}

module.exports = {
  STREAM_BASE,
  SUFFIX_LABELS,
  captureStreamSnapshot,
  captureStreamSnapshots,
};
