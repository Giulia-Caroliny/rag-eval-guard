import { SanitizedInteraction, SanitizedUser } from '../core/sanitizer.js';

export interface BehavioralAuditResult extends SanitizedInteraction {
  is_synthetic_burst: boolean;
  human_reading_delta_seconds: number;
  user_message_count: number;
  user_weight_factor: u_i; // u_i = 1 / sqrt(n_u)
}

export type u_i = number;

export class BehavioralAuditor {
  private userMessageCounts: Map<string, number> = new Map();

  constructor(users: SanitizedUser[]) {
    // Mapeia o total de mensagens por user_id estruturado na base
    for (const u of users) {
      this.userMessageCounts.set(u.user_id, u.message_count);
    }
  }

  /**
   * Ordena interações por timestamp e analisa padrões comportamentais por usuário
   */
  public auditInteractions(interactions: SanitizedInteraction[]): BehavioralAuditResult[] {
    // Agrupa por user_id para ordenar cronologicamente
    const byUser = new Map<string, SanitizedInteraction[]>();
    for (const item of interactions) {
      const list = byUser.get(item.user_id) ?? [];
      list.push(item);
      byUser.set(item.user_id, list);
    }

    const auditedResults: BehavioralAuditResult[] = [];

    for (const [userId, userInteractions] of byUser.entries()) {
      // Ordena por timestamp crescente
      userInteractions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Fallback para contagem de mensagens caso o usuário não esteja na collection 'users'
      const totalMessages = this.userMessageCounts.get(userId) ?? userInteractions.length;
      const userWeightFactor = 1 / Math.sqrt(Math.max(totalMessages, 1));

      for (let i = 0; i < userInteractions.length; i++) {
        const current = userInteractions[i];
        let humanReadingDelta = 0;
        let isSyntheticBurst = false;

        if (i > 0) {
          const previous = userInteractions[i - 1];
          const tCurrent = new Date(current.timestamp).getTime();
          const tPrevious = new Date(previous.timestamp).getTime();
          
          const totalElapsedSeconds = (tCurrent - tPrevious) / 1000;
          const previousRagTimeSeconds = previous.evaluation_metrics.total_rag_time / 1000;

          // Delta de leitura humana líquida
          humanReadingDelta = totalElapsedSeconds - previousRagTimeSeconds;

          // Se a resposta anterior foi longa (> 5s de processamento) e o usuário mandou outra
          // em menos de 5 segundos, é fisicamente improvável que tenha lido (rajada artificial)
          if (previousRagTimeSeconds > 2.0 && humanReadingDelta < 5.0) {
            isSyntheticBurst = true;
          }
        }

        auditedResults.push({
          ...current,
          is_synthetic_burst: isSyntheticBurst,
          human_reading_delta_seconds: Number(humanReadingDelta.toFixed(2)),
          user_message_count: totalMessages,
          user_weight_factor: Number(userWeightFactor.toFixed(4)),
        });
      }
    }

    return auditedResults;
  }
}