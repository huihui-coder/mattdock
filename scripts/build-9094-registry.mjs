import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(__dirname, '../haizhuDB/regions/9094/device-registry.json');

/** [airportSn, droneSn|null, airportName, droneName|null] */
const pairs = [
  ['NEST44202603U007', '1581F9HEC252H00C4RF4', '新塘街道-私立华联（换电）', '新塘街道-M4换电机场-无人机'],
  ['NEST44202512U002', '1581F9HEC258T00CW0Y9', '棠下街道-添玺（换电）', '棠下街道-M4T无人机'],
  ['7CTXN7M00B0CXM', '1581F6Q8X254E00G07TM', '螺涌村委会大疆机场2', '螺涌村委会M3TD无人机'],
  ['AHRXN9600A00P8', '1581F9F4X25AF00A00SJ', '萝岗派出所大疆机场3', '萝岗派出所M4TD无人机'],
  ['AHRXN7R00A0075', '1581F9F4X257L00A00D0', '凤凰城大疆机场3', '凤凰城M4TD无人机'],
  ['7CTXN4R00B09V0', '1581F6Q8X254B00G07MR', '槎龙村大疆机场2', '槎龙村M3TD无人机'],
  ['AHRXN7R00A007Q', '1581F9F4X257L00A00AK', '新塘镇久裕村大疆机场3', '新塘镇久裕村M4TD无人机'],
  ['AHRXN6L00A003W', '1581F9F4X257L00A009V', '科教城大疆机场3', '科教城机场M4TD无人机'],
  ['AHRXN9600A00PU', '1581F9F4X25AF00A00X7', '白云分局大疆机场3', '白云分局大疆机场3-无人机'],
  ['NEST44202512U017', '1581F9HEC258T00CWZRT', '冼村街道-富力盈隆（换电）', '冼村街道-富力盈隆M4T无人机'],
  ['NEST44202512U001', '1581F9HEC257L00C5JK6', '猎德街道-污水厂（换电）', '猎德街道-M4T无人机'],
  ['AHRXN9600A00PR', '1581F9F4X25AF00A00W1', '万顷沙所大疆机场3', '万顷沙所机场M4T无人机'],
  ['7CTXN4G00B09FL', '1581F6Q8X254B00G07P4', '松洲所江南市场警务室', '松洲所江南市场警务室-无人机'],
  ['7CTDLCS00B0LF8', '1581F6Q8D245F00ERD92', '交警大队大疆机场2', '交警大队M3TD无人机'],
  ['AHRXN7R00A0082', '1581F9F4X257L00A00BH', '广英大疆机场3', '广英M4TD无人机'],
  ['NEST45202508U003-2', '1581F9HYC257T00B12P4', '广州市局车载机场02', '广州市局车载02-无人机'],
  ['NEST45202508U003-1', '1581F9HEC258T00C69BV', '广州市局车载01', '广州市局车载01-无人机'],
  ['AHRXN7R00A00CU', '1581F9F4X257L00A00DD', '派潭镇大疆机场3', '派潭镇M4TD无人机'],
  ['AHRXN9600A00QL', '1581F9F4X25AF00A00US', '三元里所大疆机场3', '三元里所M4TD无人机'],
  ['7CTDM6500BPJD4', '1581F6Q8X254E00G07VX', '松洲所大疆机场2', '松洲所M3TD'],
  ['NEST10202210U001', '1581F5FJC253L00D07PR', '海心沙M3充电机场', '阳光酒店御3换电机场-无人机'],
  ['NEST45202511U011-2', '1581F7K3C255600DVCWQ', 'NEST45202511U011-2', 'NEST45202511U001-2-无人机'],
  ['NEST45202511U011-1', '1581F7K3C255600DF649', 'NEST45202511U011-1', 'NEST45202511U001-1-无人机'],
  ['AHRXN9600A00P6', '1581F9F4X25AF00A0139', '天河南街道大疆机场3', '天河南街道M4TD无人机'],
  ['AHRXN9900A00U9', '1581F9F4X25AF00A00U7', '天河政务中心大疆机场3', '天河政务中心M4TD无人机'],
  ['AHRXN9600A00PJ', '1581F9F4X25AF00A00Y8', '凤凰派出所大疆机场3', '凤凰派出所机场M4TD无人机'],
  ['AHRXN9600A00QF', '1581F9F4X25AF00A00X9', '珠村小学-大疆机场3', '珠村小学-大疆机场3-无人机'],
  ['AHRXN9600A00QE', '1581F9F4X25AF00A00UB', '员村大疆机场3', '员村M4TD无人机'],
  ['NEST45202511U001-2', '1581F9HEC259S00CKTBC', 'NEST45202511U001-2', 'NEST45202511U001-2-无人机'],
  ['NEST45202511U001-1', '1581F9HEC258T00CSGJJ', 'NEST45202511U001-1', 'NEST45202511U001-1-无人机'],
  ['AHRXN9900A00VF', '1581F9F4X25AF00A010X', '沙河宾馆大疆机场3', '沙河宾馆M4TD无人机'],
  ['AHRXN9600A00PQ', '1581F9F4X25AF00A00WC', '天河新天地大疆机场3', '天河新天地M4TD无人机'],
];

const standalone = [
  ['NEO002', 'NEO测试'],
  ['NEST45202508U003-PAD', '车载平板设备'],
  ['7CTDM4S00BHW8S', '白云站所大疆机场2'],
];

const mappings = {};
const bindings = {};

for (const [airportSn, droneSn, airportName, droneName] of pairs) {
  mappings[airportSn] = { name: airportName, category: 'airport' };
  if (droneSn && droneName) {
    mappings[droneSn] = { name: droneName, category: 'airport_drone' };
    bindings[airportSn] = droneSn;
  }
}

for (const [sn, name] of standalone) {
  mappings[sn] = { name, category: 'airport' };
}

const payload = {
  meta: {
    frozen: true,
    frozenAt: new Date().toISOString(),
    regionId: '9094',
    source: 'manual-import',
  },
  mappings,
  bindings,
  remoteBindings: {},
  remoteBindingsCustom: [],
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
console.log(`Wrote ${Object.keys(mappings).length} mappings, ${Object.keys(bindings).length} bindings → ${outFile}`);
