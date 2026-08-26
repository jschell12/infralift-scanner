// Reddit RSS scraper — uses Atom feeds via curl subprocess.
// Node's native fetch gets 429'd by Reddit's TLS fingerprinting,
// so we shell out to curl which has a different TLS signature.

import { execSync } from "node:child_process";

const KEYWORDS = /\b(billing|cost|expensive|pricing|migrate|migration|moved from|switched from|alternative to|self[- ]host|egress|overcharge|surprise bill|hosting|cloud|vercel|heroku|firebase|hetzner|coolify)\b/i;

function parseAtomFeed(xml) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];

    const id = entry.match(/<id>(.*?)<\/id>/)?.[1] ?? "";
    const title = entry.match(/<title>(.*?)<\/title>/)?.[1] ?? "";
    const link = entry.match(/<link href="(.*?)"/)?.[1] ?? "";
    const published = entry.match(/<published>(.*?)<\/published>/)?.[1] ?? "";
    const authorName = entry.match(/<name>(.*?)<\/name>/)?.[1]?.replace("/u/", "") ?? "";

    const contentMatch = entry.match(/<content type="html">([\s\S]*?)<\/content>/);
    let body = "";
    if (contentMatch) {
      body = contentMatch[1]
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#32;/g, " ")
        .replace(/<[^>]+>/g, "").trim().slice(0, 2000);
    }

    const sourceId = id.replace("t3_", "");
    entries.push({ sourceId, title, link, published, authorName, body });
  }

  return entries;
}

export async function scrapeReddit(subreddit, since) {
  const url = `https://www.reddit.com/r/${subreddit}/new.rss?limit=50`;
  try {
    const xml = execSync(
      `curl -s -A "infralift-scanner/1.0" --max-time 15 "${url}"`,
      { encoding: "utf8", timeout: 20000 }
    );

    if (!xml || xml.includes('"error"') || xml.length < 100) {
      console.warn(`Reddit r/${subreddit} RSS: empty or error response`);
      return [];
    }

    const entries = parseAtomFeed(xml);
    const posts = [];

    for (const e of entries) {
      const publishedAt = new Date(e.published);
      if (publishedAt < since) continue;

      const text = `${e.title} ${e.body}`;
      if (!KEYWORDS.test(text)) continue;

      posts.push({
        sourceId: e.sourceId,
        sourceUrl: e.link,
        title: e.title,
        body: e.body,
        authorName: e.authorName || undefined,
        engagementScore: 0,
        postedAt: publishedAt,
      });
    }

    return posts;
  } catch (err) {
    console.warn(`Reddit r/${subreddit} RSS: ${err.message?.slice(0, 80)}`);
    return [];
  }
}
