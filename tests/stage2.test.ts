import { describe, it, expect } from 'vitest';
import { BehavioralAuditor } from '../src/auditors/BehavioralAuditor.js';
import { CorpusCoverageAuditor } from '../src/auditors/CorpusCoverageAuditor.js';
import { SanitizedInteraction, SanitizedUser } from '../src/core/sanitizer.js';
import { SemanticDeduplicator } from '../src/auditors/SemanticDeduplicator.js';

describe('Etapa 2: Auditoria Comportamental e de Corpus', () => {
  const mockUser: SanitizedUser = {
    _id: '692e4916bdf814e683fd03dd',
    user_id: 'user_abcdef1234567890',
    created_at: new Date('2025-12-02T00:00:00.000Z'),
    last_interaction: new Date('2025-12-11T00:00:00.000Z'),
    message_count: 100,
    session_id: 'sess-1',
    user_role: 'aluno',
  };

  const mockInteractions: SanitizedInteraction[] = [
    {
      _id: '1',
      interaction_id: 'uuid-1',
      session_id: 'sess-1',
      user_id: 'user_abcdef1234567890',
      timestamp: new Date('2025-12-03T14:30:00.000Z'),
      user_prompt: 'Qual o horário?',
      bot_response: 'Das 7h às 22h.',
      retrieved_sources: [
        { file_name: 'Campus-Formosa.pdf', page_label: '1' },
        { file_name: 'Campus-Formosa.pdf', page_label: '1' },
        { file_name: 'Campus-Formosa.pdf', page_label: '2' },
      ],
      evaluation_metrics: {
        total_rag_time: 4000, // 4 segundos
        retrieval_time: 500,
        synthesis_time: 3500,
        faithfulness: 1,
        relevancy: 1,
        coverage: 1,
      },
      feedback_requested: false,
      pii_redacted_count: 0,
    },
    {
      _id: '2',
      interaction_id: 'uuid-2',
      session_id: 'sess-1',
      user_id: 'user_abcdef1234567890',
      timestamp: new Date('2025-12-03T14:30:02.000Z'), // Apenas 2s após (rag time anterior foi 4s -> delta negativo / rajada)
      user_prompt: 'Qual o horário de novo?',
      bot_response: 'Das 7h às 22h.',
      retrieved_sources: [
        { file_name: 'Campus-Formosa.pdf', page_label: '1' },
      ],
      evaluation_metrics: {
        total_rag_time: 1000,
        retrieval_time: 200,
        synthesis_time: 800,
        faithfulness: 1,
        relevancy: 1,
        coverage: 1,
      },
      feedback_requested: false,
      pii_redacted_count: 0,
    },
  ];

  it('deve calcular fator de amortecimento de power-user u_i = 1 / sqrt(n_u)', () => {
    const auditor = new BehavioralAuditor([mockUser]);
    const results = auditor.auditInteractions(mockInteractions);

    expect(results[0].user_weight_factor).toBe(Number((1 / Math.sqrt(100)).toFixed(4))); // 0.1
    expect(results[1].is_synthetic_burst).toBe(true);
  });

  it('deve calcular redundância intra-query e entropia do corpus corretamente', () => {
    const corpusAuditor = new CorpusCoverageAuditor();
    const report = corpusAuditor.auditCorpus(mockInteractions);

    expect(report.totalInteractionsEvaluated).toBe(2);
    expect(report.averageIntraQueryRedundancy).toBe(2); // Na primeira query, 3 chunks vieram do mesmo arquivo
    expect(report.corpusEntropy).toBeGreaterThanOrEqual(0);
  });

  it('deve indexar vetores no LanceDB e penalizar perguntas semanticamente repetidas (d_i)', async () => {
    // Mock determinístico: retorna vetores quase idênticos para perguntas sobre "horário"
    const mockEmbedder = async (text: string): Promise<number[]> => {
      if (text.toLowerCase().includes('horário') || text.toLowerCase().includes('abre')) {
        return [0.99, 0.01, 0.0, 0.0];
      }
      return [0.0, 0.0, 0.99, 0.01]; // Assunto totalmente diferente
    };

    const deduplicator = new SemanticDeduplicator(
      './data/lancedb_test',
      './data/cache/test_embeddings.json',
      mockEmbedder
    );

    const results = await deduplicator.processDeduplication([
      {
        interaction_id: 'q1',
        user_id: 'user_1',
        user_prompt: 'Qual o horário do IFG?',
        timestamp: new Date('2025-12-03T10:00:00Z'),
      },
      {
        interaction_id: 'q2',
        user_id: 'user_1',
        user_prompt: 'Que horas abre o campus?', // Paráfrase da q1
        timestamp: new Date('2025-12-03T10:05:00Z'),
      },
      {
        interaction_id: 'q3',
        user_id: 'user_2',
        user_prompt: 'Como faço matrícula em ADS?', // Tema inédito
        timestamp: new Date('2025-12-03T10:10:00Z'),
      },
    ], 1.2);

    // q1 foi a primeira pergunta sobre horário -> k_i = 0, d_i = 1.0
    expect(results.get('q1')?.similar_previous_count).toBe(0);
    expect(results.get('q1')?.decay_factor).toBe(1);

    // q2 repetiu semanticamente q1 -> k_i = 1, d_i = exp(-1.2 * 1) = 0.3012
    expect(results.get('q2')?.similar_previous_count).toBe(1);
    expect(results.get('q2')?.same_user_similar_count).toBe(1);
    expect(results.get('q2')?.decay_factor).toBeCloseTo(Math.exp(-1.2), 3);

    // q3 é de outro assunto -> k_i = 0, d_i = 1.0
    expect(results.get('q3')?.similar_previous_count).toBe(0);
    expect(results.get('q3')?.decay_factor).toBe(1);
  });
});