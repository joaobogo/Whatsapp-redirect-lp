// pm2 process file for one worker computer.
//   pm2 start ecosystem.config.cjs      start (from apps/worker)
//   pm2 logs fgv-worker                 watch the log
//   pm2 save                            remember it across restarts
// Log rotation: pm2 install pm2-logrotate (see the README).
const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'fgv-worker',
      cwd: __dirname,
      // tsx runs the TypeScript source directly; no build step on the worker
      script: path.join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      args: 'src/index.ts',
      interpreter: 'node',
      autorestart: true,
      max_memory_restart: '1G',
      restart_delay: 5000,
      exp_backoff_restart_delay: 2000,
      kill_timeout: 20000,
      time: true,
      merge_logs: true,
      out_file: path.join(__dirname, 'logs', 'worker.out.log'),
      error_file: path.join(__dirname, 'logs', 'worker.err.log'),
      env: { NODE_ENV: 'production' },
    },
  ],
};
