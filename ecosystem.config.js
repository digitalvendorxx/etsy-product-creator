module.exports = {
  apps: [{
    name: 'etsy-creator',
    script: 'server.js',
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    // Auto-restart on crash
    autorestart: true,
    restart_delay: 3000,
    max_restarts: 10,
    // Logging
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
