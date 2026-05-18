# 服务器部署指南（腾讯云轻量 Ubuntu）

## 1. 服务器环境准备

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 安装 PM2（进程守护，24h 不间断运行）
sudo npm install -g pm2

# 验证
node -v && npm -v && pm2 -v
```

## 2. 上传项目到服务器

**方法一：Git（推荐）**
```bash
git clone <你的仓库地址> /home/ubuntu/haizhu-monitor
cd /home/ubuntu/haizhu-monitor
```

**方法二：scp 直接上传**
```bash
# 本地执行（先排除 node_modules 和 dist）
scp -r . ubuntu@111.230.29.134:/home/ubuntu/haizhu-monitor
```

## 3. 配置 .env

```bash
cd /home/ubuntu/haizhu-monitor
cp .env.example .env
nano .env
```

**生产环境必须添加以下配置：**
```env
NODE_ENV=production
PORT=3001

# 登录账号（务必修改默认密码）
AUTH_USER=admin
AUTH_PASS=你的强密码

# MQTT 配置（同原来）
MQTT_BROKER_URL=tcp://183.6.33.81:1883
MQTT_USERNAME=...
MQTT_PASSWORD=...
MQTT_CLIENT_ID=haizhu_monitor
```

## 4. 安装依赖 & 构建前端

```bash
# 安装后端依赖
cd /home/ubuntu/haizhu-monitor
npm install

# 安装前端依赖并构建
cd client
npm install
npm run build
cd ..
```

## 5. 用 PM2 启动（24h 守护）

```bash
# 启动
pm2 start server/index.js --name haizhu-monitor

# 设置开机自启
pm2 save
pm2 startup
# 按提示执行输出的 sudo 命令

# 常用命令
pm2 status              # 查看状态
pm2 logs haizhu-monitor # 查看日志
pm2 restart haizhu-monitor  # 重启
pm2 stop haizhu-monitor     # 停止
```

## 6. 开放防火墙端口

腾讯云控制台 → 防火墙 → 添加规则：
- **TCP 3001**（HTTP 服务）

如果要用 80/443 端口，加 Nginx 反代（见下方）。

## 7. （可选）Nginx 反代 + 80 端口

```bash
sudo apt install -y nginx

sudo nano /etc/nginx/sites-available/haizhu
```

填入：
```nginx
server {
    listen 80;
    server_name 111.230.29.134;  # 或者你的域名

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/haizhu /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx
```

## 8. 访问

浏览器打开 `http://111.230.29.134:3001`（或配置了 Nginx 后访问 `http://111.230.29.134`）

默认账号：`admin` / `.env 里配置的 AUTH_PASS`

## 9. 后续代码更新

```bash
cd /home/ubuntu/haizhu-monitor

# 拉取新代码
git pull

# 重新构建前端（如有前端改动）
cd client && npm run build && cd ..

# 重启服务
pm2 restart haizhu-monitor
```
