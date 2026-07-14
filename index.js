const express = require('express')
const app = express()

app.use(express.text({ type: '*/*', limit: '10mb' }))

const PROXY_SECRET = process.env.PROXY_SECRET

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
    const sefazResp = await fetch(targetUrl, {
      method:  'POST',
      headers: {
        'Content-Type': req.headers['content-type'] ?? 'application/soap+xml',
        'SOAPAction':   req.headers['soapaction'] ?? '',
      },
      body: req.body,
    })

    const text = await sefazResp.text()
    console.log('[proxy-sefaz] cStat:', text.match(/<cStat>(\d+)<\/cStat>/)?.[1])
    res.status(sefazResp.status).type('xml').send(text)
  } catch (e) {
    console.error('[proxy-sefaz] erro:', e.message, e.cause?.message)
    res.status(502).json({ error: e.message, cause: e.cause?.message })
  }
})

// Rota de diagnóstico de rede
app.get('/test-sefaz', async (req, res) => {
  const results = {}

  // Teste 1: DNS resolve?
  try {
    const dns = await import('dns/promises')
    const addresses = await dns.lookup('nfce.svrs.rs.gov.br')
    results.dns = { ok: true, address: addresses.address }
  } catch (e) {
    results.dns = { ok: false, error: e.message }
  }

  // Teste 2: HTTPS conecta?
  try {
    const resp = await fetch('https://nfce.svrs.rs.gov.br/ws/NfceAutorizacao/NfceAutorizacao4.asmx', {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    })
    results.https = { ok: true, status: resp.status }
  } catch (e) {
    results.https = { ok: false, error: e.message, cause: e.cause?.message }
  }

  // Teste 3: Google acessível? (confirma que rede funciona)
  try {
    const resp = await fetch('https://www.google.com', {
      signal: AbortSignal.timeout(5000),
    })
    results.google = { ok: true, status: resp.status }
  } catch (e) {
    results.google = { ok: false, error: e.message }
  }

  console.log('[test-sefaz]', JSON.stringify(results))
  res.json(results)
})

// Health check
app.get('/', (req, res) => res.json({ ok: true, service: 'sefaz-proxy' }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Proxy rodando na porta ${PORT}`))