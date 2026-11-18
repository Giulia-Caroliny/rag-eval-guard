import { GoogleGenAI } from '@google/genai';
import * as lancedb from '@lancedb/lancedb';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface DeduplicationResult {
  interaction_id: string;
  similar_previous_count: number; // k_i (total de perguntas anteriores similares)
  same_user_similar_count: number; // quantas dessas vieram do mesmo user_id
  decay_factor: number;           // d_i = exp(-lambda * k_i)
}

export type DeduplicationMap = Map<string, DeduplicationResult>;

export type EmbedderFn = (text: string) => Promise<number[]>;

export class SemanticDeduplicator {
  private dbPath: string;
  private cacheFilePath: string;
  private embeddingModel = 'gemini-embedding-001';
  private customEmbedder?: EmbedderFn;
  private ai?: GoogleGenAI;
  private memoryCache: Record<string, number[]> = {};

  constructor(
    dbPath = './data/lancedb',
    cacheFilePath = './data/cache/embeddings.json',
    customEmbedder?: EmbedderFn
  ) {
    this.dbPath = dbPath;
    this.cacheFilePath = cacheFilePath;
    this.customEmbedder = customEmbedder;

    if (!this.customEmbedder) {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new Error('Defina GEMINI_API_KEY no arquivo .env para gerar embeddings.');
      }
      this.ai = new GoogleGenAI({ apiKey });
    }
  }

  private async loadCache(): Promise<void> {
    if (existsSync(this.cacheFilePath)) {
      const raw = await readFile(this.cacheFilePath, 'utf-8');
      this.memoryCache = JSON.parse(raw);
    }
  }

  private async saveCache(): Promise<void> {
    await mkdir(dirname(this.cacheFilePath), { recursive: true });
    await writeFile(this.cacheFilePath, JSON.stringify(this.memoryCache), 'utf-8');
  }

  private hashPrompt(text: string): string {
    return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
  }

  /**
   * Obtém o embedding do cache local ou chama o modelo gemini-embedding-001
   */
  private async getEmbedding(text: string): Promise<number[]> {
    if (this.customEmbedder) {
      return this.customEmbedder(text);
    }

    const key = this.hashPrompt(text);
    if (this.memoryCache[key]) {
      return this.memoryCache[key];
    }

    const response = await this.ai!.models.embedContent({
      model: this.embeddingModel,
      contents: text,
    });

    const values = response.embeddings?.[0]?.values;
    if (!values || values.length === 0) {
      throw new Error(`Falha ao gerar embedding para: "${text.slice(0, 40)}..."`);
    }

    this.memoryCache[key] = values;
    return values;
  }

  /**
   * Indexa os prompts no LanceDB e calcula k_i e d_i = exp(-lambda * k_i)
   */
  public async processDeduplication(
    interactions: {
      interaction_id: string;
      user_id: string;
      user_prompt: string;
      timestamp: Date | string;
    }[],
    lambda = 1.2,
    similarityThreshold = 0.88
  ): Promise<DeduplicationMap> {
    const results: DeduplicationMap = new Map();
    if (interactions.length === 0) return results;

    await mkdir(this.dbPath, { recursive: true });
    if (!this.customEmbedder) {
      await this.loadCache();
    }

    // 1. Ordena cronologicamente para garantir que só olhamos para o passado
    const sorted = [...interactions].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const records: {
      id: string;
      user_id: string;
      vector: number[];
      text: string;
      timestamp_ms: number;
      seq_idx: number;
    }[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i];
      const vector = await this.getEmbedding(item.user_prompt);
      records.push({
        id: item.interaction_id,
        user_id: item.user_id,
        vector,
        text: item.user_prompt,
        timestamp_ms: new Date(item.timestamp).getTime(),
        seq_idx: i, // Desempata perguntas feitas no mesmo milissegundo
      });
    }

    if (!this.customEmbedder) {
      await this.saveCache();
    }

    // 2. Cria a tabela vetorial no LanceDB
    const db = await lancedb.connect(this.dbPath);
    const tableName = 'rag_prompts_index';
    const existingTables = await db.tableNames();
    if (existingTables.includes(tableName)) {
      await db.dropTable(tableName);
    }

    const table = await db.createTable(tableName, records);

    // 3. Para cada interação, busca perguntas anteriores semanticamente repetidas
    for (const record of records) {
      if (record.seq_idx === 0) {
        results.set(record.id, {
          interaction_id: record.id,
          similar_previous_count: 0,
          same_user_similar_count: 0,
          decay_factor: 1.0,
        });
        continue;
      }

      const neighbors = await table
        .vectorSearch(record.vector)
        .distanceType('cosine')
        .where(`seq_idx < ${record.seq_idx}`)
        .limit(50)
        .toArray();

      let similarCount = 0;
      let sameUserCount = 0;

      for (const neighbor of neighbors) {
        // Na distância de cosseno do LanceDB: distance = 1 - cosine_similarity
        const distance = typeof neighbor._distance === 'number' ? neighbor._distance : 1;
        const similarity = 1 - distance;

        if (similarity >= similarityThreshold) {
          similarCount += 1;
          if (neighbor.user_id === record.user_id) {
            sameUserCount += 1;
          }
        }
      }

      const decayFactor = Math.exp(-lambda * similarCount);

      results.set(record.id, {
        interaction_id: record.id,
        similar_previous_count: similarCount,
        same_user_similar_count: sameUserCount,
        decay_factor: Number(decayFactor.toFixed(4)),
      });
    }

    return results;
  }
}