import { describe, it, expect } from 'vitest';
import { RawInteractionSchema, RawUserSchema } from '../src/schemas/mongo.schema.js';
import { DataSanitizer } from '../src/core/sanitizer.js';

describe('Etapa 1: Contratos Zod e Sanitização LGPD', () => {
  const salt = 'chave-secreta-de-teste-auditoria-2026';
  const sanitizer = new DataSanitizer(salt);

  const sampleInteractionBson = {
    _id: { $oid: '69304980c065bab7d0dc8719' },
    interaction_id: 'f2979237-23f1-4ab1-8a2c-b9214aefb800',
    session_id: 'f2447b2a-1419-4de1-914b-17f17b8b1cf6',
    user_id: '556199273243@c.us',
    timestamp: { $date: '2025-12-03T14:30:24.371Z' },
    user_prompt:
      'Olá, meu CPF é 123.456.789-00, matrícula 20221080080012 e email aluno@ifg.edu.br. Qual horário de funcionamento do ifg?',
    bot_response:
      'O IFG/Câmpus Formosa é aberto de segunda a sexta-feira. Contato: (61) 99273-2430.',
    retrieved_sources: [
      { file_name: 'Apresentação-Campus-Formosa.pdf', page_label: 'N/A' },
    ],
    evaluation_metrics: {
      total_rag_time: { $numberDouble: '6629.808187484741' },
      retrieval_time: { $numberDouble: '604.682445526123' },
      synthesis_time: { $numberDouble: '6025.125741958618' },
      faithfulness: { $numberDouble: '1' },
      relevancy: { $numberDouble: '1' },
      coverage: { $numberDouble: '1' },
    },
    feedback_requested: true,
    feedback_rating: null,
    feedback_timestamp: null,
  };

  it('deve converter tipos BSON (ObjectId, ISODate, Double, NumberInt) corretamente no Zod', () => {
    const parsedInteraction = RawInteractionSchema.parse(sampleInteractionBson);
    expect(parsedInteraction._id).toBe('69304980c065bab7d0dc8719');
    expect(parsedInteraction.timestamp).toBeInstanceOf(Date);
    expect(parsedInteraction.evaluation_metrics.faithfulness).toBe(1);

    const parsedUser = RawUserSchema.parse({
      _id: { $oid: '692e4916bdf814e683fd03dd' },
      user_id: '556199273243@c.us',
      created_at: '2025-12-02T02:02:33.060Z',
      last_interaction: '2025-12-11T22:00:47.553Z',
      message_count: { $numberInt: '1154' },
      session_id: '5990a6ec-9505-4390-9115-b1ab3b324642',
      user_role: 'aluno',
    });

    expect(parsedUser.message_count).toBe(1154);
  });

  it('deve rejeitar métricas de avaliação fora do intervalo entre 0 e 1', () => {
    const invalidDoc = {
      ...sampleInteractionBson,
      evaluation_metrics: {
        ...sampleInteractionBson.evaluation_metrics,
        faithfulness: 1.5, // Inválido (maior que 1)
      },
    };

    const result = RawInteractionSchema.safeParse(invalidDoc);
    expect(result.success).toBe(false);
  });

  it('deve gerar hash HMAC-SHA256 determinístico para o mesmo user_id sem expor o telefone', () => {
    const hash1 = sanitizer.hashUserId('556199273243@c.us');
    const hash2 = sanitizer.hashUserId('  556199273243@C.US ');

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^user_[a-f0-9]{24}$/);
    expect(hash1).not.toContain('556199273243');
  });

  it('deve mascarar CPF, matrícula, e-mail e telefone em user_prompt e bot_response', () => {
    const parsed = RawInteractionSchema.parse(sampleInteractionBson);
    const sanitized = sanitizer.sanitizeInteraction(parsed);

    expect(sanitized.user_prompt).toContain('[CPF_REDACTED]');
    expect(sanitized.user_prompt).toContain('[MATRICULA_REDACTED]');
    expect(sanitized.user_prompt).toContain('[EMAIL_REDACTED]');
    expect(sanitized.bot_response).toContain('[PHONE_REDACTED]');
    expect(sanitized.pii_redacted_count).toBe(4);
  });
});