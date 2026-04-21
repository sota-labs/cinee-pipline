import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';

interface StyleLearnResult {
  style_summary: string;
  personality_notes: string;
  slang_vocab: string[];
}

interface FewShotExample {
  content: string;
  similarity: number;
}

@Injectable()
export class KolStyleService {
  private readonly logger = new Logger(KolStyleService.name);
  private readonly openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  constructor(private readonly prisma: PrismaService) {}

  async analyzeStyle(kolId: string, samples: string[]): Promise<StyleLearnResult> {
    if (samples.length < 3) {
      return { style_summary: '', personality_notes: '', slang_vocab: [] };
    }

    const joined = samples.slice(0, 50).map((s, i) => `[${i + 1}] ${s}`).join('\n\n');

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Analyze these posts and return JSON with:
{
  "style_summary": "1-2 sentence description of writing style, sentence length, punctuation habits",
  "personality_notes": "tone, stance, recurring themes, what topics they care about",
  "slang_vocab": ["array", "of", "signature", "words", "or", "phrases"]
}`,
        },
        { role: 'user', content: `Analyze these ${samples.length} posts:\n\n${joined}` },
      ],
    });

    const raw = response.choices[0].message.content ?? '{}';
    const result = JSON.parse(raw) as StyleLearnResult;
    this.logger.log(`Style analysis complete for KOL ${kolId}: ${result.slang_vocab.length} slang terms`);
    return result;
  }

  async storeEmbedding(kolId: string, content: string, postedAt: Date): Promise<void> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: content,
    });

    await this.prisma.kolEmbedding.create({
      data: {
        kolId,
        content,
        embedding: response.data[0].embedding,
        postedAt,
      },
    });
  }

  async findSimilarExamples(kolId: string, queryText: string, topK = 3): Promise<FewShotExample[]> {
    const queryResponse = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: queryText,
    });
    const queryVec = queryResponse.data[0].embedding;

    const embeddings = await this.prisma.kolEmbedding.findMany({
      where: { kolId },
      select: { content: true, embedding: true },
      orderBy: { createdAt: 'desc' },
      take: 200, // scan recent 200 for similarity
    });

    const scored = embeddings.map((e) => ({
      content: e.content,
      similarity: this.cosineSimilarity(queryVec, e.embedding),
    }));

    return scored.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] ** 2;
      normB += b[i] ** 2;
    }
    return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

