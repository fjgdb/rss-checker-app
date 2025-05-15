// /src/generate-rss.ts
import type { Request, Response } from 'express'
import * as cheerio from 'cheerio'
import axios from 'axios'
import puppeteerExtra from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import escape from 'xml-escape'
import chromium from '@sparticuz/chromium'
import type { Browser } from 'puppeteer-core'

puppeteerExtra.use(StealthPlugin())

let browser: Browser | null = null
async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await puppeteerExtra.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })
  }

  const b = browser
  if (!b) throw new Error('Browser launch failed')
  return b
}

const cache = new Map<string, { xml: string, expires: number }>()
const CACHE_TTL = 1000 * 60 * 10
const recentRequests = new Map<string, number>()
const THROTTLE_WINDOW = 5000

const handler = async (
  req: Request<unknown, unknown, unknown, { url?: string; selector?: string }>,
  res: Response
): Promise<void> => {
  const isSSE = req.headers.accept?.includes('text/event-stream')
  if (isSSE) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
  }

  const sendProgress = (msg: string) => {
    if (isSSE) {
      res.write(`data: ${msg}\n\n`)
      if (typeof (res as any).flush === 'function') {
        ;(res as any).flush()
      }
    } else {
      console.log('Progress:', msg)
    }
  }

  const { url, selector } = req.query
  if (typeof url !== 'string') {
    res.status(500).json({
      status: "error",
      message: "🧭 探検開始できず！URLが見当たらない！",
    })
    sendProgress('[SSE-END]')
    return
  }

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      res.status(500).json({
        status: "error",
        message: "🧭 未知の道だ！URLの形式が怪しい！",
      })
      sendProgress('[SSE-END]')
      return
    }
  } catch {
    res.status(500).json({
      status: "error",
      message: "💥 URLが壊れている…地図としては使えない！",
    })
    sendProgress('[SSE-END]')
    return
  }

  const now = Date.now()
  if (recentRequests.has(url) && now - recentRequests.get(url)! < THROTTLE_WINDOW) {
    sendProgress('⏳ 探検隊の再編成中…少し待ってくれ！')
    sendProgress('[SSE-END]')
    res.end()
    return
  }
  recentRequests.set(url, now)

  const cached = cache.get(url)
  if (cached && Date.now() < cached.expires) {
    sendProgress('📦 古の巻物（キャッシュ）を発見！')
    res.write(`data: ${cached.xml}\n\n`)
    if (typeof (res as any).flush === 'function') {
      ;(res as any).flush()
    }
    sendProgress('[SSE-END]')
    res.end()
    return
  }

  let html = ''
  try {
    const browser = await getBrowser()
    const page = await browser.newPage()
    sendProgress('🔍 対象エリアをスキャン中…')
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36')
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
      'Referer': url,
      'DNT': '1'
    })
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 })
      html = await page.content()
    } catch (err) {
      sendProgress(`🧨 メインルートでの進行に失敗！裏道を試行中…`)
      try {
        const response = await axios.get(url)
        html = response.data
      } catch (fallbackErr) {
        res.status(500).json({
          status: "error",
          message: `💥 調査失敗: ${fallbackErr}`,
        })
        sendProgress('[SSE-END]')
        return
      }
    }
  } catch (totalErr) {
    res.status(500).json({
      status: "error",
      message: `🌀 探検用装置が召喚に失敗した…撤退せざるを得ない！`
    })
    sendProgress('[SSE-END]')
    return
  }

  const $ = cheerio.load(html)

  const rssLink = $('link[type="application/rss+xml"]').attr('href') ||
                  $('link[type="application/atom+xml"]').attr('href')

  if (rssLink) {
    const absoluteRss = rssLink.startsWith('http') ? rssLink : new URL(rssLink, url).href
    sendProgress('📡 石板（RSS）を発見！')

    try {
      const rssResponse = await fetch(absoluteRss, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/rss+xml,application/xml',
        },
        redirect: 'follow',
      })

      if (!rssResponse.ok) throw new Error(`RSS fetch failed with status ${rssResponse.status}`)

      const rssText = await rssResponse.text()
      cache.set(url, { xml: rssText, expires: Date.now() + CACHE_TTL })

      if (isSSE) {
        const payload = JSON.stringify({
          status: "success",
          rssUrl: absoluteRss,
        })
        res.write(`data: ${payload}\n\n`)
        sendProgress('[SSE-END]')
        res.end()
      } else {
        res.json({
          status: "success",
          rssUrl: absoluteRss,
        })
      }
      return
    } catch (err) {
      sendProgress('⚠️ 石板（RSS）の取得に失敗…代替手段だ！')
    }
  }

  const fallbackSelectors = [
    'article a', 'h2 a', 'h3 a',
    '.entry-title a', '.post-title a', '.headline a',
    '.news-title a', '.title a', '.card-title a',
    '.story a', '.story-link a',
    'a[href*="/article/"]', 'a[href*="/news/"]', 'a[href*="/story/"]'
  ]
  const selectors = typeof selector === 'string' ? [selector] : fallbackSelectors
  const itemMap = new Map<string, { title: string, description: string, image?: string }>()
  sendProgress('🧹 記事の痕跡を調査中…')

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const href = $(el).attr('href')
      const title = $(el).text().trim() || $(el).attr('aria-label') || $(el).attr('title') || ''
      const description = $(el).closest('article').find('p').text().trim() ||
                          $(el).closest('div').find('p').first().text().trim() ||
                          $('meta[name="description"]').attr('content') ||
                          $('meta[property="og:description"]').attr('content') || ''
      const image = $(el).closest('article').find('img').attr('src') ||
                    $(el).find('img').attr('src') ||
                    $('meta[property="og:image"]').attr('content') || ''

      if (href && title && (href.startsWith('/') || href.startsWith('http'))) {
        const absoluteLink = href.startsWith('http') ? href : new URL(href, url).href
        if (!itemMap.has(absoluteLink)) {
          itemMap.set(absoluteLink, { title, description, image })
        }
      }
    })
    if (itemMap.size > 0) break
  }

  if (itemMap.size === 0) {
    sendProgress('❌ 遺跡は空っぽだった…別の手がかりを探そう！…')
    sendProgress('[SSE-END]')
    return
  }

  sendProgress(`📦 ${itemMap.size}件の情報を回収！手帳に記録中…`)
  const rssItems = Array.from(itemMap.entries()).slice(0, 10).map(([link, data]) => `
    <item>
      <title><![CDATA[${escape(data.title)}]]></title>
      <link>${escape(link)}</link>
      <guid>${escape(link)}</guid>
      <description><![CDATA[${escape(data.description || '')}]]></description>
      ${data.image ? `<enclosure url="${escape(new URL(data.image, url).href)}" type="image/jpeg" />` : ''}
    </item>
  `).join('\n')

  const rss = `<?xml version="1.0" encoding="UTF-8" ?>
    <rss version="2.0">
      <channel>
        <title>Generated RSS for ${escape(url)}</title>
        <link>${escape(url)}</link>
        <description>Auto-generated feed</description>
        ${rssItems}
      </channel>
    </rss>`

  const apiUrl = req.originalUrl.split('?')[0]
  const generatedUrl = `${req.protocol}://${req.get('host')}${apiUrl}?url=${encodeURIComponent(url)}`
  cache.set(url, { xml: rss, expires: Date.now() + CACHE_TTL })

  if (isSSE) {
    const payload = JSON.stringify({
      status: "success",
      rssUrl: generatedUrl,
    })
    res.write(`data: ${payload}\n\n`)
    sendProgress('[SSE-END]')
    res.end()
  } else {
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8')
    res.send(rss)
  }
}
export default handler
