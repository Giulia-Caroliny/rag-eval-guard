import { SanitizedInteraction } from '../core/sanitizer.js';

export interface CorpusAuditReport {
  totalInteractionsEvaluated: number;
  averageIntraQueryRedundancy: number; // Média de repetição do mesmo file_name no Top-8
  corpusEntropy: number;               // Entropia de Shannon da distribuição de arquivos recuperados
  fileDistribution: Record<string, number>;
}

export class CorpusCoverageAuditor {
  /**
   * Calcula a entropia de Shannon e redundância de corpus a partir de retrieved_sources
   */
  public auditCorpus(interactions: SanitizedInteraction[]): CorpusAuditReport {
    let totalRedundancySum = 0;
    const globalFileCounts: Record<string, number> = {};
    let totalRetrievedChunksCount = 0;

    for (const item of interactions) {
      const sources = item.retrieved_sources ?? [];
      if (sources.length === 0) continue;

      const fileCountsInQuery: Record<string, number> = {};
      for (const src of sources) {
        const name = src.file_name || 'unknown.pdf';
        fileCountsInQuery[name] = (fileCountsInQuery[name] || 0) + 1;
        globalFileCounts[name] = (globalFileCounts[name] || 0) + 1;
        totalRetrievedChunksCount += 1;
      }

      // Redundância intra-query: quantos chunks duplicados do mesmo arquivo vieram no Top-8
      let maxChunksForSingleFile = 0;
      for (const count of Object.values(fileCountsInQuery)) {
        if (count > maxChunksForSingleFile) {
          maxChunksForSingleFile = count;
        }
      }
      totalRedundancySum += maxChunksForSingleFile;
    }

    const n = interactions.length || 1;
    const averageIntraQueryRedundancy = Number((totalRedundancySum / n).toFixed(2));

    // Cálculo da Entropia de Shannon H(X) = - sum( p(x) * log2(p(x)) )
    let entropy = 0;
    if (totalRetrievedChunksCount > 0) {
      for (const count of Object.values(globalFileCounts)) {
        const p = count / totalRetrievedChunksCount;
        if (p > 0) {
          entropy -= p * Math.log2(p);
        }
      }
    }

    return {
      totalInteractionsEvaluated: interactions.length,
      averageIntraQueryRedundancy,
      corpusEntropy: Number(entropy.toFixed(3)),
      fileDistribution: globalFileCounts,
    };
  }
}