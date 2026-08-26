import pg from "pg";
import { scrapeReddit } from "./scrapers/reddit.js";
import { scrapeRedditBrightData } from "./scrapers/brightdata-reddit.js";
import { scrapeHackerNews } from "./scrapers/hackernews.js";
import { scrapeDevTo } from "./scrapers/devto.js";
import { scrapeStackExchange } from "./scrapers/stackexchange.js";
import { scrapeLobsters } from "./scrapers/lobsters.js";
import { classify } from "./classify.js";

const LOOKBACK_MS = 24 * 60 * 60 * 1000; // 24 hours
const BRIGHTDATA_API_KEY = process.env.BRIGHTDATA_API_KEY ?? "";

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

  // Reddit handled separately via Bright Data
  if (platform === "reddit") return [];

  if (platform === "hackernews") return scrapeHackerNews(since);
  if (platform === "stackexchange") {
    const site = SE_SITE_MAP[slug];
    return site ? scrapeStackExchange(site, since) : [];
  }
  if (slug === "dev-to") return scrapeDevTo(since);
  if (slug === "lobsters") return scrapeLobsters(since);

  return [];
}

async function storeLead(pool, communityId, platform, post, result) {
  await pool.query(
    `INSERT INTO "CommunityLead" (id, "communityId", "sourceUrl", "sourceId", platform, title, body, "authorName", classification, confidence, "engagementScore", "postedAt", "scrapedAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT ("sourceId", platform)
     DO UPDATE SET "engagementScore" = $10, classification = $8, confidence = $9`,
    [
      communityId, post.sourceUrl, post.sourceId, platform,
      post.title, post.body, post.authorName ?? null,
      result.classification, result.confidence,
      post.engagementScore ?? null, post.postedAt ?? null,
    ]
  );
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const since = new Date(Date.now() - LOOKBACK_MS);

  console.log(`Community scanner starting. Looking back to ${since.toISOString()}`);
  console.log(`Bright Data Reddit: ${BRIGHTDATA_API_KEY ? "enabled" : "disabled (no BRIGHTDATA_API_KEY)"}`);

  // Fetch scrapable communities
  const { rows: communities } = await pool.query(
    `SELECT id, slug, name, platform, url FROM "CommunitySource"
     WHERE "isActive" = true AND (platform = ANY($1) OR slug = ANY($2))`,
    [[...SCRAPABLE], [...FORUM_SLUGS]]
  );

  const bySlug = new Map();
  for (const c of communities) bySlug.set(c.slug, c);
  const toScan = [...bySlug.values()];

  // Find a Reddit community ID for Bright Data posts (use the first one)
  const redditCommunity = toScan.find((c) => c.platform === "reddit");
  const nonReddit = toScan.filter((c) => c.platform !== "reddit");

  console.log(`Found ${toScan.length} scrapable communities (${nonReddit.length} non-Reddit)`);

  let totalScraped = 0;
  let totalClassified = 0;
  let totalStored = 0;

  // --- Bright Data Reddit (keyword discovery, handles all subreddits at once) ---
  if (BRIGHTDATA_API_KEY && redditCommunity) {
    console.log("\n=== Bright Data Reddit ===");
    try {
      const { posts, comments } = await scrapeRedditBrightData(BRIGHTDATA_API_KEY, since);
      totalScraped += posts.length;
      console.log(`  ${posts.length} posts discovered, ${comments.length} comments fetched`);

      // Find matching community by subreddit name, or fall back to first reddit community
      for (const post of posts) {
        const matchSlug = `reddit-${(post.subreddit ?? "").toLowerCase()}`;
        const matchCommunity = bySlug.get(matchSlug) ?? redditCommunity;

        totalClassified++;
        const result = classify(post.title, post.body);
        if (result.classification === "irrelevant") continue;

        await storeLead(pool, matchCommunity.id, "reddit", post, result);
        totalStored++;
      }

      // Store comments as leads too (they often contain migration stories)
      for (const comment of comments) {
        if (!comment.commentId) continue;
        totalClassified++;
        const result = classify(comment.postTitle ?? "", comment.body);
        if (result.classification === "irrelevant") continue;

        await storeLead(pool, redditCommunity.id, "reddit-comment", {
          sourceId: comment.commentId,
          sourceUrl: comment.sourceUrl,
          title: `Re: ${(comment.postTitle ?? "").slice(0, 100)}`,
          body: comment.body,
          authorName: comment.authorName,
          engagementScore: comment.upvotes ?? 0,
          postedAt: comment.postedAt,
        }, result);
        totalStored++;
      }
    } catch (err) {
      console.error(`  Bright Data Reddit failed: ${err}`);
    }
  } else if (redditCommunity) {
    // Fallback: RSS scraper for Reddit (when no Bright Data key)
    console.log("\n=== Reddit RSS fallback ===");
    for (const community of toScan.filter((c) => c.platform === "reddit")) {
      try {
        const sub = community.url.replace(/^https?:\/\/reddit\.com\/r\//, "").replace(/\/$/, "");
        const posts = await scrapeReddit(sub, since);
        totalScraped += posts.length;

        if (posts.length === 0) continue;
        console.log(`  ${community.slug}: ${posts.length} posts`);

        for (const post of posts) {
          totalClassified++;
          const result = classify(post.title, post.body);
          if (result.classification === "irrelevant") continue;
          await storeLead(pool, community.id, "reddit", post, result);
          totalStored++;
        }

        await new Promise((r) => setTimeout(r, 10000));
      } catch (err) {
        console.error(`  ${community.slug} failed: ${err}`);
      }
    }
  }

  // --- Other platforms (HN, DEV.to, SE, Lobsters) ---
  console.log("\n=== Other platforms ===");
  for (const community of nonReddit) {
    try {
      const posts = await scrape(community, since);
      totalScraped += posts.length;

      if (posts.length === 0) continue;
      console.log(`  ${community.slug}: ${posts.length} posts`);

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
        await storeLead(pool, community.id, leadPlatform, post, result);
        totalStored++;
      }

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
