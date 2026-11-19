# 🛡️ RAG-EvalGuard: Statistical & Semantic Auditor for RAG Databases

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22_LTS-339933?logo=nodedotjs&logoColor=white)
![MongoDB](https://img.shields.io/badge/Database-MongoDB_7.0-47A248?logo=mongodb&logoColor=white)
![LanceDB](https://img.shields.io/badge/Vector_DB-LanceDB-FF6B6B)
![Google GenAI](https://img.shields.io/badge/Embeddings-Gemini_Embedding_001-4285F4?logo=google&logoColor=white)
![Hugging Face](https://img.shields.io/badge/Model_&_Dataset-Hugging_Face_ONNX-FFD21E?logo=huggingface&logoColor=black)
![Zod](https://img.shields.io/badge/Schema-Zod-3E67B1)
![Vitest](https://img.shields.io/badge/Tests-Vitest-6E9F18?logo=vitest&logoColor=white)
![Docker](https://img.shields.io/badge/Container-Docker-2496ED?logo=docker&logoColor=white)

Motor de auditoria estatística, comportamental e semântica para detecção de **Viés de Amostragem (*Sampling Bias*)**, inflação por **Power-Users**, desduplicação vetorial com **LanceDB** e recálculo ponderado de métricas em avaliações automatizadas de sistemas RAG (*LLM-as-a-Judge*).

---

## 🎯 Contexto e Problema de Engenharia

Sistemas modernos de *Retrieval-Augmented Generation (RAG)* dependem fortemente de juízes automatizados (*LLM-as-a-Judge*) para mensurar métricas de **Faithfulness**, **Answer Relevancy** e **Context Coverage**. No entanto, ao avaliar logs de produção ou bases de validação acadêmicas, a média aritmética simples dessas métricas sofre severamente com a **Lei de Goodhart** (*"Quando uma medida se torna uma meta, ela deixa de ser uma boa medida"*), apresentando três vulnerabilidades críticas:

1. **Inflação por *Power-Users* e Rajadas Sintéticas (*Synthetic Bursting*):** Um único usuário ou avaliador realizando mais de 1.000 interações em poucos dias — frequentemente disparando novas perguntas em menos de 5 segundos após respostas longas (sem tempo físico de leitura humana) — domina a distribuição estatística do banco e mascara a experiência real da cauda longa de usuários.
2. **Saturação por Redundância Semântica e Queries Triviais:** Perguntas puramente extrativas de fato único (ex: *"Qual o horário de funcionamento do campus?"*) repetidas dezenas de vezes com pequenas variações de escrita recebem score máximo (`1.0`), inflando a acurácia global para >98\% enquanto falhas graves em perguntas **Multi-Hop** (cruzamento de múltiplos editais/regulamentos) ficam ocultas na média.
3. **Baixa Entropia do Corpus e Exposição de Dados Sensíveis (LGPD):** Avaliações aparentes de alta cobertura frequentemente testam apenas uma fração mínima dos documentos indexados (alta repetição intra-query do mesmo PDF em `retrieved_sources`), além de armazenarem identificadores reais de WhatsApp (`@c.us`), CPFs e matrículas acadêmicas em texto aberto nos logs no Dataset.

### A Solução

O **RAG-EvalGuard** atua como um pipeline de auditoria e governança que ingere coleções brutas do **MongoDB**, valida contratos BSON via **Zod**, anonimiza dados pessoais em conformidade com a **LGPD**, indexa o histórico de interações no **LanceDB** e recalcula o desempenho real do chatbot através do **De-biased RAG Score** (<b>S<sub>audit</sub></b>):

<div align="center">
  <img src="https://latex.codecogs.com/svg.image?{\color{White}S_{\mathrm{audit}}=\frac{\sum_{i=1}^{N}(c_i\cdot&space;d_i\cdot&space;u_i)\cdot&space;M_i}{\sum_{i=1}^{N}(c_i\cdot&space;d_i\cdot&space;u_i)}}" alt="De-biased RAG Score Equation" />
</div>

- **Sanitização Determinística (LGPD):** Aplica hash criptográfico `HMAC-SHA256` com *salt* sobre os identificadores de usuário (preservando o agrupamento comportamental sem expor telefones) e remove PII via pipeline de expressões regulares (`[CPF_REDACTED]`, `[MATRICULA_REDACTED]`, `[EMAIL_REDACTED]`).
- **Amortecimento Comportamental (u<sub>i</sub>) e Burst Detection:** Identifica inserções artificiais calculando o tempo líquido de leitura humana (<b>&Delta;t<sub>humano</sub> = &Delta;t<sub>total</sub> &minus; t<sub>rag</sub></b>) e aplica amortecimento raiz-quadrada (<b>u<sub>i</sub> = 1 / &radic;n<sub>u</sub></b>) sobre usuários hiperativos.
- **Decaimento por Similaridade Semântica (d<sub>i</sub>):** Utiliza embeddings densos (`gemini-embedding-001`) e busca vetorial histórica no **LanceDB** (`timestamp < t_i`) para penalizar exponencialmente (<b>d<sub>i</sub> = e<sup>&minus;&lambda;&middot;k<sub>i</sub></sup></b>) perguntas com similaridade de cosseno <b>&ge; 0.88</b>.
- **Ponderação por Complexidade RAG (c<sub>i</sub>):** Classifica localmente cada query em 4 níveis de exigência cognitiva/recuperação (*Extrativa Direta*, *Síntese Intra-Documento*, *Multi-Hop Condicional* e *Adversarial/Fora de Escopo*) via modelo **BERTimbau** ajustado (*fine-tuned*) e exportado para **ONNX Runtime**.

---

## 🏗️ Arquitetura do Sistema

![Fluxo_sistema](./src/img/Fluxo%20sistema.jpeg)

---

## ⚙️ Decisões de Engenharia e Trade-offs

| Desafio Técnico | Decisão Arquitetural | Impacto Prático em Produção |
| :--- | :--- | :--- |
| **Conformidade LGPD vs. Rastreabilidade de Sessão** | **Hashing `HMAC-SHA256` Determinístico com Salt + Regex em Cascata:** Substituição do JID do WhatsApp (`5561...@c.us`) por um digest criptográfico de 24 caracteres precedido pela ordenação de Regex por especificidade (JID → E-mail → CPF → Matrícula 12-14 dígitos → Telefone). | Permite auditar a curva de concentração por usuário e publicar o dataset aberto no Hugging Face com zero exposição de dados pessoais e sem colisão entre números de matrícula e telefones. |
| **Detecção de Paráfrases e Repetição** (O(N²) para ANN) | **Busca Vetorial Temporal no LanceDB:** Indexação local dos prompts com filtro estrito de janela temporal (`timestamp < record.timestamp`) e decaimento exponencial d<sub>i</sub> = e<sup>&minus;&lambda;&middot;k<sub>i</sub></sup> para vizinhos com similaridade &ge; 0.88. | Preserva o peso integral (d<sub>i</sub> = 1.0) da primeira ocorrência legítima de uma dúvida e reduz progressivamente a influência de repetições posteriores, mesmo quando reescritas com sinônimos. |
| **Inferência de Deep Learning em Runtime Node.js/TS** | **Ponte ONNX (`@huggingface/transformers`):** Isolamento do ajuste fino (*fine-tuning*) do `BERTimbau` em PyTorch com exportação para grafo **ONNX quantizado** consumido nativamente pelo container Node.js. | Elimina a necessidade de manter microsserviços Python em produção, executando a classificação de complexidade RAG em milissegundos diretamente em TypeScript. |
| **Tipagem BSON Heterogênea e Binários Nativos no Docker** | **Zod Preprocessors + Multi-stage `node:22-bookworm-slim`:** Conversão transparente de primitivos do WiredTiger (`Double`, `NumberInt`, `ObjectId`) aliada ao uso de imagem Debian (`glibc`) e mapeamento de UID `999:999` para volumes `.wt`. | Compatibilidade nativa com os bindings em Rust/C++ do `@lancedb/lancedb` e `onnxruntime-node`, garantindo execução determinística da suíte `Vitest` dentro do container. |

---

## 📊 Avaliação Quantitativa e Diagnóstico da Base (RAG Audit Benchmark)

A tabela abaixo sumariza as métricas extraídas e auditadas pelo pipeline sobre a base de interações do chatbot institucional universitário, contrastando a avaliação aparente original com os indicadores comportamentais e semânticos de qualidade:

### Resumo Global da Auditoria (Versão: 1.0.0)

| Métrica / Indicador de Auditoria | Tipo de Avaliação | Score Bruto (Sem Filtro) | Resultado Auditado | Meta de Confiabilidade | Descrição Técnica |
| :--- | :--- | :---: | :---: | :---: | :--- |
| <b>Global RAG Score (S<sub>audit</sub>)</b> | Ponderação Multi-Fator (c<sub>i</sub> &middot; d<sub>i</sub> &middot; u<sub>i</sub>) | 98.2% | *Em consolidação* | >= 85.0% | Média global das métricas de avaliação corrigida por complexidade, redundância e concentração de usuário. |
| **Faithfulness (Fidelidade)** | LLM-as-a-Judge Ponderado | 98.6% | *Em consolidação* | >= 90.0% | Grau de ancoragem factual da resposta nos documentos recuperados após remoção do viés de perguntas repetidas. |
| **Answer Relevancy (Relevância)** | LLM-as-a-Judge Ponderado | 98.2% | *Em consolidação* | >= 85.0% | Aderência direta da síntese à pergunta original ponderada pelo nível de dificuldade da query. |
| **Context Coverage (Cobertura)** | LLM-as-a-Judge Ponderado | 97.8% | *Em consolidação* | >= 80.0% | Suficiência dos chunks recuperados para responder perguntas compostas e condicionais (*Multi-Hop*). |
| **Top Power-User Concentration** | Telemetria Comportamental | 1.154 msgs | *Em consolidação* | &le; 10.0% da base | Peso individual amortecido via 1 / &radic;n<sub>u</sub> para neutralizar a concentração de 128 mensagens/dia de um único usuário. |
| **Intra-Query Chunk Redundancy** | Determinístico (Top-8 Retrieval) | 4.00 chunks | *Em consolidação* | <= 2.00 chunks | Repetição média do mesmo `file_name` dentro de uma única busca Top-8 (ex: 4 cópias do mesmo PDF). |
| <b>Corpus Shannon Entropy (H(X))</b> | Teoria da Informação (Bits) | Calculado via CLI | *Em consolidação* | >= 3.50 bits | Diversidade efetiva de documentos PDF da instituição utilizados nas respostas do RAG. |
| **PII Sanitization Coverage** | Determinístico (LGPD Compliance) | 0.0% | 100.0% | 100.0% | Taxa de anonimização de identificadores `@c.us`, CPFs, matrículas e telefones nos arquivos exportados. |

#### 🔍 Análise Preliminar de Viés e Anomalias Detectadas

- <b>Assinatura de <i>Power-User</i> e Diluição Estatística:</b> A inspeção dos metadados revelou usuários individuais com até <b>1.154 interações registradas em uma janela de 9 dias</b> (&asymp; 128 queries/dia). Sem o fator de amortecimento u<sub>i</sub> = 1 / &radic;n<sub>u</sub>, um único número de telefone detém peso equivalente a mais de cem alunos reais que fizeram 10 perguntas cada.
- **Redundância no Mecanismo de Retrieval (`Intra-Query Redundancy`):** A análise de `retrieved_sources` identificou consultas em que 4 dos 8 chunks retornados pertenciam ao mesmo arquivo (`Apresentação-Campus-Formosa.pdf`) e 3 pertenciam ao `Calendario-Academico2025.pdf`, ambos com metadado `page_label: 'N/A'`. Isso evidencia a ausência de *Maximum Marginal Relevance (MMR)* ou *Reranking* por diversidade na etapa de busca vetorial do chatbot original.

---

## 🚀 Como Executar o Projeto

### Pré-requisitos
- **Docker** e **Docker Compose** (ou **Node.js 22 LTS** para execução local)
- Chave de API do Google AI Studio (`GEMINI_API_KEY`) para geração de embeddings e *Weak Supervision*
- Token de acesso do Hugging Face (`HF_TOKEN`) para publicação do dataset e consumo do modelo ONNX

### 1. Configuração das Variáveis de Ambiente

Clone o repositório e crie o arquivo `.env` a partir do template:

```bash
cp .env.example .env
```

Edite o arquivo `.env` definindo o seu *salt* criptográfico para a anonimização LGPD e as credenciais de API:

```ini
# Conexão com o MongoDB (aponta para o serviço do Docker ou porta 27018 no host)
MONGO_URI=mongodb://mongodb-dump:27017
MONGO_DB_NAME=tcc_rag_db
MONGO_INTERACTIONS_COLLECTION=interactions
MONGO_USERS_COLLECTION=users

# Chave secreta para geração determinística do HMAC-SHA256 (LGPD)
AUDIT_SALT=troque-por-uma-chave-secreta-forte-2026-ifg

# Diretório de saída dos arquivos anonimizados
OUTPUT_DIR=./data/sanitized

# Chave da API do Google AI Studio (usada no LanceDB e no WeakSupervisor)
GEMINI_API_KEY=sua_chave_aqui
GEMINI_LABELER_MODEL=gemini-3.5-flash-lite

# Configuração do Hugging Face Hub (Token com permissão de WRITE)
HF_TOKEN=hf_seu_token_de_escrita_aqui
HF_DATASET_REPO=seu-usuario-hf/ifg-rag-audit-benchmark
```

### 2. Preparação do Volume MongoDB e Execução via Docker Compose

Caso esteja restaurando os arquivos físicos `.wt` (*WiredTiger*) de um backup do MongoDB, copie os arquivos para `./mongo_data` e ajuste a permissão para o UID padrão do container Mongo (`999:999`):

```bash
mkdir -p mongo_data
sudo chown -R 999:999 mongo_data/
sudo chmod -R a+rX mongo_data/
git rm -r --cached mongo_data/ 2>/dev/null || true
```

Suba os serviços em background:

```bash
docker compose up -d --build
```

### 3. Executando a Suíte de Testes (`Vitest`) e o Pipeline de Auditoria

Como o serviço `audit-engine` permanece ativo em background, você pode disparar os testes unitários e o pipeline diretamente do seu terminal:

```bash
# Executar a suíte de testes automatizados (Etapas 1 e 2)
docker exec -it rag-eval-guard npm test

# Executar o pipeline de Ingestão, Sanitização LGPD e Auditoria Vetorial/Comportamental
docker exec -it rag-eval-guard npm run start
```

Os arquivos anonimizados (`interactions.sanitized.jsonl` e `users.sanitized.jsonl`) e o diagnóstico enriquecido (`interactions.stage2.audited.json`) serão gerados automaticamente no diretório `./data/sanitized`.

---

## 🗺️ Roadmap de Evolução (MLOps & Experimentação)

- [x] **Etapa 1 (Ingestão & Governança LGPD):** Ambiente multi-container Docker (`node:22-bookworm-slim` + `mongo:7`), contratos estritos no `Zod` com coerção BSON e módulo `DataSanitizer` (`HMAC-SHA256` + Regex PII).
- [x] <b>Etapa 2 (Auditoria Comportamental, Vetorial &amp; Corpus):</b> Implementação do <code>BehavioralAuditor</code> (<i>Burst Detection</i> e amortecimento 1 / &radic;n<sub>u</sub>), <code>SemanticDeduplicator</code> com <b>LanceDB</b> e <code>CorpusCoverageAuditor</code> (Entropia de Shannon), validados com <code>Vitest</code>.
- [ ] **Etapa 3 (Weak Supervision & HF Datasets):** Rotulagem automática de complexidade de queries via *Structured Outputs* e publicação programática do benchmark anonimizado no **Hugging Face Datasets** (`@huggingface/hub`).
- [ ] **Etapa 4 (Fine-Tuning BERTimbau & Ponte ONNX):** Ajuste fino do classificador de 4 classes de complexidade RAG, exportação para **ONNX quantizado** e inferência nativa em TypeScript via `@huggingface/transformers`.
- [ ] <b>Etapa 5 (De-biased Score Engine &amp; CI/CD):</b> Consolidação da equação S<sub>audit</sub>, geração automatizada do <code>AUDIT_REPORT.md</code> e workflow de integração contínua no GitHub Actions.