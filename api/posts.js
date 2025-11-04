// app/api/posts/route.js
import { NextResponse } from "next/server";

// === CẤU HÌNH ===
const REST_API = "https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed";
const RSS_FEED = "https://smarttravelly.com/feed/";
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const CACHE_SECONDS = 43200;

// === KHÔNG DÙNG EDGE → DÙNG NODEJS ===
export const dynamic = "force-dynamic"; // Tắt cache tĩnh nếu cần

// === UTILS ===
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanHTML = (html = "") =>
  html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const truncate = (str = "", len = 280) =>
  str.length > len ? str.slice(0, len) + "..." : str;

const getFeaturedImage = (p) =>
  p._embedded?.["wp:featuredmedia"]?.[0]?.media_details?.sizes?.large?.source_url ||
  p._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
  null;

// === GET HANDLER ===
export async function GET() {
  console.log("Starting fetch from SmartTravelly...");

  // 1. REST API
  const restResult = await fetchWithRetry(REST_API);
  if (restResult.success && restResult.posts.length > 0) {
    console.log(`REST API: ${restResult.posts.length} posts`);
    return cacheResponse({
      success: true,
      count: restResult.posts.length,
      posts: restResult.posts,
      refreshed: new Date().toISOString(),
      source: "rest-api",
    });
  }

  console.warn("REST failed, trying RSS...");

  // 2. RSS Fallback
  const rssResult = await fetchRSS(RSS_FEED);
  if (rssResult.success && rssResult.posts.length > 0) {
    console.log(`RSS: ${rssResult.posts.length} posts`);
    return cacheResponse({
      success: true,
      count: rssResult.posts.length,
      posts: rssResult.posts,
      refreshed: new Date().toISOString(),
      source: "rss-feed",
    });
  }

  // 3. Không có data
  return cacheResponse({
    success: true,
    count: 0,
    posts: [],
    refreshed: new Date().toISOString(),
    source: "none",
    message: "No articles found at the moment. Please check back later.",
  });
}

// === FETCH WITH RETRY (Node.js OK) ===
async function fetchWithRetry(url) {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          Accept: "application/json, text/plain, */*",
          Referer: "https://smarttravelly.com/",
          Origin: "https://smarttravelly.com",
        },
        // Cache lâu
        next: { revalidate: i === 0 ? CACHE_SECONDS : 300 },
      });

      console.log(`Attempt ${i + 1}: ${res.status}`);

      if (!res.ok) {
        if (i === MAX_RETRIES - 1) return { success: false };
        await sleep(RETRY_DELAY);
        continue;
      }

      const text = await res.text();

      // Kiểm tra HTML block
      if (text.includes("<html") || text.includes("cf-ray") || text.includes("403")) {
        console.warn(`Blocked: ${text.slice(0, 100)}`);
        if (i === MAX_RETRIES - 1) return { success: false };
        await sleep(RETRY_DELAY);
        continue;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        if (i === MAX_RETRIES - 1) return { success: false };
        await sleep(RETRY_DELAY);
        continue;
      }

      if (Array.isArray(data) && data.length > 0) {
        const posts = data
          .filter((p) => p?.id && p?.link)
          .slice(0, 50)
          .map((p) => ({
            id: p.id,
            title: cleanHTML(p.title?.rendered),
            link: p.link,
            date: p.date,
            excerpt: truncate(cleanHTML(p.excerpt?.rendered)),
            image: getFeaturedImage(p),
          }));

        return { success: true, posts };
      }
    } catch (err) {
      console.error(`Error attempt ${i + 1}:`, err.message);
    }

    if (i < MAX_RETRIES - 1) await sleep(RETRY_DELAY);
  }

  return { success: false };
}

// === RSS SIMPLE PARSER (Node.js OK) ===
async function fetchRSS(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Googlebot" },
      next: { revalidate: 3600 },
    });

    if (!res.ok) return { success: false };

    const text = await res.text();
    if (text.includes("<html")) return { success: false };

    const posts = [];
    const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];

    for (const item of items.slice(0, 20)) {
      const title = item.match(/<title>(<!\[CDATA\[)?(.*?)(\]\]>)?<\/title>/i)?.[2] || "";
      const link = item.match(/<link>(.*?)<\/link>/i)?.[1] || "";
      const date = item.match(/<pubDate>(.*?)<\/pubDate>/i)?.[1] || "";
      const desc = (item.match(/<description>(<!\[CDATA\[)?([\s\S]*?)(\]\]>)?<\/description>/i)?.[2] || "").replace(/<[^>]+>/g, "").trim();
      const img = item.match(/src=["']([^"']+\.(jpe?g|png|webp))["']/i)?.[1] || null;

      if (link) {
        posts.push({
          id: link.split("/").pop().replace(/\D/g, "") || Date.now(),
          title: cleanHTML(title),
          link,
          date: date ? new Date(date).toISOString() : new Date().toISOString(),
          excerpt: truncate(desc),
          image: img,
        });
      }
    }

    return posts.length > 0 ? { success: true, posts } : { success: false };
  } catch {
    return { success: false };
  }
}

// === CACHE RESPONSE ===
function cacheResponse(data) {
  const res = NextResponse.json(data);
  res.headers.set("Cache-Control", `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=3600`);
  res.headers.set("Access-Control-Allow-Origin", "*");
  return res;
}
