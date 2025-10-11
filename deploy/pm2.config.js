export default {
  apps: [
    {
      name: 'price-watcher',                // PM2 process name
      script: './src/index.js',             // entry point
      interpreter: 'node',                  // ensure Node interpreter
      watch: false,                         // no file watching in prod
      autorestart: true,                    // auto restart on crash
      max_restarts: 5,                      // avoid restart loop
      restart_delay: 5000,                  // 5s delay between restarts
      instances: 1,                         // one instance (polling bot)
      env: {
        NODE_ENV: 'production',
        NODE_VERSION: '22',
      },
      out_file: '/home/pwb/.pm2/logs/pw-out.log',
      error_file: '/home/pwb/.pm2/logs/pw-error.log',
      merge_logs: true,                     // combine stdout and stderr
      time: true                            // add timestamps to logs
    }
  ]
}
