import pg from "pg";
import { scrapeReddit } from "./scrapers/reddit.js";
import { scrapeHackerNews } from "./scrapers/hackernews.js";
import { scrapeDevTo } from "./scrapers/devto.js";
import { scrapeStackExchange } from "./scrapers/stackexchange.js";
import { scrapeLobsters } from "./scrapers/lobsters.js";
import { classify } from "./classify.js";

const LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours

const SE_SITE_MAP = {
  "so-cloud": "stackoverflow",
  serverfault: "serverfault",
  "devops-se": "devops",
  "softwareeng-se": "softwareengineering",
};

const SCRAPABLE = new Set(["reddit", "hackernews", "stackexchange", "forum"]);
const FORUM_SLUGS = new Set(["dev-to", "lobsters"]);

async function scrape(community, since) {
  const { platform, url, slug } = community;

  if (platform === "reddit") {
    const sub = url.replace(/^https?:\/\/reddit\.com\/r\//, "").replace(/\/$/, "");
    return scrapeReddit(sub, since);
  }
  if (platform === "hackernews") {
    return scrapeHackerNews(since);
  }
  if (platform === "stackexchange") {
    const site = SE_SITE_MAP[slug];
    return site ? scrapeStackExchange(site, since) : [];
  }
  if (slug === "dev-to") return scrapeDevTo(since);
  if (slug === "lobsters") return scrapeLobsters(since);

  return [];
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const since = new Date(Date.now() - LOOKBACK_MS);

  console.log(`Community scanner starting. Looking back to ${since.toISOString()}`);

  // Fetch scrapable communities
  const { rows: communities } = await pool.query(
    `SELECT id, slug, name, platform, url FROM "CommunitySource"
     WHERE "isActive" = true AND (platform = ANY($1) OR slug = ANY($2))`,
    [[...SCRAPABLE], [...FORUM_SLUGS]]
  );

  // Deduplicate by slug
  const bySlug = new Map();
  for (const c of communities) bySlug.set(c.slug, c);
  const toScan = [...bySlug.values()];

  console.log(`Found ${toScan.length} scrapable communities`);

  let totalScraped = 0;
  let totalClassified = 0;
  let totalStored = 0;

  for (const community of toScan) {
    try {
      const posts = await scrape(community, since);
      totalScraped += posts.length;

      if (posts.length === 0) continue;
      console.log(`  ${community.slug}: ${posts.length} posts`);

      // Filter already-indexed posts
      const leadPlatform = community.platform === "forum" ? community.slug : community.platform;
      const sourceIds = posts.map((p) => p.sourceId);
      const { rows: existing } = await pool.query(
        `SELECT "sourceId" FROM "CommunityLead" WHERE platform = $1 AND "sourceId" = ANY($2)`,
        [leadPlatform, sourceIds]
      );
      const existingIds = new Set(existing.map((e) => e.sourceId));
      const newPosts = posts.filter((p) => !existingIds.has(p.sourceId));

      if (newPosts.length === 0) {
        console.log(`    (all already indexed)`);
        continue;
      }

      for (const post of newPosts) {
        totalClassified++;
        const result = classify(post.title, post.body);

        if (result.classification === "irrelevant") continue;

        await pool.query(
          `INSERT INTO "CommunityLead" (id, "communityId", "sourceUrl", "sourceId", platform, title, body, "authorName", classification, confidence, "engagementScore", "postedAt", "scrapedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
           ON CONFLICT ("sourceId", platform)
           DO UPDATE SET "engagementScore" = $10, classification = $8, confidence = $9`,
          [
            community.id,
            post.sourceUrl,
            post.sourceId,
            leadPlatform,
            post.title,
            post.body,
            post.authorName ?? null,
            result.classification,
            result.confidence,
            post.engagementScore ?? null,
            post.postedAt ?? null,
          ]
        );
        totalStored++;
      }

      // Rate limit between communities
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`  ${community.slug} failed: ${err}`);
    }
  }

  console.log(`\nDone. Scraped ${totalScraped} posts, classified ${totalClassified}, stored ${totalStored} leads.`);

  await pool.end();
}

main().catch(async (err) => {
  console.error("Scanner failed:", err);
  process.exit(1);
});
