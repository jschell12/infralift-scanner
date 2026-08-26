// Bright Data Reddit Scraper API — keyword discovery for posts + comment collection.
// Uses the "Discover by keyword" endpoint to find relevant posts across subreddits,
// then optionally fetches comments on high-engagement matches.
//
// Pricing: ~$1.50 per 1,000 records. Free tier: 5,000 records/month.
// Estimated cost with keyword discovery: ~$18/month at 6 scans/day.

const API_BASE = "https://api.brightdata.com/datasets/v3/scrape";
const POSTS_DATASET = "gd_lvz8ah06191smkebj4";
const COMMENTS_DATASET = "gd_lvzdpsdlw09j6t702";

const SEARCH_KEYWORDS = [
  "cloud bill expensive",
  "vercel pricing",
  "heroku migration",
  "firebase billing",
  "cloud cost",
  "hosting expensive",
  "self-hosting migration",
  "alternative to vercel",
  "alternative to heroku",
  "moved from vercel",
  "moved from heroku",
  "moved from firebase",
  "egress fees",
  "cloud migration terraform",
];

export async function scrapeRedditBrightData(apiKey, since) {
  if (!apiKey) {
    console.warn("Bright Data: BRIGHTDATA_API_KEY not set, skipping Reddit");
    return { posts: [], comments: [] };
  }

  const posts = [];
  const seen = new Set();
  const sinceDate = since.toISOString().split("T")[0]; // YYYY-MM-DD

  // Discover posts by keyword
  for (const keyword of SEARCH_KEYWORDS) {
    try {
      const res = await fetch(
        `${API_BASE}?dataset_id=${POSTS_DATASET}&format=json`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            {
              keyword,
              date: sinceDate,
              num_of_posts: 10,
            },
          ]),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        console.warn(`Bright Data keyword "${keyword}": ${res.status} ${text.slice(0, 100)}`);
        continue;
      }

      const results = await res.json();
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

      console.log(`  BD keyword "${keyword}": ${(Array.isArray(results) ? results : []).length} posts`);

      // Rate limit between keyword searches
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.warn(`Bright Data keyword "${keyword}": ${err.message}`);
    }
  }

  // Fetch comments for top-engagement posts (top 5 by upvotes)
  const comments = [];
  const topPosts = [...posts]
    .sort((a, b) => (b.engagementScore ?? 0) - (a.engagementScore ?? 0))
    .slice(0, 5);

  for (const post of topPosts) {
    if (!post.sourceUrl || post.numComments === 0) continue;

    try {
      const res = await fetch(
        `${API_BASE}?dataset_id=${COMMENTS_DATASET}&format=json`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            {
              url: post.sourceUrl,
              days_back: 7,
            },
          ]),
        }
      );

      if (!res.ok) continue;

      const results = await res.json();
      for (const comment of Array.isArray(results) ? results : []) {
        comments.push({
          postId: post.sourceId,
          postTitle: post.title,
          sourceUrl: post.sourceUrl,
          commentId: comment.comment_id ?? comment.id,
          body: (comment.comment_text ?? comment.body ?? "").slice(0, 2000),
          authorName: comment.user_commented ?? comment.author ?? undefined,
          upvotes: comment.num_upvotes ?? 0,
          postedAt: comment.date_commented ? new Date(comment.date_commented) : undefined,
        });
      }

      console.log(`  BD comments for "${post.title.slice(0, 50)}": ${(Array.isArray(results) ? results : []).length}`);
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.warn(`Bright Data comments: ${err.message}`);
    }
  }

  return { posts, comments };
}
