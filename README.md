# infralift-scanner

Community lead scanner for [infralift](https://infralift.dev) — reads developer forums for cloud migration and billing pain discussions.

## What it does

Periodically fetches recent posts from developer communities, classifies them by keyword scoring as:

- **billing_pain** — complaints about cloud costs, surprise bills, egress fees
- **migration_interest** — asking about alternatives, considering migration
- **platform_complaint** — reliability issues, vendor lock-in, stagnation

Relevant posts are stored in a PostgreSQL database as leads.

## Platforms scraped

| Platform | Method | Auth |
|----------|--------|------|
| Reddit | Bright Data Scraper API (keyword discovery + comments) | BRIGHTDATA_API_KEY |
| Reddit (fallback) | RSS feeds via curl | None |
| Hacker News | Algolia Search API | None |
| DEV.to | Public API | None |
| Stack Exchange | Public API | None |
| Lobsters | JSON feeds | None |

## Usage

```bash
npm install

# Without Bright Data (RSS fallback for Reddit):
DATABASE_URL="postgresql://..." node src/index.js

# With Bright Data Reddit:
DATABASE_URL="postgresql://..." BRIGHTDATA_API_KEY="..." node src/index.js

# Backfill from Jan 1 2026:
DATABASE_URL="postgresql://..." node src/backfill.js
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `BRIGHTDATA_API_KEY` | No | Bright Data API key for Reddit scraping (~$18/mo) |

## Cost estimate (Bright Data)

- 14 keyword searches x 10 posts each = ~140 post records/scan
- Comments on top 5 posts = ~50 comment records/scan
- 6 scans/day x 30 days = ~34,200 records/month
- At $1.50/1,000 records = **~$18/month** (reduced with keyword targeting)
- Free tier: 5,000 records/month (no credit card)

## License

MIT
