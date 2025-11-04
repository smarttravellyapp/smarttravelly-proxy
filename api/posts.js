// app/api/posts/route.js
import { NextResponse } from "next/server";

// === CẤU HÌNH ===
const REST_API = "https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed";
const RSS_FEED = "https://smarttravelly.com/feed/";
const MAX_RETRIES = 5; // Tăng để chống CF intermittent block
const RETRY_DELAY = 2000; // ms, tăng delay
const CACHE_SECONDS = 43200; // 12h

// === HÀM CHÍNH ===
export async function GET() {
  console.log("Fetching posts from SmartTravelly..."); // Vercel log

  // 1. Thử REST API trước (ưu tiên vì test OK)
  const restData = await fetchWithRetry(REST_API, { useGoogleBot: true });

  if (restData.success && restData.posts.length > 0) {
    console.log(`✅ REST API success: ${restData.posts.length} posts`);
    return cacheResponse({
      success: true,
      count: restData.posts.length,
      posts: restData.posts,
      refreshed: new Date().toISOString(),
      source: "rest-api",
    }, false);
  }

  console.warn("REST API failed → trying RSS feed...");

  // 2. Fallback: RSS Feed
  const rssData = await fetchRSS(RSS_FEED);
  if (rssData.success && rssData.posts.length > 0) {
    console.log(`✅ RSS fallback success: ${rssData.posts.length} posts`);
    return cacheResponse({
      success: true,
      count: rssData.posts.length,
      posts: rssData.posts,
      refreshed: new Date().toISOString(),
      source: "rss-feed",
    }, true);
  }

  // 3. Không có dữ liệu
  console.warn("No data from both sources");
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

// === FETCH VỚI RETRY CẢI TIẾN ===
async function fetchWithRetry(url, { useGoogleBot = false } = {}) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const headers = {
        "User-Agent": useGoogleBot 
          ? "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"
          : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://smarttravelly.com/",
        "Origin": "https://smarttravelly.com",
        "Connection": "keep-alive", // Giúp CF không block
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
      };

      const res = await fetch(url, {
        method: "GET",
        headers,
        // Vercel/Next.js cache: force-cache cho ổn định
        cache: i === 0 ? "force-cache" : "no-store",
        next: { revalidate: i === 0 ? CACHE_SECONDS : 300 }, // Revalidate nhanh hơn nếu retry
      });

      console.log(`Attempt ${i + 1}: Status ${res.status}, Content-Type: ${res.headers.get("content-type")}`);

      const text = await res.text();

      // Kiểm tra block/error chi tiết
      if (
        res.status >= 400 ||
        text.includes("<html") ||
        text.includes("<!DOCTYPE") ||
        text.includes("cf-ray") ||
        text.includes("403 Forbidden") ||
        text.includes("blocked") ||
        text.includes("bot fight")
      ) {
        console.warn(`Attempt ${i + 1} blocked: ${res.status} - ${text.slice(0, 100)}`);
        if (i === MAX_RETRIES - 1) {
          return { success: false, raw: text.slice(0, 200), error: "Blocked or invalid response" };
        }
        await sleep(RETRY_DELAY * (i + 1));
        continue;
      }

      // Kiểm tra content-type
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        console.warn(`Attempt ${i + 1}: Non-JSON (${contentType})`);
        if (i === MAX_RETRIES - 1) {
          return { success: false, error: "Non-JSON response", raw: text.slice(0, 200) };
        }
        await sleep(RETRY_DELAY * (i + 1));
        continue;
      }

      // Parse JSON
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.warn(`Attempt ${i + 1}: Parse error - ${e.message}`);
        if (i === MAX_RETRIES - 1) {
          return { success: false, error: "JSON parse failed", raw: text.slice(0, 200) };
        }
        await sleep(RETRY_DELAY * (i + 1));
        continue;
      }

      if (Array.isArray(data) && data.length > 0) {
        const posts = data
          .filter((p) => p?.id && p?.link) // Lọc invalid
          .slice(0, 100) // Giới hạn nếu quá nhiều
          .map((p) => ({
            id: p.id,
            title: cleanHTML(p.title?.rendered || ""),
            link: p.link,
            date: p.date,
            excerpt: truncate(cleanHTML(p.excerpt?.rendered || ""), 280),
            image: getFeaturedImage(p),
          }));

        if (posts.length > 0) {
          return { success: true, posts };
        }
      }

      // Không có posts → retry
      if (i === MAX_RETRIES - 1) {
        return { success: false, error: "No posts in response" };
      }
      await sleep(RETRY_DELAY * (i + 1));
    } catch (err) {
      console.error(`Attempt ${i + 1} fetch error:`, err.message);
      if (i === MAX_RETRIES - 1) {
        return { success: false, error: err.message };
      }
      await sleep(RETRY_DELAY * (i + 1));
    }
  }

  return { success: false, error: "All retries exhausted" };
}

// === GET FEATURED IMAGE (Cải tiến từ test) ===
function getFeaturedImage(p) {
  return (
    p._embedded?.["wp:featuredmedia"]?.[0]?.media_details?.sizes?.large?.source_url ||
    p._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
    p.fifu_image_url ||
    p.uagb_featured_image_src?.full ||
    null
  );
}

// === RSS FALLBACK (Giữ nguyên, nhưng test OK) ===
async function fetchRSS(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept": "application/rss+xml, application/xml, text/xml",
      },
      cache: "force-cache",
      next: { revalidate: 3600 },
    });

    const text = await res.text();
    if (res.status >= 400 || text.includes("<html")) {
      return { success: false };
    }

    const posts = parseRSS(text);
    if (posts.length > 0) {
      return { success: true, posts };
    }
  } catch (err) {
    console.error("RSS error:", err.message);
  }
  return { success: false };
}

function parseRSS(xml) {
  const posts = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  let count = 0;

  while ((match = itemRegex.exec(xml)) !== null && count < 20) {
    const item = match[1];
    const title = extractTag(item, "title") || "No title";
    const link = extractTag(item, "link");
    const pubDate = extractTag(item, "pubDate");
    const description = (extractTag(item, "description") || extractTag(item, "content:encoded") || "").replace(/<[^>]+>/g, "").trim();
    const image = extractEnclosureImage(item) || extractImageFromDescription(description);

    if (link) {
      posts.push({
        id: link.split("/").pop().replace(/[^0-9]/g, "") || Date.now().toString(),
        title: cleanHTML(title),
        link: link.replace(/utm_source=.*$/, ""), // Clean UTM
        date: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
        excerpt: truncate(description, 280),
        image,
      });
      count++;
    }
  }
  return posts;
}

function extractTag(str, tag) {
  const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "is");
  const match = str.match(regex);
  return match ? match[1].trim().replace(/<!\[CDATA\[(.*)\]\]>/, "$1") : null;
}

function extractEnclosureImage(item) {
  const match = item.match(/<enclosure[^>]+url=["']([^"']+\.(jpe?g|png|gif|webp))["']/i);
  return match ? match[1] : null;
}

function extractImageFromDescription(html) {
  const match = html.match(/src=["']([^"']+\.(jpe?g|png|gif|webp))["']/i);
  return match ? match[1] : null;
}

// === UTILS ===
function cleanHTML(html) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheResponse(data, isFallback) {
  const response = NextResponse.json(data);
  const cacheControl = isFallback
    ? "public, s-maxage=3600, stale-while-revalidate=1800"
    : `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=3600`;

  response.headers.set("Cache-Control", cacheControl);
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Vary", "Origin");
  response.headers.set("X-Source", data.source || "unknown");

  return response;
}
