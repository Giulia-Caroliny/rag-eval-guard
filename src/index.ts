import 'dotenv/config';
import { DataSanitizer } from './core/sanitizer.js';
import { MongoIngestor } from './core/ingestor.js';
import { Stage2Orchestrator } from './core/stage2Runner.js';

async function main() {
  const mongoUri = process.env.MONGO_URI ?? 'mongodb://mongodb-dump:27017';
  const dbName = process.env.MONGO_DB_NAME ?? 'tcc_rag_db';
  const interactionsCol = process.env.MONGO_INTERACTIONS_COLLECTION ?? 'interactions';
  const usersCol = process.env.MONGO_USERS_COLLECTION ?? 'users';
  const sanitizedDir = process.env.OUTPUT_DIR ?? './data/sanitized';
  const auditedDir = './data/audited';

  console.log('\n=== [Etapa 1] Ingestão e Sanitização LGPD ===');
  const sanitizer = new DataSanitizer();
  const ingestor = new MongoIngestor(mongoUri, sanitizer);
  const stage1Summary = await ingestor.runPipeline(
    dbName,
    interactionsCol,
    usersCol,
    sanitizedDir
  );
  console.table(stage1Summary);

  if (stage1Summary.validInteractions === 0) {
    console.warn('[Aviso] Nenhuma interação encontrada no MongoDB. Pulando Etapa 2.');
    return;
  }

  console.log('\n=== [Etapa 2] Auditoria Comportamental, LanceDB e Corpus ===');
  const stage2 = new Stage2Orchestrator();
  const stage2Summary = await stage2.run(sanitizedDir, auditedDir);
  console.table(stage2Summary);
  console.log(`[Concluído] Resultados da Etapa 2 salvos em: ${auditedDir}`);
}

main().catch((err) => {
  console.error('[Erro Fatal no Pipeline]:', err);
  process.exit(1);
});