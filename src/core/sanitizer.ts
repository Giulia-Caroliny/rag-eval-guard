import { createHmac } from 'node:crypto';
import { RawInteraction, RawUser } from '../schemas/mongo.schema.js';

export interface SanitizedInteraction extends Omit<RawInteraction, 'user_id'> {
  user_id: string; // Hash determinístico HMAC-SHA256 (ex: user_a1b2c3...)
  pii_redacted_count: number;
}

export interface SanitizedUser extends Omit<RawUser, 'user_id'> {
  user_id: string;
}

export class DataSanitizer {
  private readonly salt: string;

  // Expressões regulares ordenadas por especificidade para evitar falso-positivo entre números
  private static readonly EMAIL_REGEX =
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

  private static readonly WHATSAPP_JID_REGEX =
    /\b\d{10,15}@c\.us\b/gi;

  // CPF formatado (000.000.000-00)
  private static readonly FORMATTED_CPF_REGEX =
    /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g;

  // Matrícula SUAP/IFG (sequências numéricas de 12 a 14 dígitos isoladas)
  private static readonly MATRICULA_REGEX =
    /\b\d{12,14}\b/g;

  // Telefones brasileiros com ou sem DDI +55 e DDD (ex: (61) 99273-2430, +55 61 992732430)
  private static readonly PHONE_REGEX =
    /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)(?:9?\d{4}[-\s]?\d{4})\b/g;

  // CPF sem formatação (exatamente 11 dígitos não precedidos por '+' e que não sejam telefone celular com 9)
  private static readonly UNFORMATTED_CPF_REGEX =
    /\b\d{11}\b/g;

  constructor(salt?: string) {
    const resolvedSalt = salt ?? process.env.AUDIT_SALT;
    if (!resolvedSalt || resolvedSalt.trim().length < 12) {
      throw new Error(
        'AUDIT_SALT ausente ou muito curto. Defina uma chave com pelo menos 12 caracteres.'
      );
    }
    this.salt = resolvedSalt;
  }

  /**
   * Converte um user_id (ex: '556199273243@c.us') em um hash determinístico HMAC-SHA256.
   * Mantém o agrupamento estatístico do mesmo usuário sem expor o telefone.
   */
  public hashUserId(rawUserId: string): string {
    const normalized = rawUserId.trim().toLowerCase();
    const digest = createHmac('sha256', this.salt)
      .update(normalized)
      .digest('hex')
      .slice(0, 24);
    return `user_${digest}`;
  }

  /**
   * Remove PII de textos livres (user_prompt e bot_response) e contabiliza quantas ocorrências foram mascaradas.
   */
  public redactText(text: string): { cleanText: string; redactions: number } {
    let redactions = 0;
    let cleanText = text;

    const applyMask = (regex: RegExp, mask: string) => {
      cleanText = cleanText.replace(regex, () => {
        redactions += 1;
        return mask;
      });
    };

    // 1. WhatsApp IDs explícitos no texto (antes do e-mail pois contém '@c.us')
    applyMask(DataSanitizer.WHATSAPP_JID_REGEX, '[PHONE_REDACTED]');

    // 2. E-mails
    applyMask(DataSanitizer.EMAIL_REGEX, '[EMAIL_REDACTED]');

    // 3. CPFs formatados (000.000.000-00)
    applyMask(DataSanitizer.FORMATTED_CPF_REGEX, '[CPF_REDACTED]');

    // 4. Matrículas longas (12 a 14 dígitos)
    applyMask(DataSanitizer.MATRICULA_REGEX, '[MATRICULA_REDACTED]');

    // 5. Telefones formatados ou com espaços/hífens
    applyMask(DataSanitizer.PHONE_REGEX, '[PHONE_REDACTED]');

    // 6. Sequências de 11 dígitos remanescentes (CPF sem pontuação)
    applyMask(DataSanitizer.UNFORMATTED_CPF_REGEX, '[CPF_REDACTED]');

    return { cleanText, redactions };
  }

  /**
   * Sanitiza um documento de interação completo validado pelo Zod.
   */
  public sanitizeInteraction(interaction: RawInteraction): SanitizedInteraction {
    const promptResult = this.redactText(interaction.user_prompt);
    const responseResult = this.redactText(interaction.bot_response);

    return {
      ...interaction,
      user_id: this.hashUserId(interaction.user_id),
      user_prompt: promptResult.cleanText,
      bot_response: responseResult.cleanText,
      pii_redacted_count: promptResult.redactions + responseResult.redactions,
    };
  }

  /**
   * Sanitiza um documento de usuário completo validado pelo Zod.
   */
  public sanitizeUser(user: RawUser): SanitizedUser {
    return {
      ...user,
      user_id: this.hashUserId(user.user_id),
    };
  }
}