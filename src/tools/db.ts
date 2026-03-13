/** SQLite Database for persistent storage — ported from db.py using better-sqlite3. */
import Database from "better-sqlite3";
import { settings } from "../config/settings.js";

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(settings.sqliteDbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function initDb(): void {
  const conn = getDb();
  conn.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id TEXT UNIQUE,
      content TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'post',
      platform TEXT NOT NULL DEFAULT 'twitter',
      strategy_context TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER,
      tweet_id TEXT UNIQUE,
      original_tweet_id TEXT NOT NULL,
      original_text TEXT,
      reply_text TEXT NOT NULL,
      author_id TEXT,
      platform TEXT NOT NULL DEFAULT 'twitter',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS engagements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      target_tweet_id TEXT,
      target_author_id TEXT,
      target_author_handle TEXT,
      content TEXT,
      keyword_matched TEXT,
      platform TEXT NOT NULL DEFAULT 'twitter',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS amplifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_tweet_id TEXT NOT NULL,
      creator_handle TEXT,
      creator_id TEXT,
      our_tweet_id TEXT,
      comment_text TEXT,
      amplification_type TEXT DEFAULT 'quote_tweet',
      platform TEXT NOT NULL DEFAULT 'twitter',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_posts_tweet_id ON posts(tweet_id);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_replies_post_id ON replies(post_id);
    CREATE INDEX IF NOT EXISTS idx_replies_original ON replies(original_tweet_id);
    CREATE INDEX IF NOT EXISTS idx_engagements_target ON engagements(target_tweet_id);
    CREATE INDEX IF NOT EXISTS idx_amplifications_creator ON amplifications(creator_handle);
  `);
}

// ── Post tracking ──

export function savePost(
  tweetId: string,
  content: string,
  contentType = "post",
  platform = "twitter",
  strategyContext?: string | null
): number {
  const conn = getDb();
  const result = conn
    .prepare(
      `INSERT INTO posts (tweet_id, content, content_type, platform, strategy_context)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(tweetId, content, contentType, platform, strategyContext ?? null);
  return result.lastInsertRowid as number;
}

export function getPostByTweetId(tweetId: string): Record<string, unknown> | null {
  const conn = getDb();
  const row = conn.prepare("SELECT * FROM posts WHERE tweet_id = ?").get(tweetId) as any;
  return row || null;
}

export function getRecentPosts(limit = 20, contentType?: string): Record<string, unknown>[] {
  const conn = getDb();
  if (contentType) {
    return conn
      .prepare("SELECT * FROM posts WHERE content_type = ? ORDER BY created_at DESC LIMIT ?")
      .all(contentType, limit) as any[];
  }
  return conn
    .prepare("SELECT * FROM posts ORDER BY created_at DESC LIMIT ?")
    .all(limit) as any[];
}

// ── Reply tracking ──

export function saveReply(
  tweetId: string,
  originalTweetId: string,
  replyText: string,
  originalText?: string | null,
  authorId?: string | null,
  postId?: number | null,
  platform = "twitter"
): number {
  const conn = getDb();
  const result = conn
    .prepare(
      `INSERT INTO replies (tweet_id, original_tweet_id, reply_text, original_text, author_id, post_id, platform)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(tweetId, originalTweetId, replyText, originalText ?? null, authorId ?? null, postId ?? null, platform);
  return result.lastInsertRowid as number;
}

export function getRepliesForPost(postTweetId: string): Record<string, unknown>[] {
  const conn = getDb();
  const post = conn.prepare("SELECT id FROM posts WHERE tweet_id = ?").get(postTweetId) as any;
  if (!post) return [];
  return conn
    .prepare("SELECT * FROM replies WHERE post_id = ? ORDER BY created_at DESC")
    .all(post.id) as any[];
}

export function getRepliedTweetIds(hours = 48): Set<string> {
  const conn = getDb();
  const rows = conn
    .prepare(
      `SELECT original_tweet_id FROM replies
       WHERE created_at > datetime('now', ? || ' hours')`
    )
    .all(`-${hours}`) as any[];
  return new Set(rows.map((r: any) => r.original_tweet_id).filter(Boolean));
}

// ── Engagement tracking ──

export function saveEngagement(
  actionType: string,
  targetTweetId?: string | null,
  targetAuthorId?: string | null,
  targetAuthorHandle?: string | null,
  content?: string | null,
  keywordMatched?: string | null,
  platform = "twitter"
): number {
  const conn = getDb();
  const result = conn
    .prepare(
      `INSERT INTO engagements (action_type, target_tweet_id, target_author_id,
       target_author_handle, content, keyword_matched, platform)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(actionType, targetTweetId ?? null, targetAuthorId ?? null,
         targetAuthorHandle ?? null, content ?? null, keywordMatched ?? null, platform);
  return result.lastInsertRowid as number;
}

export function getEngagedTweetIds(hours = 24): Set<string> {
  const conn = getDb();
  const rows = conn
    .prepare(
      `SELECT target_tweet_id FROM engagements
       WHERE created_at > datetime('now', ? || ' hours')`
    )
    .all(`-${hours}`) as any[];
  return new Set(rows.map((r: any) => r.target_tweet_id).filter(Boolean));
}

// ── Amplification tracking ──

export function saveAmplification(
  originalTweetId: string,
  ourTweetId?: string | null,
  creatorHandle?: string | null,
  creatorId?: string | null,
  commentText?: string | null,
  amplificationType = "quote_tweet",
  platform = "twitter"
): number {
  const conn = getDb();
  const result = conn
    .prepare(
      `INSERT INTO amplifications (original_tweet_id, our_tweet_id, creator_handle,
       creator_id, comment_text, amplification_type, platform)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(originalTweetId, ourTweetId ?? null, creatorHandle ?? null,
         creatorId ?? null, commentText ?? null, amplificationType, platform);
  return result.lastInsertRowid as number;
}

export function getAmplifiedCreators(days = 30): Record<string, unknown>[] {
  const conn = getDb();
  return conn
    .prepare(
      `SELECT creator_handle, COUNT(*) as times_amplified, MAX(created_at) as last_amplified
       FROM amplifications
       WHERE created_at > datetime('now', ? || ' days')
       GROUP BY creator_handle ORDER BY times_amplified DESC`
    )
    .all(`-${days}`) as any[];
}

// ── Content deduplication ──

export function isDuplicateContent(content: string, hours = 48): boolean {
  const conn = getDb();
  const row = conn
    .prepare(
      `SELECT id FROM posts
       WHERE content = ? AND created_at > datetime('now', ? || ' hours')`
    )
    .get(content, `-${hours}`);
  return row !== undefined;
}

export function wasTweetAmplified(tweetId: string): boolean {
  const conn = getDb();
  const row = conn
    .prepare("SELECT id FROM amplifications WHERE original_tweet_id = ?")
    .get(tweetId);
  return row !== undefined;
}

// ── Statistics ──

export function getDailyStats(): Record<string, number> {
  const conn = getDb();
  const today = new Date().toISOString().split("T")[0];

  const postsCount = (conn.prepare("SELECT COUNT(*) as c FROM posts WHERE date(created_at) = ?").get(today) as any).c;
  const repliesCount = (conn.prepare("SELECT COUNT(*) as c FROM replies WHERE date(created_at) = ?").get(today) as any).c;
  const engagementsCount = (conn.prepare("SELECT COUNT(*) as c FROM engagements WHERE date(created_at) = ?").get(today) as any).c;
  const amplificationsCount = (conn.prepare("SELECT COUNT(*) as c FROM amplifications WHERE date(created_at) = ?").get(today) as any).c;

  return {
    posts_today: postsCount,
    replies_today: repliesCount,
    engagements_today: engagementsCount,
    amplifications_today: amplificationsCount,
  };
}

// Initialize DB on module load
initDb();
