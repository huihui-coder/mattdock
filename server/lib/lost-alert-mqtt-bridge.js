/**
 * 飞丢告警子进程通过主进程 HTTP 代理下发 MQTT（复用主进程已认证的连接）
 */
const http = require('http');

function getJobSecret() {
  return process.env.LOST_ALERT_JOB_SECRET || 'local-lost-alert-job';
}

function requestJson(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-job-secret': getJobSecret(),
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (res.statusCode >= 400) {
              reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function createLostAlertMqttBridge(port = process.env.LOST_ALERT_MAIN_PORT || process.env.PORT || 3001) {
  const basePort = Number(port) || 3001;
  return {
    isConnected() {
      return true;
    },
    async ensureConnected(timeoutMs = 20000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const status = await requestJson(basePort, '/api/internal/lost-alert/status');
          if (status.mqttConnected) return;
        } catch {
          /* 主进程尚未就绪 */
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error('主进程 MQTT 连接超时');
    },
    publishService(deviceId, method, data) {
      return requestJson(basePort, '/api/internal/lost-alert/service', {
        method: 'POST',
        body: { deviceId, method, data },
      });
    },
  };
}

module.exports = { createLostAlertMqttBridge, getJobSecret };
