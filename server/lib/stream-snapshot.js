const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const STREAM_BASE = (process.env.STREAM_BASE_URL || 'https://www.hzdkjw.com:1443/live').replace(
  /\/$/,
  '',
);

const SUFFIX_LABELS = {
  _out: '机场外部画面',
  _in: '机场内部画面',
  _flight: '无人机画面',
};

/**
 * 从直播流截取一帧 JPEG
 * @returns {Promise<{ buffer: Buffer, base64: string, mime: string, suffix: string, label: string } | null>}
 */
function captureStreamSnapshot(deviceId, suffix = '_out', timeoutMs = 15000) {
  const streamUrl = `${STREAM_BASE}/${deviceId}${suffix}.live.flv`;
  const tmpFile = path.join(os.tmpdir(), `snapshot_${crypto.randomBytes(6).toString('hex')}.jpg`);
  const args = ['-y', '-i', streamUrl, '-frames:v', '1', '-q:v', '2', '-t', '10', tmpFile];

  return new Promise((resolve) => {
    execFile('ffmpeg', args, { timeout: timeoutMs }, (err) => {
      if (err || !fs.existsSync(tmpFile)) {
        resolve(null);
        return;
      }
      try {
        const buffer = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);
        resolve({
          buffer,
          base64: buffer.toString('base64'),
          mime: 'image/jpeg',
          suffix,
          label: SUFFIX_LABELS[suffix] || suffix,
        });
      } catch {
        try {
          if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        } catch {
          /* ignore */
        }
        resolve(null);
      }
    });
  });
}

async function captureStreamSnapshots(deviceId, suffixes) {
  const shots = await Promise.all(suffixes.map((suffix) => captureStreamSnapshot(deviceId, suffix)));
  return shots.filter(Boolean);
}

module.exports = {
  STREAM_BASE,
  SUFFIX_LABELS,
  captureStreamSnapshot,
  captureStreamSnapshots,
};
