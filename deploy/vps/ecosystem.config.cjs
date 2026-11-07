module.exports = {
  apps: [{
    name: 'laro-calc', cwd: '/srv/laro-calc/current', script: 'dist/vps/server.mjs',
    // The search allocates fast and V8 keeps the garbage until the heap is large (430-480 MB RSS for a 61 MB live set), so the heap is capped
    // well under the restart limit. Measured with tools/mcp-load-probe.mjs: peak RSS 308 MB with 3 concurrent searches, same results and time.
    node_args: '--max-old-space-size=256',
    instances: 1, exec_mode: 'fork', max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production', PORT: '8787', HOST: '127.0.0.1',
      PUBLIC_APP_ORIGIN: 'https://laro-calc.siatiquosque.com.br',
      ALLOWED_HOSTS: 'laro-calc.siatiquosque.com.br',
      ALLOWED_ORIGINS: 'https://claude.ai,https://chatgpt.com,https://chat.openai.com,https://laro-calc.siatiquosque.com.br',
      SHORTENER_URL: 'https://laro-calc.siatiquosque.com.br/l',
      LINKS_DB: '/srv/laro-calc/data/links.sqlite',
      OG_ORIGIN: '',
    },
  }],
};
