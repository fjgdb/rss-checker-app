// /src/generate-rss.ts
import type { Request, Response } from 'express'
import * as cheerio from 'cheerio'
import puppeteer from 'puppeteer-core'
import escape from 'xml-escape'
import chromium from '@sparticuz/chromium'

const cache = new Map<string, { xml: string, expires: number }>()
const CACHE_TTL = 1000 * 60 * 10 // 10分
const recentRequests = new Map<string, number>()
const THROTTLE_WINDOW = 5000 // 5秒

const handler = async (
  req: Request<unknown, unknown, unknown, { url?: string; selector?: string }>,
  res: Response
): Promise<void> => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const sendProgress = (msg: string) => {
    res.write(`data: ${msg}\n\n`);
    if (typeof (res as any).flush === 'function') {
       (res as any).flush();
    }
  };

  const { url, selector } = req.query

  if (typeof url !== 'string') {
    sendProgress('🧯 URLが見当たらないぞ、隊長！')
    sendProgress('[SSE-END]')
    res.end()
    return
  }

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      sendProgress('🧯 通信プロトコルが謎の呪文です')
      sendProgress('[SSE-END]')
      res.end()
      return
    }
  } catch {
    sendProgress('💥 URLの呪文が不完全です…召喚失敗！')
    sendProgress('[SSE-END]')
    res.end()
    return
  }

  const now = Date.now()
  if (recentRequests.has(url) && now - recentRequests.get(url)! < THROTTLE_WINDOW) {
    sendProgress('🕒 ちょっと待って！ 連打しすぎ注意報！')
    sendProgress('[SSE-END]')
    res.end()
    return
  }
  recentRequests.set(url, now)

  const cached = cache.get(url)
  if (cached && Date.now() < cached.expires) {
    sendProgress('📦 キャッシュから魔法の巻物を召喚！')
    res.write(`data: ${cached.xml}\n\n`)
    ;if (typeof (res as any).flush === 'function') {
      (res as any).flush();
     }

    sendProgress('[SSE-END]')
    res.end()
    return
  }
  const triedSelectors = new Set<string>()
  const debugInfo: Record<string, unknown> = {}

  try {
    sendProgress('🚀 ポータル開放中...')
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })

    const page = await browser.newPage()
    sendProgress('👁️‍🗨️ サイトを覗き見中...')
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36')
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8' })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const html = await page.content()
    await browser.close()

    const $ = cheerio.load(html)

    const rssLink = $('link[type="application/rss+xml"]').attr('href') ||
                    $('link[type="application/atom+xml"]').attr('href')

    if (rssLink) {
      const absoluteRss = rssLink.startsWith('http') ? rssLink : new URL(rssLink, url).href
      sendProgress('📡 既存のRSSフィードを発見！リンクを転送中...')

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

        sendProgress(`✅ フィードURL: ${absoluteRss}`)
        sendProgress('[SSE-END]')
        res.end()
        return

      } catch (fetchErr) {
        sendProgress('⚠️ RSSの呼び出しに失敗…次なる手段へ！')
        debugInfo.fetchRssError = (fetchErr instanceof Error ? fetchErr.message : String(fetchErr))
      }
    }

    sendProgress('🛠️ フィードが無い？よし、手作業で錬成だ！')

    const fallbackSelectors = [
      'article a',
      'h2 a',
      'h3 a',
      '.entry-title a',
      '.post-title a',
      '.headline a',
      '.news-title a',
      '.title a',
      '.card-title a',
      '.story a',
      '.story-link a',
      'a[href*="/article/"]',
      'a[href*="/news/"]',
      'a[href*="/story/"]'
    ]

    const selectors = typeof selector === 'string'
      ? [selector]
      : fallbackSelectors

    const itemMap = new Map<string, { title: string, description: string, image?: string }>()
    sendProgress('🔍 記事を探して草むらをガサゴソ…')

    for (const sel of selectors) {
      triedSelectors.add(sel)
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
      sendProgress('😢 記事が全然見つかりませんでした…')
      sendProgress('[SSE-END]')
      res.end()
      return
    }

    sendProgress(`📦 ${itemMap.size}件の記事を収納中...`)

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

    sendProgress(`✅ RSSを自作しました！リンクはこちら：${generatedUrl}`)
    sendProgress('[SSE-END]')
    res.end()

  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err))
    sendProgress(`💥 処理中に事故発生: ${error.message}`)
    sendProgress('[SSE-END]')
    res.end()
  }
}

export default handler
