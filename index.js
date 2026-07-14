const express = require('express')
const https   = require('https')
const http    = require('http')
const app     = express()

app.use(express.text({ type: '*/*', limit: '10mb' }))

const PROXY_SECRET = process.env.PROXY_SECRET

// Faz requisição HTTP/HTTPS ignorando validação de certificado ICP-Brasil
function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const lib = parsedUrl.protocol === 'https:' ? https : http

    const reqOptions = {
      hostname:           parsedUrl.hostname,
      port:               parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path:               parsedUrl.pathname + parsedUrl.search,
      method:             options.method ?? 'POST',
      headers:            options.headers ?? {},
      rejectUnauthorized: false, // ← aceita ICP-Brasil
    }

    const req = lib.request(reqOptions, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })

    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

app.post('/proxy-sefaz', async (req, res) => {
  if (req.headers['x-proxy-secret'] !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const targetUrl = req.headers['x-target-url']
  if (!targetUrl) {
    return res.status(400).json({ error: 'x-target-url obrigatório' })
  }

  console.log('[proxy-sefaz] →', targetUrl)

  try {
    const result = await httpsRequest(
      targetUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': req.headers['content-type'] ?? 'application/soap+xml',
          'SOAPAction':   req.headers['soapaction'] ?? '',
          'Content-Length': Buffer.byteLength(req.body),
        },
      },
      req.body
    )

    console.log('[proxy-sefaz] status:', result.status)
    console.log('[proxy-sefaz] cStat:', result.body.match(/<cStat>(\d+)<\/cStat>/)?.[1])
    res.status(result.status).type('xml').send(result.body)
  } catch (e) {
    console.error('[proxy-sefaz] erro:', e.message)
    res.status(502).json({ error: e.message })
  }
})

// Diagnóstico
app.get('/test-sefaz', async (req, res) => {
  const results = {}

  try {
    const dns = await import('dns/promises')
    const addr = await dns.lookup('nfce.svrs.rs.gov.br')
    results.dns = { ok: true, address: addr.address }
  } catch (e) {
    results.dns = { ok: false, error: e.message }
  }

  try {
    const result = await httpsRequest(
      'https://nfce.svrs.rs.gov.br/ws/NfceAutorizacao/NfceAutorizacao4.asmx',
      { method: 'GET', headers: {} },
      null
    )
    results.https = { ok: true, status: result.status }
  } catch (e) {
    results.https = { ok: false, error: e.message }
  }

  try {
    const result = await httpsRequest('https://www.google.com', { method: 'GET', headers: {} }, null)
    results.google = { ok: true, status: result.status }
  } catch (e) {
    results.google = { ok: false, error: e.message }
  }

  console.log('[test-sefaz]', JSON.stringify(results))
  res.json(results)
})

app.get('/', (req, res) => res.json({ ok: true, service: 'sefaz-proxy' }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Proxy rodando na porta ${PORT}`))