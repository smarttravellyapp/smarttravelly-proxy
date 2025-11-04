// app/api/posts/route.js
import { NextResponse } from "next/server";

// === CẤU HÌNH ===
const REST_API = "https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed";
const RSS_FEED = "https://smarttravelly.com/feed/";
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // Giảm để nhanh
const CACHE_SECONDS = 43200;

// XÓA EDGE CONFIG: Dùng Node.js runtime
export const dynamic = "force-dynamic";

// === UTILS (Robust) ===
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanHTML = (html = "") => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const truncate = (str = "", len = 280) => str.length > len ? str.slice(0, len) + "..." : str;

const getFeaturedImage = (p) => {
  try {
    return (
      p._embedded?.["wp:featuredmedia"]?.[0]?.media_details?.sizes?.large?.source_url ||
      p._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
      null
    );
  } catch {
    return null;
  }
};

const isHTMLResponse = (text) =>
  text.includes("<html") || text.includes("<!DOCTYPE") || text.includes("<body") || text.includes("cf-ray");

// === MAIN HANDLER ===
export async function GET() {
  try {
    console.log("🚀 Starting SmartTravelly fetch...");

    // 1. REST API
    const restResult = await fetchWithRetry(REST_API);
    if (restResult.success && restResult.posts?.length > 0) {
      console.log(`✅ REST: ${restResult.posts.length} posts fetched`);
      return cacheResponse({
        success: true,
        count: restResult.posts.length,
        posts: restResult.posts,
        refreshed: new Date().toISOString(),
        source: "rest-api",
      });
    }

    console.warn("⚠️ REST failed, trying RSS...");

    // 2. RSS Fallback
    const rssResult = await fetchRSS(RSS_FEED);
    if (rssResult.success && rssResult.posts?.length > 0) {
      console.log(`✅ RSS: ${rssResult.posts.length} posts fetched`);
      return cacheResponse({
        success: true,
        count: rssResult.posts.length,
        posts: rssResult.posts,
        refreshed: new Date().toISOString(),
        source: "rss-feed",
      });
    }

    // 3. Empty
    console.warn("⚠️ No data from any source");
    return cacheResponse({
      success: true,
      count: 0,
      posts: [],
      refreshed: new Date().toISOString(),
      source: "none",
      message: "No articles found at the moment. Please check back later.",
    });
  } catch (error) {
    console.error("💥 CRITICAL ERROR:", error.message, error.stack);
    return NextResponse.json(
      {
        success: false,
        count: 0,
        posts: [],
        refreshed: new Date().toISOString(),
        source: "error",
        message: "Internal fetch error. Check logs.",
        error: process.env.NODE_ENV === "development" ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// === ROBUST FETCH + RETRY ===
async function fetchWithRetry(url, attempt = 0) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept: "application/json, text/plain, */*",
        Referer: "https://smarttravelly.com/",
        Origin: "https://smarttravelly.com",
      },
      next: { revalidate: CACHE_SECONDS },
    });

    console.log(`Fetch attempt ${attempt + 1}: Status ${res.status}, Size ~${res.headers.get("content-length") || "unknown"}`);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const text = await res.text();
    if (isHTMLResponse(text)) {
      throw new Error("HTML response (blocked or malformed)");
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      console.warn("Parse fail:", parseErr.message.slice(0, 100));
      throw new Error("Invalid JSON");
    }

    if (!Array.isArray(data)) {
      throw new Error("Not an array");
    }

    const posts = data
      .filter((p) => p?.id && p?.link)
      .slice(0, 50) // Giới hạn
      .map((p) => ({
        id: p.id,
        title: cleanHTML(p.title?.rendered || p.title || ""),
        link: p.link,
        date: p.date,
        excerpt: truncate(cleanHTML(p.excerpt?.rendered || "")),
        image: getFeaturedImage(p),
      }))
      .filter((post) => post.title); // Loại empty

    if (posts.length === 0 && attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_DELAY);
      return fetchWithRetry(url, attempt + 1);
    }

    return { success: true, posts };
  } catch (error) {
    console.error(`Fetch error (attempt ${attempt + 1}):`, error.message);
    if (attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_DELAY * (attempt + 1));
      return fetchWithRetry(url, attempt + 1);
    }
    return { success: false };
  }
}

// === ROBUST RSS (Dùng DOM parser thay regex) ===
async function fetchRSS(url) {
  try {
    // Simple fetch, no retry for fallback
    const res = await fetch(url, {
      headers: { "User-Agent": "Googlebot" },
      next: { revalidate: 3600 },
    });

    if (!res.ok) return { success: false };

    const text = await res.text();
    if (text.includes("<html")) return { success: false };

    // Parse XML như string (không dùng lib ngoài)
    const parser = new DOMParser(); // Node.js không có, dùng string split
    const items = text.split("<item>").slice(1); // Simple split
    const posts = [];

    for (const itemStr of items.slice(0, 20)) {
      try {
        const titleMatch = itemStr.match(/<title[^>]*>([^<]+|<!\[CDATA\[([^\]]*)\]\]>)<\/title>/i);
        const title = (titleMatch?.[1] || titleMatch?.[2] || "").trim();
        
        const linkMatch = itemStr.match(/<link[^>]*>([^<]+)<\/link>/i);
        const link = linkMatch?.[1]?.trim();

        const dateMatch = itemStr.match(/<pubDate[^>]*>([^<]+)<\/pubDate>/i);
        const date = dateMatch?.[1] ? new Date(dateMatch[1]).toISOString() : new Date().toISOString();

        const descMatch = itemStr.match(/<(description|content:encoded)[^>]*>([^<]+|<!\[CDATA\[([\s\S]*?)\]\]>)<\/\1>/i);
        let desc = (descMatch?.[2] || descMatch?.[3] || "").replace(/<[^>]+>/g, "").trim();
        desc = truncate(cleanHTML(desc));

        const imgMatch = itemStr.match(/<enclosure[^>]+url=["']([^"']+\.(jpe?g|png|gif|webp))["']/i) ||
                         itemStr.match(/src=["']([^"']+\.(jpe?g|png|gif|webp))["']/i);
        const image = imgMatch?.[1];

        if (link && title) {
          posts.push({
            id: link.split("/").pop().replace(/\D/g, "") || Date.now(),
            title: cleanHTML(title),
            link: link.replace(/utm_.*$/, ""),
            date,
            excerpt: desc,
            image,
          });
        }
      } catch (itemErr) {
        console.warn("RSS item parse skip:", itemErr.message);
      }
    }

    return { success: posts.length > 0, posts };
  } catch (error) {
    console.error("RSS full fail:", error.message);
    return { success: false };
  }
}

// === CACHE ===
function cacheResponse(data) {
  const response = NextResponse.json(data, { status: data.success ? 200 : 502 });
  response.headers.set("Cache-Control", `public, s-maxage=${data.count > 0 ? CACHE_SECONDS : 300}, stale-while-revalidate=1800`);
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("X-Source", data.source || "unknown");
  return response;
}
