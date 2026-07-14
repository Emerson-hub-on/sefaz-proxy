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
    console.error('[proxy-sefaz] erro:', e.message)
    res.status(502).json({ error: e.message })
  }
})

// Rota de health check
app.get('/', (req, res) => res.json({ ok: true, service: 'sefaz-proxy' }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Proxy rodando na porta ${PORT}`))