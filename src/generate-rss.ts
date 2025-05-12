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
): Promise<Response> => {
  const { url, selector } = req.query

  if (typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing URL parameter' })
  }

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return res.status(400).json({ error: '無効なプロトコル' })
    }
  } catch {
    return res.status(400).json({ error: '無効なURL形式' })
  }

  const now = Date.now()
  if (recentRequests.has(url) && now - recentRequests.get(url)! < THROTTLE_WINDOW) {
    return res.status(429).json({ error: 'リクエストが多すぎます。少し待ってください。' })
  }
  recentRequests.set(url, now)

  const cached = cache.get(url)
  if (cached && Date.now() < cached.expires) {
    res.setHeader('Content-Type', 'application/xml')
    return res.status(200).send(cached.xml)
  }

  const debugInfo: Record<string, unknown> = {}
  const triedSelectors = new Set<string>()

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })

    const page = await browser.newPage()
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
      return res.status(200).json({ rssUrl: absoluteRss });
    }

    const hostname = new URL(url).hostname
    const siteSelectors: Record<string, string[]> = {
      'www.huffingtonpost.jp': ['.headline a', '.newsList__title a'],
      'www3.nhk.or.jp': ['.content--summary a'],
      'www.bbc.com': ['.media__title a'],
      'natgeo.nikkeibp.co.jp': ['.article-list a', '.article__title a', '.articleList a', '.article-card a']
    }

    const fallbackSelectors = [
      '.content--summary a',
      'article a',
      'h2 a',
      'h3 a',
      '.entry-title a',
      '.post-title a',
      'a.headline'
    ]

    const selectors = typeof selector === 'string'
      ? [selector]
      : siteSelectors[hostname] || fallbackSelectors

    const itemMap = new Map<string, { title: string, description: string, image?: string }>()

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
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href')
        const title = $(el).text().trim()
        const image = $(el).find('img').attr('src') || $(el).closest('article').find('img').attr('src') || ''

        if (!href || !title || title.length < 10) return

        const absLink = href.startsWith('http') ? href : new URL(href, url).href

        if (
          href.match(/\/(20\d{2}|\d{6})\//) ||
          href.match(/\/(\d{4})\/(\d{2})\/(\d{2})\//) ||
          href.includes('/news/') ||
          href.includes('/article/') ||
          href.includes('/202')
        ) {
          if (!itemMap.has(absLink)) {
            itemMap.set(absLink, { title, description: '', image })
          }
        }
      })
    }

    if (itemMap.size === 0) {
      return res.status(404).json({
        error: '記事が見つかりませんでした',
        triedSelectors: Array.from(triedSelectors),
        debugInfo
      })
    }

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

    res.setHeader('Content-Type', 'application/xml')
    cache.set(url, { xml: rss, expires: Date.now() + CACHE_TTL })
    return res.status(200).send(rss)

  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err))
    const code = (err as { code?: string })?.code || ''
    debugInfo.url = url
    debugInfo.timestamp = new Date().toISOString()
    debugInfo.errorType = code || error.name
    debugInfo.errorMessage = error.message

    return res.status(500).json({
      error: 'RSS生成中にエラーが発生しました',
      details: error.message,
      triedSelectors: Array.from(triedSelectors),
      debug: debugInfo
    })
  }
}

export default handler
