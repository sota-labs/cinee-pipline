import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { KolStyleService } from '../kol/kol-style.service';
import { KOL_CONSTANTS } from '../common/constants/kol.constants';

export interface TopComment {
  author_handle: string;
  content: string;
  likes: number;
  replies: number;
}

export interface SentimentResult {
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  positive_pct: number;
  neutral_pct: number;
  negative_pct: number;
  trend_summary: string;
}

export interface CommentCandidate {
  content: string;
  alignment: 'positive' | 'neutral' | 'negative';
  rationale: string;
}

export interface ProcessingResult {
  summary: string;
  sentiment: SentimentResult;
  candidates: CommentCandidate[];
}

@Injectable()
export class AiProcessingService {
  private readonly logger = new Logger(AiProcessingService.name);
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  constructor(private readonly kolStyleService: KolStyleService) {}

  // Step 1: Summarize post content
  async summarizePost(content: string): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Summarize this X.com post in 1-2 sentences. Be concise and factual.',
        },
        { role: 'user', content },
      ],
      max_tokens: 100,
    });
    return response.choices[0].message.content?.trim() ?? '';
  }

  // Step 2: Analyze crowd sentiment from top comments
  async analyzeSentiment(comments: TopComment[]): Promise<SentimentResult> {
    if (!comments.length) {
      return {
        sentiment: 'neutral',
        positive_pct: 0,
        neutral_pct: 100,
        negative_pct: 0,
        trend_summary: 'No comments to analyze.',
      };
    }

    const commentsText = comments
      .map((c, i) => `[${i + 1}] @${c.author_handle}: ${c.content}`)
      .join('\n');

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Analyze these ${comments.length} comments and return ONLY valid JSON:
{
  "sentiment": "positive" | "negative" | "neutral" | "mixed",
  "positive_pct": <0-100>,
  "neutral_pct": <0-100>,
  "negative_pct": <0-100>,
  "trend_summary": "<1 sentence describing the crowd mood>"
}
The pcts must sum to 100.`,
        },
        { role: 'user', content: commentsText },
      ],
      max_tokens: 200,
    });

    const raw = response.choices[0].message.content ?? '{}';
    const parsed = JSON.parse(raw) as SentimentResult;
    return parsed;
  }

  // Step 3: Generate comment candidates using KOL persona + few-shot examples
  async generateCandidates(
    postContent: string,
    postSummary: string,
    sentiment: SentimentResult,
    kol: {
      id: string;
      styleSummary: string;
      personalityNotes: string;
      slangVocab: string[];
    },
  ): Promise<CommentCandidate[]> {
    // Fetch top-3 similar past comments as few-shot examples
    const fewShots = await this.kolStyleService.findSimilarExamples(kol.id, postContent, 3);

    const fewShotBlock = fewShots.length
      ? `\nFEW-SHOT EXAMPLES (past comments that resonated with this audience):\n${fewShots.map((f, i) => `[${i + 1}] "${f.content}"`).join('\n')}`
      : '';

    const slangNote = kol.slangVocab.length
      ? `\nAudience slang/vocab to optionally use: ${kol.slangVocab.slice(0, 10).join(', ')}`
      : '';

    const systemPrompt = `You are crafting comments for an X.com account that engages with posts from the following KOL:

KOL Writing Style: ${kol.styleSummary || 'Not yet analyzed'}
KOL Personality: ${kol.personalityNotes || 'Not yet analyzed'}${slangNote}${fewShotBlock}

Crowd Sentiment: ${sentiment.trend_summary} (${sentiment.positive_pct}% positive, ${sentiment.neutral_pct}% neutral, ${sentiment.negative_pct}% negative)

Rules:
- DO NOT copy the KOL's writing style — you are a different account engaging with their content
- DO understand their audience and what resonates with them
- Write naturally, like a real person — no corporate tone
- Each candidate should have a clearly different angle
- Keep each comment under 240 characters
- Return ONLY valid JSON array`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Post summary: ${postSummary}\n\nGenerate exactly ${KOL_CONSTANTS.COMMENT_CANDIDATE_COUNT} comment candidates as JSON:
{
  "candidates": [
    { "content": "...", "alignment": "positive"|"neutral"|"negative", "rationale": "why this works" },
    ...
  ]
}`,
        },
      ],
      max_tokens: 500,
    });

    const raw = response.choices[0].message.content ?? '{"candidates":[]}';
    const parsed = JSON.parse(raw) as { candidates: CommentCandidate[] };
    return parsed.candidates.slice(0, KOL_CONSTANTS.COMMENT_CANDIDATE_COUNT);
  }

  // Selects the candidate whose alignment best matches the dominant sentiment
  selectAfkCandidate(candidates: CommentCandidate[], sentiment: SentimentResult): CommentCandidate {
    const dominant = sentiment.sentiment === 'mixed' ? 'positive' : sentiment.sentiment;
    const match = candidates.find((c) => c.alignment === dominant);
    // Fallback to first candidate if no exact alignment match
    return match ?? candidates[0];
  }

  // Full pipeline: summarize → sentiment → candidates
  async runPipeline(
    postContent: string,
    topComments: TopComment[],
    kol: { id: string; styleSummary: string; personalityNotes: string; slangVocab: string[] },
  ): Promise<ProcessingResult> {
    this.logger.log(`Running AI pipeline for KOL ${kol.id}`);

    const [summary, sentiment] = await Promise.all([
      this.summarizePost(postContent),
      this.analyzeSentiment(topComments),
    ]);

    const candidates = await this.generateCandidates(postContent, summary, sentiment, kol);

    return { summary, sentiment, candidates };
  }
}
