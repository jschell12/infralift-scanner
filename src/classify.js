// Keyword-based classification. No external API dependency.
// Scores posts as billing_pain, migration_interest, or platform_complaint.
// IMPORTANT: requires a hosting/cloud context word to avoid false positives
// from unrelated posts about "cost" or "expensive" in other domains.

// Hosting providers and platforms we care about
const HOSTING_CONTEXT = /\b(vercel|heroku|firebase|aws|amazon|gcp|google cloud|azure|netlify|render|railway|fly\.io|digitalocean|cloudflare|hetzner|linode|cloud|hosting|server|deploy|infrastructure|saas|paas|vps|docker|kubernetes|k8s|terraform|devops|self[- ]host|coolify|dokku)\b/i;

const BILLING_PAIN = [
  /\b(surprise|unexpected|shocking)\s*(bill|invoice|charge)/i,
  /\$\d{2,}[kK]?\s*(bill|month|invoice)/i,
  /\b(expensive|overpriced|overcharged|cost.{0,10}(too much|insane|crazy|ridiculous))/i,
  /\b(egress|bandwidth)\s*(fee|charge|cost|bill)/i,
  /\b(per[- ]seat|per[- ]user)\s*(pricing|cost|fee)/i,
  /\b(usage[- ]based|metered)\s*(pricing|billing|cost).{0,20}(surprise|shock|unexpected|high)/i,
  /\bNAT\s*gateway.{0,10}cost/i,
  /\b(vercel|heroku|firebase|aws|gcp|azure|netlify|render|railway|fly\.io|digitalocean).{0,20}(expensive|bill|cost|pricing)/i,
];

const MIGRATION_INTEREST = [
  /\b(moved?|migrat|switch|transition)\s*(from|off|away)\s*(vercel|heroku|firebase|aws|gcp|azure|netlify|render|railway|fly\.io|digitalocean)/i,
  /\balternative\s*to\s*(vercel|heroku|firebase|aws|gcp|azure|netlify|render|railway|fly\.io|digitalocean)/i,
  /\b(self[- ]host|coolify|dokku|kamal|hetzner).{0,20}(instead|replace|alternative|migrate)/i,
  /\b(looking|searching|considering|evaluating).{0,20}(hosting|cloud|provider).{0,20}(alternative|replacement|migration)/i,
  /\b(moved?|switch)\s*to\s*(cloudflare|hetzner|vps|self[- ]host|coolify)/i,
  /\bhow\s*(do|to|should).{0,15}(migrate|move|switch|deploy).{0,15}(off|from|away).{0,15}(vercel|heroku|firebase|aws|gcp|azure|netlify)/i,
];

const PLATFORM_COMPLAINT = [
  /\b(heroku|vercel|firebase|aws|netlify|render|railway|fly\.io|digitalocean).{0,20}(stagnant|maintenance mode|no new features|sunset|deprecated|killed|removed)/i,
  /\b(vendor|platform)\s*(lock[- ]?in|dependency).{0,20}(cloud|hosting|vercel|heroku|firebase|aws)/i,
  /\b(vercel|heroku|firebase|aws|netlify).{0,20}(support|reliability|uptime).{0,15}(terrible|awful|bad|poor|worst|nonexistent)/i,
  /\b(security|breach|incident|compromised).{0,15}(vercel|heroku|firebase|aws|netlify)/i,
  /\b(forced|unexpected)\s*(migration|upgrade|change).{0,20}(vercel|heroku|firebase|aws|netlify)/i,
  /\b(vercel|heroku|firebase|netlify).{0,10}free\s*tier.{0,15}(removed|killed|eliminated|gone)/i,
];

function score(text, patterns) {
  let hits = 0;
  for (const p of patterns) {
    if (p.test(text)) hits++;
  }
  return hits;
}

export function classify(title, body) {
  const text = `${title} ${body}`;

  // Gate: post must mention a hosting/cloud context to be relevant
  if (!HOSTING_CONTEXT.test(text)) {
    return { classification: "irrelevant", confidence: "low" };
  }

  const billing = score(text, BILLING_PAIN);
  const migration = score(text, MIGRATION_INTEREST);
  const complaint = score(text, PLATFORM_COMPLAINT);

  const max = Math.max(billing, migration, complaint);
  if (max === 0) return { classification: "irrelevant", confidence: "low" };

  let classification;
  if (billing >= migration && billing >= complaint) classification = "billing_pain";
  else if (migration >= complaint) classification = "migration_interest";
  else classification = "platform_complaint";

  const confidence = max >= 3 ? "high" : max >= 2 ? "medium" : "low";
  return { classification, confidence };
}
