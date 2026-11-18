import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SanitizedInteraction, SanitizedUser } from './sanitizer.js';
import { BehavioralAuditor, BehavioralAuditResult } from '../auditors/BehavioralAuditor.js';
import { SemanticDeduplicator, DeduplicationResult } from '../auditors/SemanticDeduplicator.js';
import { CorpusCoverageAuditor, CorpusAuditReport } from '../auditors/CorpusCoverageAuditor.js';

export interface Stage2AuditedInteraction extends BehavioralAuditResult {
  similar_previous_count: number;
  same_user_similar_count: number;
  decay_factor: number; // d_i
}

export interface Stage2Summary {
  totalAudited: number;
  syntheticBurstsDetected: number;
  semanticallyRedundantPrompts: number;
  averageIntraQueryRedundancy: number;
  corpusEntropy: number;
}

export class Stage2Orchestrator {
  public async run(
    sanitizedDir = './data/sanitized',
    auditedOutputDir = './data/audited'
  ): Promise<Stage2Summary> {
    const interactionsRaw = await readFile(
      join(sanitizedDir, 'interactions.sanitized.jsonl'),
      'utf-8'
    );
    const usersRaw = await readFile(
      join(sanitizedDir, 'users.sanitized.jsonl'),
      'utf-8'
    );

    const interactions: SanitizedInteraction[] = interactionsRaw
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));

    const users: SanitizedUser[] = usersRaw
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line));

    // 1. Auditoria Comportamental (Bursts e Power-Users)
    const behavioralAuditor = new BehavioralAuditor(users);
    const behavioralResults = behavioralAuditor.auditInteractions(interactions);

    // 2. Desduplicação Semântica no LanceDB
    const deduplicator = new SemanticDeduplicator();
    const dedupMap: Map<string, DeduplicationResult> =
      await deduplicator.processDeduplication(interactions);

    // 3. Auditoria de Cobertura de PDFs (Entropia e Redundância)
    const corpusAuditor = new CorpusCoverageAuditor();
    const corpusReport: CorpusAuditReport = corpusAuditor.auditCorpus(interactions);

    // 4. Consolida todos os pesos da Etapa 2 por interação
    const stage2Interactions: Stage2AuditedInteraction[] = behavioralResults.map((item) => {
      const dedup = dedupMap.get(item.interaction_id) ?? {
        interaction_id: item.interaction_id,
        similar_previous_count: 0,
        same_user_similar_count: 0,
        decay_factor: 1.0,
      };

      return {
        ...item,
        similar_previous_count: dedup.similar_previous_count,
        same_user_similar_count: dedup.same_user_similar_count,
        decay_factor: dedup.decay_factor,
      };
    });

    await mkdir(auditedOutputDir, { recursive: true });
    await writeFile(
      join(auditedOutputDir, 'interactions.stage2.jsonl'),
      stage2Interactions.map((i) => JSON.stringify(i)).join('\n'),
      'utf-8'
    );
    await writeFile(
      join(auditedOutputDir, 'corpus_report.json'),
      JSON.stringify(corpusReport, null, 2),
      'utf-8'
    );

    return {
      totalAudited: stage2Interactions.length,
      syntheticBurstsDetected: stage2Interactions.filter((i) => i.is_synthetic_burst).length,
      semanticallyRedundantPrompts: stage2Interactions.filter(
        (i) => i.similar_previous_count > 0
      ).length,
      averageIntraQueryRedundancy: corpusReport.averageIntraQueryRedundancy,
      corpusEntropy: corpusReport.corpusEntropy,
    };
  }
}