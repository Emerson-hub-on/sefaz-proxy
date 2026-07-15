const express = require('express')
const https   = require('https')
const http    = require('http')
const app     = express()

app.use(express.text({ type: '*/*', limit: '10mb' }))

const PROXY_SECRET = process.env.PROXY_SECRET

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
      rejectUnauthorized: false,
      pfx:                options.pfx,
      passphrase:         options.passphrase,
    }

    const req = lib.request(reqOptions, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({
        status:  res.statusCode,
        headers: res.headers, // ← adicione
        body:    data,
      }))
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
  const pfxBase64 = req.headers['x-pfx-base64']
  const pfxSenha  = req.headers['x-pfx-senha']

  console.log('[proxy] targetUrl:', targetUrl)
  console.log('[proxy] pfxBase64 length:', pfxBase64?.length ?? 0)
  console.log('[proxy] pfxSenha length:', pfxSenha?.length ?? 0)
  console.log('[proxy] body length:', req.body?.length ?? 0)
  // ── LOG TEMPORÁRIO ──
  console.log('[proxy] Content-Type enviado:', req.headers['content-type'])
  console.log('[proxy] SOAPAction enviado:', req.headers['soapaction'])
  console.log('[proxy] body (primeiros 1000 chars):\n', req.body?.substring(0, 1000))
  // ───────────────────

  if (!targetUrl) {
    return res.status(400).json({ error: 'x-target-url obrigatório' })
  }

  try {
    const pfxBuffer = pfxBase64 ? Buffer.from(pfxBase64, 'base64') : undefined
    console.log('[proxy] pfxBuffer size:', pfxBuffer?.length ?? 0)
    console.log('[proxy] pfxBuffer magic byte:', pfxBuffer ? pfxBuffer[0].toString(16) : 'N/A')

    const bodyBuffer = Buffer.from(req.body, 'utf-8')  // garante encoding correto

    const result = await httpsRequest(
    targetUrl,
    {
        method: 'POST',
        headers: {
        'Content-Type': req.headers['content-type'] ?? 'text/xml; charset=utf-8',
        'SOAPAction':   req.headers['soapaction'] ?? '',
        'Content-Length': bodyBuffer.length,  // ← usa o buffer, não req.body.length
        },
        pfx:        pfxBuffer,
        passphrase: pfxSenha,
    },
    bodyBuffer  // ← passa o buffer, não a string
    )

    console.log('[proxy] SEFAZ status:', result.status)
    console.log('[proxy] SEFAZ headers:', JSON.stringify(result.headers)) // ← adicione
    console.log('[proxy] SEFAZ body completo:\n', result.body.substring(0, 2000))
    res.status(result.status).type('xml').send(result.body)
  } catch (e) {
    console.error('[proxy] erro:', e.message)
    res.status(502).json({ error: e.message })
  }
})

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

  console.log('[test-sefaz]', JSON.stringify(results))
  res.json(results)
})

app.get('/', (req, res) => res.json({ ok: true, service: 'sefaz-proxy' }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Proxy rodando na porta ${PORT}`))

app.get('/test-urls', async (req, res) => {
  const urls = [
    'https://nfce-homologacao.svrs.rs.gov.br/ws/NfceAutorizacao/NfceAutorizacao4.asmx',
    'https://nfce.svrs.rs.gov.br/ws/NfceAutorizacao/NfceAutorizacao4.asmx',
  ]

  const results = {}
  for (const url of urls) {
    try {
      const r = await httpsRequest(url, { method: 'GET', headers: {} }, null)
      results[url] = { status: r.status, body: r.body.substring(0, 100) }
    } catch (e) {
      results[url] = { error: e.message }
    }
  }

  res.json(results)
})