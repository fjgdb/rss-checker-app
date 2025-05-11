import * as cheerio from "cheerio";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { url } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (RSSCheckerBot)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    const contentType = response.headers.get("content-type") || "";

    // 直接RSSを指定してた場合
    if (
      contentType.includes("application/rss+xml") ||
      contentType.includes("application/atom+xml") ||
      contentType.includes("text/xml") ||
      contentType.includes("application/xml")
    ) {
      return res.status(200).json({ rss: url });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // RSSリンクを探す
    const linkTag = $('link[type="application/rss+xml"], link[type="application/atom+xml"]').first();
    const href = linkTag.attr("href");

    if (href) {
      const fullUrl = href.startsWith("http") ? href : new URL(href, url).href;
      return res.status(200).json({ rss: fullUrl });
    }

    // RSSタグが見つからなかった場合
    return res.status(200).json({ rss: null });

  } catch (error: unknown) {
    if (error instanceof Error) {
      return res.status(500).json({ error: error.message });
    }
    return res.status(500).json({ error: "不明なエラーが発生しました" });
  }
}
