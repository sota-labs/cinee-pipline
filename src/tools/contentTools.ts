/** Content Generation and Curation Tools — ported from content_tools.py. */

export interface ContentIdea {
  topic: string;
  contentType: string;
  angle: string;
  priority: string;
}

export function generateContentIdeas(topics: string[], count = 5): ContentIdea[] {
  const contentTypes = ["insight", "story", "lesson", "observation", "question", "hot_take"];
  const ideas: ContentIdea[] = [];

  for (let i = 0; i < Math.min(topics.length, count); i++) {
    ideas.push({
      topic: topics[i],
      contentType: contentTypes[i % contentTypes.length],
      angle: `Share a unique perspective on ${topics[i]}`,
      priority: i < 2 ? "high" : "medium",
    });
  }
  return ideas;
}

export function optimizePostingTime(contentType = "general"): Record<string, unknown> {
  const optimalTimes: Record<string, string> = {
    morning: "09:00",
    midday: "12:00",
    afternoon: "15:00",
    evening: "18:00",
  };

  const contentTimeMap: Record<string, string> = {
    insight: "morning",
    hot_take: "midday",
    story: "afternoon",
    question: "evening",
  };

  const recommendedSlot = contentTimeMap[contentType] || "morning";

  return {
    recommended_time: optimalTimes[recommendedSlot],
    recommended_slot: recommendedSlot,
    all_optimal_times: optimalTimes,
    timezone: "UTC+07:00",
  };
}

export function calculateCharacterCount(text: string): Record<string, unknown> {
  const charCount = text.length;
  const twitterLimit = 280;

  return {
    character_count: charCount,
    limit: twitterLimit,
    remaining: twitterLimit - charCount,
    is_valid: charCount <= twitterLimit,
    needs_trimming: charCount > twitterLimit,
  };
}

export function extractHashtags(text: string): string[] {
  return text.split(/\s+/).filter((word) => word.startsWith("#"));
}

export function suggestHashtags(topic: string, count = 3): string[] {
  const commonHashtags: Record<string, string[]> = {
    leadership: ["#Leadership", "#LeadershipTips", "#Leader"],
    innovation: ["#Innovation", "#FutureOfWork", "#TechTrends"],
    business: ["#Business", "#Entrepreneur", "#Startup"],
    strategy: ["#Strategy", "#BusinessStrategy", "#Growth"],
    team: ["#TeamBuilding", "#Teamwork", "#PeopleFirst"],
    growth: ["#GrowthMindset", "#Success", "#PersonalDevelopment"],
  };

  const topicLower = topic.toLowerCase();
  for (const [key, tags] of Object.entries(commonHashtags)) {
    if (topicLower.includes(key)) {
      return tags.slice(0, count);
    }
  }
  return ["#Leadership", "#Business", "#Innovation"].slice(0, count);
}

export function formatTweet(
  content: string,
  hashtags?: string[],
  mention?: string
): string {
  const parts: string[] = [];

  if (mention) parts.push(mention);
  parts.push(content);
  if (hashtags?.length) parts.push(hashtags.join(" "));

  let tweet = parts.join(" ");

  if (tweet.length > 280) {
    const hashtagStr = hashtags?.join(" ") || "";
    const mentionStr = mention || "";
    const available = 280 - hashtagStr.length - mentionStr.length - 1;
    tweet = content.slice(0, available) + " " + hashtagStr;
  }

  return tweet;
}

export function analyzeSentiment(text: string): Record<string, unknown> {
  const positiveWords = ["great", "excellent", "amazing", "wonderful", "love", "best", "success", "growth"];
  const negativeWords = ["bad", "terrible", "awful", "hate", "worst", "fail", "problem", "issue"];

  const textLower = text.toLowerCase();

  const positiveCount = positiveWords.filter((w) => textLower.includes(w)).length;
  const negativeCount = negativeWords.filter((w) => textLower.includes(w)).length;

  let sentiment: string;
  let score: number;

  if (positiveCount > negativeCount) {
    sentiment = "positive";
    score = 0.7 + positiveCount * 0.05;
  } else if (negativeCount > positiveCount) {
    sentiment = "negative";
    score = 0.3 - negativeCount * 0.05;
  } else {
    sentiment = "neutral";
    score = 0.5;
  }

  return {
    sentiment,
    score: Math.min(Math.max(score, 0), 1),
    positive_indicators: positiveCount,
    negative_indicators: negativeCount,
  };
}
