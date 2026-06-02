/**
 * PM2 启动配置
 * 服务器首次：pm2 start ecosystem.config.cjs
 * 日志自动轮转：pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 20M && pm2 set pm2-logrotate:retain 5
 */
module.exports = {
  apps: [
    {
      name: 'haizhu-monitor',
      script: 'server/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
