module.exports = {
  apps: [{
    name: 'tfcapi',
    cwd: '/root/tfcbot-api',
    script: 'api.js',
    env: {
      PORT: 4000,
      ELO_DB: '/root/tfcbot/elo.db'
    }
  }]
}
