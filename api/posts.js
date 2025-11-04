// app/api/posts/route.js
import { NextResponse } from "next/server";

// === CẤU HÌNH ===
const REST_API = "https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed";
const RSS_FEED = "https://smarttravelly.com/feed/";
const MAX_RETRIES = 3;
const RETRY_DELAY = 1500; // ms
const CACHE_SECONDS = 43200; // 12 giờ

// === HÀM CHÍNH ===
export async function GET() {
  // 1. Thử REST API trước
  const restData = await fetchWithRetry(REST_API, { useGoogleBot: true });

  if (restData.success && restData.posts.length > 0) {
    return cacheResponse(restData.json, false);
  }

  console.warn("REST API failed or empty → trying RSS feed...");

  // 2. Fallback: RSS Feed
  const rssData = await fetchRSS(RSS_FEED);
  if (rssData.success && rssData.posts.length > 0) {
    return cacheResponse(rssData.json, true);
  }

  // 3. Không có dữ liệu → trả thông báo
  const emptyResponse = {
    success: true,
    count: 0,
    posts: [],
    refreshed: new Date().toISOString(),
    source: "none",
    message: "No articles found at the moment. Please check back later.",
  };

  return cacheResponse(emptyResponse, false);
}

// === FETCH VỚI RETRY + GOOGLEBOT ===
async function fetchWithRetry(url, { useGoogleBot = false } = {}) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const headers = {
        Accept: "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate, br",
        Referer: "https://smarttravelly.com/",
      };

      if (useGoogleBot) {
        headers["User-Agent"] =
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
      }

      const res = await fetch(url, {
        headers,
        next: { revalidate: i === 0 ? CACHE_SECONDS : 60 }, // cache lâu nếu thành công
      });

      const text = await res.text();

      // Kiểm tra bị chặn (Cloudflare, HTML, 403...)
      if (
        res.status >= 400 ||
        text.includes("<html") ||
        text.includes("<!DOCTYPE") ||
        text.includes("cf-ray") ||
        text.includes("403 Forbidden") ||
        text.includes("blocked")
      ) {
        console.warn(`Attempt ${i + 1} failed: ${res.status} - Blocked or HTML`);
        if (i === MAX_RETRIES - 1) {
          return { success: false, raw: text.slice(0, 200) };
        }
        await sleep(RETRY_DELAY * (i + 1));
        continue;
      }

      // Parse JSON
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.warn(`Attempt ${i + 1}: Invalid JSON`);
        if (i === MAX_RETRIES - 1) {
          return { success: false, error: "Invalid JSON", raw: text.slice(0, 200) };
        }
        await sleep(RETRY_DELAY * (i + 1));
        continue;
      }

      if (Array.isArray(data) && data.length > 0) {
        const posts = data
          .filter((p) => p?.id && p?.link)
          .map((p) => ({
            id: p.id,
            title: cleanHTML(p.title?.rendered || ""),
            link: p.link,
            date: p.date,
            excerpt: truncate(cleanHTML(p.excerpt?.rendered || ""), 280),
            image:
              p._embedded?.["wp:featuredmedia"]?.[0]?.media_details?.sizes?.large?.source_url ||
              p._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
              null,
          }));

        return {
          success: true,
          json: {
            success: true,
            count: posts.length,
            posts,
            refreshed: new Date().toISOString(),
            source: "rest-api",
          },
        };
      }
    } catch (err) {
      console.error(`Attempt ${i + 1} error:`, err.message);
    }

    if (i === MAX_RETRIES - 1) {
      return { success: false, error: "All retries failed" };
    }
    await sleep(RETRY_DELAY * (i + 1));
  }

  return { success: false };
}

// === FALLBACK: RSS FEED ===
async function fetchRSS(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      },
      next: { revalidate: 3600 },
    });

    const text = await res.text();

    // Parse RSS XML → JSON
    const posts = parseRSS(text);
    if (posts.length > 0) {
      return {
        success: true,
        json: {
          success: true,
          count: posts.length,
          posts,
          refreshed: new Date().toISOString(),
          source: "rss-feed",
        },
      };
    }
  } catch (err) {
    console.error("RSS fetch failed:", err.message);
  }

  return { success: false };
}

// === PARSE RSS (simple, no external lib) ===
function parseRSS(xml) {
  const posts = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];

    const title = extractTag(item, "title") || "No title";
    const link = extractTag(item, "link");
    const pubDate = extractTag(item, "pubDate");
    const description = extractTag(item, "description") || extractTag(item, "content:encoded") || "";
    const image = extractEnclosureImage(item) || extractImageFromDescription(description);

    if (link) {
      posts.push({
        id: link.split("/").pop().replace(/[^0-9]/g, "") || Date.now(),
        title: cleanHTML(title),
        link,
        date: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        excerpt: truncate(cleanHTML(description), 280),
        image,
      });
    }

    if (posts.length >= 20) break; // giới hạn
  }

  return posts;
}

function extractTag(str, tag) {
  const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "i");
  const match = str.match(regex);
  return match ? match[1].trim() : null;
}

function extractEnclosureImage(item) {
  const match = item.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*\/>/i);
  return match && match[1].match(/\.(jpe?g|png|gif|webp)/i) ? match[1] : null;
}

function extractImageFromDescription(html) {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match && match[1].match(/\.(jpe?g|png|gif|webp)/i) ? match[1] : null;
}

// === UTILS ===
function cleanHTML(html) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cacheResponse(data, isFallback) {
  const response = NextResponse.json(data);

  const cacheControl = isFallback
    ? "public, s-maxage=3600, stale-while-revalidate=3600"
    : `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=3600`;

  response.headers.set("Cache-Control", cacheControl);
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Vary", "Origin");
  response.headers.set("X-Source", data.source || "unknown");

  return response;
}
