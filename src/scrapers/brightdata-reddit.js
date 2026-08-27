// Bright Data Reddit Scraper API — keyword discovery for posts + comment collection.
// Uses async /trigger or sync /scrape with 202 snapshot polling fallback.
//
// Pricing: ~$1.50 per 1,000 records. Free tier: 5,000 records/month.

const API_BASE = "https://api.brightdata.com/datasets/v3";
const POSTS_DATASET = "gd_lvz8ah06191smkebj4";
const COMMENTS_DATASET = "gd_lvzdpsdlw09j6t702";

// Platform-specific keywords only — avoid generic terms like "cloud cost"
// that match unrelated posts (e.g. about Claude AI pricing, car costs, etc.)
const SEARCH_KEYWORDS = [
  "vercel pricing expensive",
  "vercel bill surprise",
  "heroku migration alternative",
  "heroku too expensive",
  "firebase billing firestore",
  "firebase cost surprise",
  "aws bill NAT gateway",
  "self-hosting vercel alternative",
  "self-hosting heroku alternative",
  "moved from vercel to",
  "moved from heroku to",
  "moved from firebase to",
  "alternative to vercel hosting",
  "alternative to heroku hosting",
  "coolify self-host deploy",
  "hetzner vps migrate",
];

async function fetchWithSnapshot(apiKey, url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // Sync success
  if (res.status === 200) {
    return await res.json();
  }

  // Async — poll for snapshot
  if (res.status === 202) {
    const { snapshot_id } = await res.json();
    if (!snapshot_id) return [];

    console.log(`    Snapshot ${snapshot_id} — polling...`);
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 10000)); // 10s between polls

      const poll = await fetch(
        `${API_BASE}/progress/${snapshot_id}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      if (!poll.ok) continue;
      const status = await poll.json();

      if (status.status === "ready") {
        const dl = await fetch(
          `${API_BASE}/snapshot/${snapshot_id}?format=json`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );
        if (dl.ok) return await dl.json();
        return [];
      }

      if (status.status === "failed") {
        console.warn(`    Snapshot ${snapshot_id} failed`);
        return [];
      }
    }
    console.warn(`    Snapshot ${snapshot_id} timed out after 2 min`);
    return [];
  }

  // Error
  const text = await res.text();
  console.warn(`  Bright Data ${res.status}: ${text.slice(0, 100)}`);
  return [];
}

export async function scrapeRedditBrightData(apiKey, since) {
  if (!apiKey) {
    console.warn("Bright Data: BRIGHTDATA_API_KEY not set, skipping Reddit");
    return { posts: [], comments: [] };
  }

  const posts = [];
  const seen = new Set();

  // Discover posts by keyword
  for (const keyword of SEARCH_KEYWORDS) {
    try {
      const results = await fetchWithSnapshot(
        apiKey,
        `${API_BASE}/scrape?dataset_id=${POSTS_DATASET}&format=json&type=discover_new&discover_by=keyword`,
        [{ keyword, date: "Past hour", num_of_posts: 10 }]
      );

      for (const post of Array.isArray(results) ? results : []) {
        if (!post.post_id || seen.has(post.post_id)) continue;
        seen.add(post.post_id);

        posts.push({
          sourceId: post.post_id,
          sourceUrl: post.url,
          title: post.title ?? "",
          body: (post.description ?? "").slice(0, 2000),
          authorName: post.user_posted ?? undefined,
          engagementScore: (post.num_upvotes ?? 0) + (post.num_comments ?? 0),
          postedAt: post.date_posted ? new Date(post.date_posted) : undefined,
          subreddit: post.community_name ?? undefined,
          numComments: post.num_comments ?? 0,
        });
      }

      const count = Array.isArray(results) ? results.length : 0;
      if (count > 0) console.log(`  BD "${keyword}": ${count} posts`);

      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.warn(`  BD keyword "${keyword}": ${err.message}`);
    }
  }

  // Fetch comments for top-engagement posts (top 5)
  const comments = [];
  const topPosts = [...posts]
    .sort((a, b) => (b.engagementScore ?? 0) - (a.engagementScore ?? 0))
    .slice(0, 5);

  for (const post of topPosts) {
    if (!post.sourceUrl || post.numComments === 0) continue;

    try {
      const results = await fetchWithSnapshot(
        apiKey,
        `${API_BASE}/scrape?dataset_id=${COMMENTS_DATASET}&format=json`,
        [{ url: post.sourceUrl, days_back: 7 }]
      );

      for (const comment of Array.isArray(results) ? results : []) {
        comments.push({
          postId: post.sourceId,
          postTitle: post.title,
          sourceUrl: post.sourceUrl,
          commentId: comment.comment_id ?? comment.id,
          body: (comment.comment ?? comment.comment_text ?? "").slice(0, 2000),
          authorName: comment.user_posted ?? comment.author ?? undefined,
          upvotes: comment.num_upvotes ?? 0,
          postedAt: comment.date_posted ? new Date(comment.date_posted) : undefined,
        });
      }

      const count = Array.isArray(results) ? results.length : 0;
      if (count > 0) console.log(`  BD comments "${post.title.slice(0, 50)}": ${count}`);
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.warn(`  BD comments: ${err.message}`);
    }
  }

  return { posts, comments };
}
