import 'dotenv/config';
import { DataSanitizer } from './core/sanitizer.js';
import { MongoIngestor } from './core/ingestor.js';

async function main() {
  const mongoUri = process.env.MONGO_URI ?? 'mongodb://localhost:27019';
  const dbName = process.env.MONGO_DB_NAME ?? 'tcc_rag_db';
  const interactionsCol = process.env.MONGO_INTERACTIONS_COLLECTION ?? 'interactions';
  const usersCol = process.env.MONGO_USERS_COLLECTION ?? 'users';
  const outputDir = process.env.OUTPUT_DIR ?? './data/sanitized';

  console.log('[Etapa 1] Iniciando Ingestão e Sanitização LGPD...');
  const sanitizer = new DataSanitizer();
  const ingestor = new MongoIngestor(mongoUri, sanitizer);

  const summary = await ingestor.runPipeline(
    dbName,
    interactionsCol,
    usersCol,
    outputDir
  );

  console.table(summary);
  console.log(`[Etapa 1] Concluída! Arquivos salvos em: ${outputDir}`);
}

main().catch((err) => {
  console.error('[Erro Fatal na Etapa 1]:', err);
  process.exit(1);
});