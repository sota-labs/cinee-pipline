/** Cinee-specific tools — ported from cinee_tools.py. */
import { settings } from "../config/settings.js";
import * as twitterTools from "./twitterTools.js";
import * as memoryTools from "./memoryTools.js";

export async function findAiFilmsToAmplify(count = 5): Promise<Record<string, unknown>[]> {
  const searchQueries = [
    "AI film short film",
    "Sora generated film",
    "Kling AI film",
    "Runway Gen-3 film",
    "AI animated short",
  ];

  const results: Record<string, unknown>[] = [];

  for (const query of searchQueries) {
    if (results.length >= count) break;
    const tweets = await twitterTools.searchTweets(query, 5);
    for (const tweet of tweets) {
      if ("error" in tweet) continue;
      const metrics = tweet.public_metrics as Record<string, number> | undefined;
      if (metrics && metrics.like_count >= 5) {
        results.push({
          tweet_id: tweet.tweet_id,
          text: tweet.text,
          author_id: tweet.author_id,
          engagement_score: (metrics.like_count || 0) + (metrics.retweet_count || 0) * 2,
          search_query: query,
        });
      }
    }
  }

  results.sort((a, b) => (b.engagement_score as number) - (a.engagement_score as number));
  return results.slice(0, count);
}

export function draftAmplificationComment(
  filmDescription: string,
  creatorHandle?: string
): string {
  const founderName = settings.role.founderName;
  const templates = [
    `This is incredible work. The way {element} creates {effect} — this is exactly why I believe AI filmmaking is the future. {creator}keep pushing boundaries 🎬`,
    `Wow. Been watching AI films all day and this one stopped me cold. {element} is masterful. {creator}`,
    `As someone building in this space, seeing work like this gets me so excited about where AI filmmaking is heading. {element} — beautiful. {creator}`,
    `I've been following {element} and this is next level. The creative vision here is what sets AI filmmakers apart. {creator}`,
    `This is the kind of work that makes me proud to be building for the AI filmmaking community. {element} is stunning. {creator}`,
  ];

  const template = templates[Math.floor(Math.random() * templates.length)];
  const creatorMention = creatorHandle ? `@${creatorHandle.replace("@", "")} ` : "";

  return template
    .replace("{element}", filmDescription.slice(0, 50))
    .replace("{effect}", "something truly special")
    .replace("{creator}", creatorMention)
    .replace("{founderName}", founderName);
}

export async function findCreatorEngagementOpportunities(
  count = 10
): Promise<Record<string, unknown>[]> {
  const keywords = settings.role.engagementKeywords;
  const results: Record<string, unknown>[] = [];

  for (const keyword of keywords) {
    if (results.length >= count) break;
    const tweets = await twitterTools.searchTweets(keyword, 5);
    for (const tweet of tweets) {
      if ("error" in tweet) continue;
      results.push({
        tweet_id: tweet.tweet_id,
        text: tweet.text,
        author_id: tweet.author_id,
        keyword_matched: keyword,
        engagement_type: "reply",
      });
    }
  }

  return results.slice(0, count);
}

export function generateHotTakeTopics(): Record<string, unknown>[] {
  const topics = [
    {
      topic: "YouTube wasn't built for AI films — and that's exactly why we need new platforms",
      angle: "founder_insight",
      controversy_level: "medium",
    },
    {
      topic: "The tools are ready. The platforms aren't. That's the real bottleneck for AI filmmakers right now",
      angle: "industry_observation",
      controversy_level: "high",
    },
    {
      topic: "AI filmmaking isn't replacing filmmakers — it's creating an entirely new category of creator",
      angle: "defending_creators",
      controversy_level: "medium",
    },
    {
      topic: "Everyone's focused on making AI films. Nobody's focused on distributing them. That needs to change",
      angle: "market_gap",
      controversy_level: "low",
    },
    {
      topic: "The best AI filmmaker I know has zero Hollywood connections. That tells you everything about this revolution",
      angle: "democratization",
      controversy_level: "low",
    },
    {
      topic: "We're 12-18 months away from an AI-generated film winning a major festival. Here's why",
      angle: "prediction",
      controversy_level: "high",
    },
  ];

  return topics;
}

export async function trackAmplifiedCreators(
  creatorHandle: string,
  tweetId: string,
  comment: string
): Promise<Record<string, unknown>> {
  const result = await memoryTools.storeMemory(
    `amplified:${creatorHandle}`,
    comment,
    { tweet_id: tweetId, creator: creatorHandle, type: "amplification" }
  );
  return result;
}

export async function getDailyEngagementTargets(): Promise<Record<string, unknown>> {
  return {
    amplifications: 3,
    replies_to_creators: 10,
    hot_takes: 1,
    reddit_discussions: 5,
    mention_responses: "all",
    target_engagement_rate: 0.05,
    max_tweets_per_day: 15,
    min_time_between_tweets_minutes: 30,
  };
}
