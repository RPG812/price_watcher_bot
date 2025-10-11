module.exports = {
  apps: [
    {
      name: 'price-watcher',
      script: '/home/pwb/price-watcher/src/index.mjs',
      interpreter: 'node',
      exec_mode: 'fork',
      watch: false,
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
      time: true,
      // graceful shutdown support
      kill_timeout: 10000,
      exp_backoff_restart_delay: 2000
    }
  ]
}
