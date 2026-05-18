import { Plane, Wifi, WifiOff, Activity } from 'lucide-react'

export default function Header({ mqttConnected, wsConnected }) {
  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Plane className="text-blue-600" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">机场监测系统</h1>
              <p className="text-sm text-gray-500">基于MQTT的实时设备监控</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">MQTT:</span>
              {mqttConnected ? (
                <span className="flex items-center gap-1 text-green-600">
                  <Wifi size={16} />
                  已连接
                </span>
              ) : (
                <span className="flex items-center gap-1 text-red-600">
                  <WifiOff size={16} />
                  未连接
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">实时:</span>
              {wsConnected ? (
                <span className="flex items-center gap-1 text-green-600">
                  <Activity size={16} />
                  在线
                </span>
              ) : (
                <span className="flex items-center gap-1 text-gray-400">
                  <Activity size={16} />
                  离线
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
