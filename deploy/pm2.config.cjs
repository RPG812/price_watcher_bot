module.exports = {
  apps: [
    {
      name: 'price-watcher',
      script: '/home/pwb/price-watcher/src/index.js',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 5000,
      instances: 1,
      env: {
        NODE_ENV: 'production',
        NODE_VERSION: '22'
      },
      out_file: '/home/pwb/.pm2/logs/pw-out.log',
      error_file: '/home/pwb/.pm2/logs/pw-error.log',
      merge_logs: true,
      time: true
    }
  ]
}
