# infralift-scanner

Community lead scanner for [infralift](https://infralift.dev) — reads developer forums for cloud migration and billing pain discussions.

## What it does

Periodically fetches recent posts from developer communities (Reddit, Hacker News, DEV.to, Stack Exchange, Lobsters), classifies them by keyword scoring as:

- **billing_pain** — complaints about cloud costs, surprise bills, egress fees
- **migration_interest** — asking about alternatives, considering migration
- **platform_complaint** — reliability issues, vendor lock-in, stagnation

Relevant posts are stored in a PostgreSQL database as leads for the infralift platform.

## Platforms scraped

| Platform | API | Auth required |
|----------|-----|---------------|
| Reddit | `reddit.com/r/{sub}.json` | Pending approval |
| Hacker News | Algolia Search API | No |
| DEV.to | `dev.to/api/articles` | No |
| Stack Exchange | `api.stackexchange.com` | No (optional key) |
| Lobsters | `lobste.rs/newest.json` | No |

## Usage

```bash
npm install
DATABASE_URL="postgresql://..." node src/index.js
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |

## How classification works

No LLM or external API — uses keyword/regex pattern matching against post titles and bodies. Patterns cover:

- Billing terms: "surprise bill", "$Xk bill", "expensive", "egress fees", "per-seat pricing"
- Migration terms: "moved from Vercel", "alternative to Heroku", "self-host", "switched to"
- Complaint terms: "vendor lock-in", "maintenance mode", "free tier removed", "security breach"

Posts matching zero patterns are discarded as irrelevant.

## License

MIT
