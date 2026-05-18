const WebSocket = require('ws');

class WebSocketService {
  constructor(port) {
    this.port = port;
    this.wss = null;
    this.clients = new Set();
  }

  /**
   * 挂载到已有 HTTP server 的 /ws 路径（生产模式）
   */
  attachToServer(httpServer) {
    this.wss = new WebSocket.Server({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === '/ws') {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    this._bindEvents();
    console.log(`[WS] WebSocket服务已挂载到 HTTP server /ws`);
  }

  start() {
    this.wss = new WebSocket.Server({ port: this.port });
    this._bindEvents();
    console.log(`[WS] WebSocket服务已启动，端口: ${this.port}`);
  }

  _bindEvents() {
    this.wss.on('connection', (ws) => {
      console.log(`[WS] 新客户端连接，当前连接数: ${this.clients.size + 1}`);
      this.clients.add(ws);

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log(`[WS] 客户端断开，当前连接数: ${this.clients.size}`);
      });

      ws.on('error', (error) => {
        console.error('[WS] 客户端错误:', error.message);
        this.clients.delete(ws);
      });

      // 发送欢迎消息
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'WebSocket连接成功',
        timestamp: new Date().toISOString()
      }));
    });

    this.wss.on('error', (error) => {
      console.error('[WS] 服务器错误:', error.message);
    });

    console.log(`[WS] WebSocket服务已启动，端口: ${this.port}`);
  }

  /**
   * 广播消息给所有客户端
   */
  broadcast(data) {
    const message = JSON.stringify(data);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * 发送消息给指定客户端
   */
  send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  /**
   * 获取当前连接数
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * 关闭服务
   */
  close() {
    if (this.wss) {
      this.wss.close();
      console.log('[WS] WebSocket服务已关闭');
    }
  }
}

module.exports = WebSocketService;
