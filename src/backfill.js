// One-time backfill from Jan 1 2026 to now.
// Focuses on HN Algolia (best historical search) with broader queries and pagination.

import pg from "pg";
import { classify } from "./classify.js";

const START = new Date("2026-01-01T00:00:00Z");
const NOW = new Date();

// Broader HN search queries for better coverage
const HN_QUERIES = [
  "vercel",
  "heroku",
  "firebase",
  "cloud bill",
  "cloud cost",
  "hosting expensive",
  "self-hosting",
  "migrated from",
  "moved to cloudflare",
  "moved to hetzner",
  "alternative to vercel",
  "alternative to heroku",
  "alternative to aws",
  "egress fees",
  "surprise bill cloud",
  "cloud migration",
  "left vercel",
  "left heroku",
  "left aws",
  "coolify",
  "infrastructure cost",
  "hosting cost",
  "Netlify pricing",
  "Railway pricing",
  "Render pricing",
  "Fly.io pricing",
  "DigitalOcean pricing",
];

// DEV.to search queries
const DEVTO_QUERIES = [
  "cloud migration",
  "self hosting",
  "vercel alternative",
  "heroku alternative",
  "hosting cost",
  "cloud cost",
  "infrastructure migration",
  "moved from vercel",
  "moved from heroku",
  "coolify",
  "hetzner",
];

async function getCommunityId(pool, slug) {
  const { rows } = await pool.query(
    `SELECT id FROM "CommunitySource" WHERE slug = $1`, [slug]
  );
  return rows[0]?.id ?? null;
}

async function storeLead(pool, communityId, platform, post, result) {
  try {
    await pool.query(
      `INSERT INTO "CommunityLead" (id, "communityId", "sourceUrl", "sourceId", platform, title, body, "authorName", classification, confidence, "engagementScore", "postedAt", "scrapedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT ("sourceId", platform) DO NOTHING`,
      [
        communityId, post.sourceUrl, post.sourceId, platform,
        post.title, post.body, post.authorName ?? null,
        result.classification, result.confidence,
        post.engagementScore ?? null, post.postedAt ?? null,
      ]
    );
    return true;
  } catch {
    return false;
  }
}

async function searchHN(query, since, page = 0) {
  const sinceUnix = Math.floor(since.getTime() / 1000);
  const untilUnix = Math.floor(NOW.getTime() / 1000);
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${sinceUnix},created_at_i<${untilUnix}&hitsPerPage=50&page=${page}`;
  const res = await fetch(url);
  if (!res.ok) return { hits: [], nbPages: 0 };
  return await res.json();
}

async function searchDevTo(query, page = 1) {
  const url = `https://dev.to/api/articles?per_page=30&page=${page}&state=all`;
  // DEV.to doesn't have a great search API for historical, use tag-based
  const res = await fetch(url, {
    headers: { "User-Agent": "infralift-scanner/1.0" },
  });
  if (!res.ok) return [];
  return await res.json();
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let totalStored = 0;
  let totalScraped = 0;
  const seen = new Set();

  console.log(`Backfill: ${START.toISOString()} to ${NOW.toISOString()}`);

  // --- Hacker News (Algolia search with pagination) ---
  const hnId = await getCommunityId(pool, "hn-front-page");
  if (hnId) {
    console.log("\n=== Hacker News (Algolia) ===");
    for (const query of HN_QUERIES) {
      let page = 0;
      let maxPages = 1;
      let queryHits = 0;

      while (page < maxPages && page < 5) { // cap at 5 pages per query
        try {
          const data = await searchHN(query, START, page);
          maxPages = Math.min(data.nbPages ?? 0, 5);

          for (const hit of data.hits ?? []) {
            if (seen.has(hit.objectID)) continue;
            seen.add(hit.objectID);
            totalScraped++;
            queryHits++;

            const post = {
              sourceId: hit.objectID,
              sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
              title: hit.title ?? "",
              body: hit.story_text ?? hit.url ?? "",
              authorName: hit.author ?? undefined,
              engagementScore: hit.points ?? 0,
              postedAt: hit.created_at ? new Date(hit.created_at) : undefined,
            };

            const result = classify(post.title, post.body);
            if (result.classification === "irrelevant") continue;

            if (await storeLead(pool, hnId, "hackernews", post, result)) {
              totalStored++;
            }
          }
        } catch (err) {
          console.warn(`    HN "${query}" page ${page} failed: ${err.message}`);
        }
        page++;
        await new Promise(r => setTimeout(r, 200)); // Algolia is generous
      }
      if (queryHits > 0) console.log(`  "${query}": ${queryHits} posts`);
    }
    console.log(`  HN total: ${totalScraped} scraped, ${totalStored} stored`);
  }

  // --- DEV.to (search via articles endpoint, broader) ---
  const devtoId = await getCommunityId(pool, "dev-to");
  if (devtoId) {
    console.log("\n=== DEV.to ===");
    const devtoKeywords = /\b(billing|cost|expensive|migrate|migration|moved from|switched|alternative|self[- ]host|egress|vercel|heroku|firebase|cloud.{0,10}(cost|bill|pricing)|hetzner|coolify)\b/i;

    // Paginate through recent articles with relevant tags
    const tags = ["cloud", "devops", "hosting", "terraform", "selfhosting", "webdev", "infrastructure"];
    for (const tag of tags) {
      for (let page = 1; page <= 10; page++) {
        try {
          const url = `https://dev.to/api/articles?tag=${tag}&per_page=30&page=${page}&state=all`;
          const res = await fetch(url, { headers: { "User-Agent": "infralift-scanner/1.0" } });
          if (!res.ok) break;
          const articles = await res.json();
          if (articles.length === 0) break;

          let pageHits = 0;
          for (const a of articles) {
            const published = new Date(a.published_at ?? a.created_at);
            if (published < START) { page = 999; break; } // stop going back

            const id = String(a.id);
            if (seen.has(id)) continue;
            seen.add(id);
            totalScraped++;

            const text = `${a.title ?? ""} ${a.description ?? ""}`;
            if (!devtoKeywords.test(text)) continue;

            const post = {
              sourceId: id,
              sourceUrl: a.url ?? `https://dev.to/${a.path}`,
              title: a.title ?? "",
              body: (a.description ?? "").slice(0, 2000),
              authorName: a.user?.username ?? undefined,
              engagementScore: (a.public_reactions_count ?? 0) + (a.comments_count ?? 0),
              postedAt: published,
            };

            const result = classify(post.title, post.body);
            if (result.classification === "irrelevant") continue;

            if (await storeLead(pool, devtoId, "dev-to", post, result)) {
              totalStored++;
              pageHits++;
            }
          }
        } catch (err) {
          console.warn(`    DEV.to tag "${tag}" page ${page}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 2000)); // 30 req/min
      }
    }
    console.log(`  DEV.to total stored: ${totalStored}`);
  }

  console.log(`\n=== Backfill complete ===`);
  console.log(`Total scraped: ${totalScraped}`);
  console.log(`Total stored as leads: ${totalStored}`);

  await pool.end();
}

main().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
