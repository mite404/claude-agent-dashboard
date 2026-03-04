const PORT = 3002
const cors = {
  'Access-Control-Allow-Origin': 'http://localhost:5173',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Bun.serve({
  port: PORT,
  fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (req.method === 'POST' && new URL(req.url).pathname === '/spawn') {
      Bun.spawn(['open', '-a', 'Ghostty', '--args', '--command', 'claude'])
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    return new Response('Not found', { status: 404 })
  },
})
console.log(`Spawn server on http://localhost:${PORT}`)
