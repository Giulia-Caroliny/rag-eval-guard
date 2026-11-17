import { z } from 'zod';

/**
 * Converte ObjectId do BSON, Extended JSON ({ $oid }) ou string para string hexadecimal
 */
const bsonObjectId = z.preprocess((val: unknown) => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') {
    if ('$oid' in val && typeof (val as { $oid: unknown }).$oid === 'string') {
      return (val as { $oid: string }).$oid;
    }
    if ('toHexString' in val && typeof (val as { toHexString: () => string }).toHexString === 'function') {
      return (val as { toHexString: () => string }).toHexString();
    }
  }
  return String(val ?? '');
}, z.string().min(1, 'O _id do documento é obrigatório'));

/**
 * Converte Double e NumberInt (Int32) do BSON ou Extended JSON para number nativo do JS
 */
const bsonNumber = z.preprocess((val: unknown) => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && val.trim() !== '') return Number(val);
  if (val && typeof val === 'object') {
    if ('value' in val && typeof (val as { value: unknown }).value === 'number') {
      return (val as { value: number }).value;
    }
    if ('$numberDouble' in val) return Number((val as { $numberDouble: string }).$numberDouble);
    if ('$numberInt' in val) return Number((val as { $numberInt: string }).$numberInt);
    if ('valueOf' in val && typeof val.valueOf === 'function') {
      const primitive = val.valueOf();
      if (typeof primitive === 'number') return primitive;
    }
  }
  return val;
}, z.number({ invalid_type_error: 'Valor numérico BSON inválido' }));

/**
 * Converte ISODate do BSON, Date ou string ISO para objeto Date validado
 */
const bsonDate = z.preprocess((val: unknown) => {
  if (val instanceof Date) return val;
  if (typeof val === 'string' || typeof val === 'number') return new Date(val);
  if (val && typeof val === 'object' && '$date' in val) {
    return new Date((val as { $date: string | number }).$date);
  }
  return val;
}, z.date({ invalid_type_error: 'Data ISODate inválida' }));

/**
 * Validador estrito para métricas de avaliação RAG no intervalo [0, 1]
 */
const unitMetricScore = bsonNumber.pipe(
  z.number()
    .min(0, 'A métrica de avaliação não pode ser menor que 0')
    .max(1, 'A métrica de avaliação não pode ser maior que 1')
);

export const RetrievedSourceSchema = z.object({
  file_name: z.string().min(1, 'Nome do arquivo fonte não pode ser vazio'),
  page_label: z.string().nullable().default('N/A'),
});

export const EvaluationMetricsSchema = z.object({
  total_rag_time: bsonNumber.pipe(z.number().nonnegative()),
  retrieval_time: bsonNumber.pipe(z.number().nonnegative()),
  synthesis_time: bsonNumber.pipe(z.number().nonnegative()),
  faithfulness: unitMetricScore,
  relevancy: unitMetricScore,
  coverage: unitMetricScore,
});

export const RawInteractionSchema = z.object({
  _id: bsonObjectId,
  interaction_id: z.string().uuid('interaction_id deve ser um UUID válido'),
  session_id: z.string().uuid('session_id deve ser um UUID válido'),
  user_id: z.string().min(1, 'user_id é obrigatório'),
  timestamp: bsonDate,
  user_prompt: z.string().min(1, 'user_prompt não pode estar vazio'),
  bot_response: z.string().min(1, 'bot_response não pode estar vazio'),
  retrieved_sources: z.array(RetrievedSourceSchema).default([]),
  evaluation_metrics: EvaluationMetricsSchema,
  feedback_requested: z.boolean().default(false),
  feedback_rating: bsonNumber.nullable().optional().default(null),
  feedback_timestamp: bsonDate.nullable().optional().default(null),
});

export const RawUserSchema = z.object({
  _id: bsonObjectId,
  user_id: z.string().min(1, 'user_id é obrigatório'),
  created_at: bsonDate,
  last_interaction: bsonDate,
  message_count: bsonNumber.pipe(
    z.number().int('message_count deve ser inteiro').nonnegative()
  ),
  session_id: z.string().min(1),
  user_role: z.string().default('aluno'),
});

export type RawInteraction = z.infer<typeof RawInteractionSchema>;
export type RawUser = z.infer<typeof RawUserSchema>;