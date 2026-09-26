/**
 * PM2 Process Manager Configuration für PHEV-Tracker
 * Für dauerhaften Betrieb auf dem Windows-Homeserver (HP EliteDesk Mini).
 *
 * Befehle:
 *   Starten:      pm2 start ecosystem.config.cjs
 *   Status:       pm2 status
 *   Logs live:    pm2 logs phev-tracker
 *   Stoppen:      pm2 stop phev-tracker
 *   Neu starten:  pm2 restart phev-tracker
 *   Autostart:    pm2 save
 */

module.exports = {
  apps: [
    {
      name: 'phev-tracker',
      script: 'backend/dist/server.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      max_restarts: 10,
      min_uptime: '10s',

      // Logs
      output: './logs/app-out.log',
      error: './logs/app-error.log',
      merge_logs: true,
      time: true,

      // Umgebungsvariablen
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
      },
    },
  ],
};
