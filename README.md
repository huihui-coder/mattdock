# 基于MQTT的机场监测工具

一个基于Node.js + React的实时设备监测系统，通过MQTT协议订阅设备数据，自动分析设备状态并生成告警。

## 功能特性

- **MQTT连接管理**: 自动连接、断线重连、多主题订阅
- **数据处理**: JSON解析、阈值判断、状态评估
- **实时推送**: WebSocket实时推送设备数据和告警
- **Web界面**: 设备列表、状态概览、告警通知、详情查看

## 项目结构

```
├── server/                 # 后端服务
│   ├── index.js           # 入口文件
│   ├── mqtt-service.js    # MQTT连接服务
│   ├── device-processor.js # 数据处理模块
│   └── ws-service.js      # WebSocket服务
├── client/                 # 前端应用
│   ├── src/
│   │   ├── App.jsx        # 主应用
│   │   └── components/    # UI组件
│   └── package.json
├── .env                    # 配置文件
└── package.json
```

## 快速开始

### 1. 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd client && npm install
```

### 2. 配置MQTT

编辑 `.env` 文件：

```env
MQTT_BROKER_URL=mqtt://your-broker:1883
MQTT_USERNAME=your-username
MQTT_PASSWORD=your-password
MQTT_TOPICS=airport/devices/#,airport/sensors/#
```

### 3. 启动服务

```bash
# 开发模式（同时启动前后端）
npm run dev

# 或分别启动
npm run server    # 后端: http://localhost:3001
npm run client    # 前端: http://localhost:3000
```

## 数据格式

### 预期JSON格式

设备发送的MQTT消息应为JSON格式，支持以下字段：

```json
{
  "deviceId": "device-001",
  "temperature": 25.5,
  "humidity": 60,
  "battery": 85,
  "signal": -45,
  "status": "online"
}
```

### 状态判断规则

| 指标 | 正常范围 | 警告范围 | 严重范围 |
|------|----------|----------|----------|
| 温度 | 15-35°C | 10-40°C | <10 或 >40°C |
| 湿度 | 30-70% | 20-80% | <20 或 >80% |
| 电量 | 50-100% | 20-50% | <20% |
| 信号 | -50~0dBm | -70~-50dBm | <-70dBm |

## API接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/status | 获取连接状态 |
| GET | /api/devices | 获取所有设备 |
| GET | /api/devices/:id | 获取单个设备 |
| GET | /api/thresholds | 获取阈值配置 |
| POST | /api/thresholds | 更新阈值配置 |
| POST | /api/mqtt/reconnect | 重连MQTT |

## WebSocket事件

| 类型 | 说明 |
|------|------|
| connection | MQTT连接状态变化 |
| device_data | 设备数据更新 |
| alert | 新告警 |

## 扩展开发

### 自定义数据处理

修改 `server/device-processor.js` 中的 `process()` 方法来添加自定义逻辑。

### 添加新指标

在 `thresholds` 配置中添加新指标，并在 `process()` 方法中处理。

## 技术栈

- **后端**: Node.js, Express, mqtt.js, ws
- **前端**: React, Vite, TailwindCSS, Lucide Icons
- **通信**: MQTT, WebSocket
