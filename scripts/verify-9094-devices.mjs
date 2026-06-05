import http from 'http';

const BASE = 'http://localhost:3001';

function request(method, path, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-auth-token': token } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw || '{}') });
        } catch {
          resolve({ status: res.statusCode, data: raw });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const login = await request('POST', '/api/login', {
  body: { username: 'admin', password: 'Admin55640165' },
});
if (login.status !== 200) {
  console.error('Login failed', login);
  process.exit(1);
}

const token = login.data.token;
const [regions, devices, registry] = await Promise.all([
  request('GET', '/api/regions', { token }),
  request('GET', '/api/devices', { token }),
  request('GET', '/api/device-registry', { token }),
]);

const region9094 = regions.data.regions?.find((r) => r.id === '9094');
const zcDevices = (devices.data.devices || []).filter((d) => d.regionId === '9094');
const zcPairs = (registry.data.pairs || []).filter((p) => p.regionId === '9094');

console.log('=== Server verification ===');
console.log(`Login user region: ${login.data.user?.regionId || '(default haizhu)'}`);
console.log(`Visible regions: ${(devices.data.visibleRegionIds || []).join(', ')}`);
console.log('');
console.log('9094 region stats:');
console.log(`  frozen: ${region9094?.frozen}`);
console.log(`  mappings: ${region9094?.mappingCount}`);
console.log(`  MQTT online states: ${region9094?.deviceCount}`);
console.log('');
console.log('Monitor API (/api/devices) for current admin:');
console.log(`  total: ${devices.data.count}`);
console.log(`  9094 count: ${zcDevices.length}`);
console.log('');
console.log('Device registry API for current admin:');
console.log(`  9094 airport pairs: ${zcPairs.length}`);
console.log('');

if (zcDevices.length === 0 && region9094?.deviceCount > 0) {
  console.log('Note: admin 账号绑定海珠区域，监控页默认只看 haizhu。');
  console.log('增城设备已加载（9094 有 ' + region9094.deviceCount + ' 台在线态），需用支队(gz-jhzd)或增城(9094)账号才能在同页看到。');
  console.log('');
}

if (region9094?.mappingCount >= 67 && region9094?.deviceCount > 0) {
  console.log('PASS: 9094 device-registry 已生效，MQTT 已有设备状态。');
} else {
  console.log('WARN: 9094 映射或在线态异常，请检查 registry 文件与 MQTT 连接。');
  process.exit(1);
}
