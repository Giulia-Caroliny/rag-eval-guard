import { MongoClient } from 'mongodb';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  RawInteractionSchema,
  RawUserSchema,
} from '../schemas/mongo.schema.js';
import {
  DataSanitizer,
  SanitizedInteraction,
  SanitizedUser,
} from './sanitizer.js';

export interface IngestionSummary {
  totalInteractionsRead: number;
  validInteractions: number;
  invalidInteractions: number;
  totalUsersRead: number;
  validUsers: number;
  totalPiiRedactions: number;
}

export class MongoIngestor {
  private client: MongoClient;
  private sanitizer: DataSanitizer;

  constructor(mongoUri: string, sanitizer: DataSanitizer) {
    this.client = new MongoClient(mongoUri);
    this.sanitizer = sanitizer;
  }

  public async runPipeline(
    dbName: string,
    interactionsColName: string,
    usersColName: string,
    outputDir: string
  ): Promise<IngestionSummary> {
    await this.client.connect();

    try {
      const db = this.client.db(dbName);
      const rawInteractions = await db.collection(interactionsColName).find({}).toArray();
      const rawUsers = await db.collection(usersColName).find({}).toArray();

      const sanitizedInteractions: SanitizedInteraction[] = [];
      const sanitizedUsers: SanitizedUser[] = [];
      let invalidInteractions = 0;
      let totalPiiRedactions = 0;

      for (const doc of rawInteractions) {
        const parsed = RawInteractionSchema.safeParse(doc);
        if (!parsed.success) {
          invalidInteractions += 1;
          console.warn(
            `[Zod Warning] Interação ignorada (_id: ${String(doc._id)}):`,
            parsed.error.flatten().fieldErrors
          );
          continue;
        }
        const cleanDoc = this.sanitizer.sanitizeInteraction(parsed.data);
        totalPiiRedactions += cleanDoc.pii_redacted_count;
        sanitizedInteractions.push(cleanDoc);
      }

      for (const userDoc of rawUsers) {
        const parsed = RawUserSchema.safeParse(userDoc);
        if (parsed.success) {
          sanitizedUsers.push(this.sanitizer.sanitizeUser(parsed.data));
        }
      }

      await mkdir(outputDir, { recursive: true });

      const interactionsJsonl = sanitizedInteractions
        .map((item) => JSON.stringify(item))
        .join('\n');
      const usersJsonl = sanitizedUsers
        .map((item) => JSON.stringify(item))
        .join('\n');

      await writeFile(join(outputDir, 'interactions.sanitized.jsonl'), interactionsJsonl, 'utf-8');
      await writeFile(join(outputDir, 'users.sanitized.jsonl'), usersJsonl, 'utf-8');

      return {
        totalInteractionsRead: rawInteractions.length,
        validInteractions: sanitizedInteractions.length,
        invalidInteractions,
        totalUsersRead: rawUsers.length,
        validUsers: sanitizedUsers.length,
        totalPiiRedactions,
      };
    } finally {
      await this.client.close();
    }
  }
}