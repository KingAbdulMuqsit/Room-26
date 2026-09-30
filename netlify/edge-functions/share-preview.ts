// Room 26 — link previews.
// WhatsApp, X, Facebook, iMessage, Slack, LinkedIn etc. don't run the site's JavaScript,
// so this runs on Netlify before the page is sent and writes each post's title, summary
// and image into the HTML as Open Graph / Twitter card tags.
// Runs on "/" (site card) and "/p/<id>" (one card per published post).

import type { Config, Context } from "https://edge.netlify.com";

// Public values (the same ones in config.js). Override in Netlify env vars if the project changes.
const SUPABASE_URL = Netlify.env.get("SUPABASE_URL") ?? "https://ssvuyflzpsseoexadqvo.supabase.co";
const SUPABASE_ANON_KEY = Netlify.env.get("SUPABASE_ANON_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzdnV5Zmx6cHNzZW9leGFkcXZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzM4OTMsImV4cCI6MjEwNjI0OTg5M30.MiQ3uBkVgbdrzoyzVEM5qo7rhR1SPEhWDI_a1hrk90Y";

const SITE_NAME = "Room 26";
const SITE_DESC = "News, album reviews, music, film and sports from Room 26.";
const SECTION: Record<string, string> = { news: "News", reviews: "Album review", features: "Music", interviews: "Film", culture: "Sports" };
const POST_PATH = /^\/p\/([0-9a-f-]{36})\/?$/i;

type Post = {
  id: string; type: string; title: string; dek: string; body: string; author: string;
  cover_path: string | null; published_at: string | null; updated_at: string | null;
  review: { artist?: string; album?: string; score?: number } | null;
};

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

// First real paragraph of the body, without the site's formatting marks
function summary(p: Post): string {
  if (p.dek?.trim()) return clip(p.dek.trim(), 200);
  const para = (p.body || "").split(/\n\s*\n/).map((b) => b.trim())
    .find((b) => b && !b.startsWith("## ") && !b.startsWith("[image ")) ?? "";
  const text = para.replace(/^>\s?/gm, "").replace(/\s+/g, " ").trim();
  if (text) return clip(text, 200);
  if (p.type === "reviews" && p.review?.album) return `${SECTION.reviews}: ${p.review.artist ?? ""} – ${p.review.album}`;
  return SITE_DESC;
}

async function fetchPost(id: string): Promise<Post | null> {
  const url = `${SUPABASE_URL}/rest/v1/posts?id=eq.${id}&status=eq.published` +
    `&select=id,type,title,dek,body,author,cover_path,published_at,updated_at,review&limit=1`;
  try {
    const r = await fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows?.[0] ?? null;
  } catch {
    return null;
  }
}

function tags(t: { title: string; desc: string; url: string; image: string; imageAlt: string; type: string; extra?: string }) {
  return [
    `<meta name="description" content="${attr(t.desc)}">`,
    `<link rel="canonical" href="${attr(t.url)}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${t.type}">`,
    `<meta property="og:title" content="${attr(t.title)}">`,
    `<meta property="og:description" content="${attr(t.desc)}">`,
    `<meta property="og:url" content="${attr(t.url)}">`,
    `<meta property="og:image" content="${attr(t.image)}">`,
    `<meta property="og:image:alt" content="${attr(t.imageAlt)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${attr(t.title)}">`,
    `<meta name="twitter:description" content="${attr(t.desc)}">`,
    `<meta name="twitter:image" content="${attr(t.image)}">`,
    t.extra ?? "",
  ].join("\n");
}

export default async (request: Request, context: Context) => {
  const url = new URL(request.url);
  const origin = url.origin;
  // Netlify serves index.html here ("/p/*" is rewritten to it in netlify.toml); we edit it on the way out
  const page = await context.next();
  if (!(page.headers.get("content-type") ?? "").includes("text/html")) return page;
  let html = await page.text();

  const m = url.pathname.match(POST_PATH);
  const post = m ? await fetchPost(m[1]) : null;

  let head: string;
  let title = SITE_NAME;
  if (post) {
    title = `${post.title} · ${SITE_NAME}`;
    const image = post.cover_path
      ? `${SUPABASE_URL}/storage/v1/object/public/media/${post.cover_path.split("/").map(encodeURIComponent).join("/")}`
      : `${origin}/og-default.png`;
    const extra = [
      post.published_at ? `<meta property="article:published_time" content="${attr(post.published_at)}">` : "",
      post.updated_at ? `<meta property="article:modified_time" content="${attr(post.updated_at)}">` : "",
      post.author ? `<meta property="article:author" content="${attr(post.author)}">` : "",
      `<meta property="article:section" content="${attr(SECTION[post.type] ?? "")}">`,
    ].join("\n");
    head = tags({ title: post.title, desc: summary(post), url: `${origin}/p/${post.id}`, image,
      imageAlt: post.cover_path ? post.title : "Room 26", type: "article", extra });
  } else {
    head = tags({ title: SITE_NAME, desc: SITE_DESC, url: `${origin}/`, image: `${origin}/og-default.png`, imageAlt: "Room 26", type: "website" });
  }

  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${attr(title)}</title>`)
    .replace(/<meta name="description"[^>]*>\n?/, "")
    .replace("</head>", `${head}\n</head>`);

  return new Response(html, {
    status: m && !post ? 404 : 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Cache briefly at Netlify's edge so edits show up in new shares within a minute
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
};

export const config: Config = { path: ["/", "/p/*"] };
