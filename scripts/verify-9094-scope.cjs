const { RegionRuntime } = require('../server/lib/region-runtime');
const rr = new RegionRuntime({});
rr.init();

const scopeRoot = rr.getScopeForUser({ regionId: 'gz-jhzd' });
const devRoot = rr.collectDevicesFromScope(scopeRoot.processors);
const zc = devRoot.filter((d) => d.regionId === '9094');

console.log('=== Monitor scope simulation (gz-jhzd 账号) ===');
console.log('Total devices on monitor:', devRoot.length);
console.log('9094 devices on monitor:', zc.length);
console.log('');
console.log('Sample 9094 devices:');
zc.slice(0, 8).forEach((d) => {
  console.log(`  ${d.deviceName || d.deviceId} | online: ${d.online} | ${d.statusText}`);
});
