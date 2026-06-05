require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const { captureStreamSnapshot, STREAM_BASE } = require('../lib/stream-snapshot');

const deviceId = process.env.TEST_DEVICE_ID || process.argv[2] || '7CTDM1200B453R';
const outDir = path.join(__dirname, '../data/snapshot-test');

async function test(suffix) {
  const t0 = Date.now();
  console.log(`\n--- ${suffix} ---`);
  console.log(`URL: ${STREAM_BASE}/${deviceId}${suffix}.live.flv`);
  const shot = await captureStreamSnapshot(deviceId, suffix, 90000);
  const ms = Date.now() - t0;
  if (!shot) {
    console.log(`FAIL ${suffix} (${ms}ms)`);
    return false;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${deviceId}${suffix}.jpg`);
  fs.writeFileSync(file, shot.buffer);
  console.log(`OK ${suffix} ${shot.buffer.length} bytes (${ms}ms)`);
  console.log(`保存: ${file}`);
  return true;
}

(async () => {
  console.log(`设备: ${deviceId}`);
  const suffixes = ['_out', '_flight'];
  const results = [];
  for (const suffix of suffixes) {
    results.push(await test(suffix));
  }
  const ok = results.filter(Boolean).length;
  console.log(`\n结果: ${ok}/${results.length} 成功`);
  process.exit(ok === results.length ? 0 : 1);
})();
