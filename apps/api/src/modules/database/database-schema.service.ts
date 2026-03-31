import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import { Pool } from 'pg'

const schemaSql = `
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user) THEN
      -- noop
    END IF;
  END $$;

  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New Session',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_url TEXT,
    original_filename TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
    ON document_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

  CREATE TABLE IF NOT EXISTS rag_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    top_k INTEGER NOT NULL DEFAULT 5,
    similarity_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.82,
    chunk_size INTEGER NOT NULL DEFAULT 800,
    chunk_overlap INTEGER NOT NULL DEFAULT 120,
    chunk_strategy TEXT NOT NULL DEFAULT 'semantic',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`

const migrateSql = `
  ALTER TABLE documents ADD COLUMN IF NOT EXISTS byte_length INTEGER;
  ALTER TABLE documents ADD COLUMN IF NOT EXISTS text_chars INTEGER;
  ALTER TABLE documents ADD COLUMN IF NOT EXISTS parsed_chunk_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE rag_configs ADD COLUMN IF NOT EXISTS chunk_strategy TEXT NOT NULL DEFAULT 'semantic';

  CREATE TABLE IF NOT EXISTS market_agents (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    rating DOUBLE PRECISION NOT NULL DEFAULT 4.5,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    icon_key TEXT NOT NULL DEFAULT 'smart_toy',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_featured BOOLEAN NOT NULL DEFAULT false,
    welcome_hint TEXT,
    suggested_model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS market_agents_category_idx ON market_agents (category);
  CREATE INDEX IF NOT EXISTS market_agents_sort_idx ON market_agents (sort_order);

  CREATE TABLE IF NOT EXISTS user_market_agent_pins (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES market_agents(id) ON DELETE CASCADE,
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, agent_id)
  );

  INSERT INTO market_agents (id, category, name, description, rating, tags, icon_key, sort_order, is_featured, welcome_hint, suggested_model) VALUES
  (
    'agent-analytics',
    '数据分析',
    '数据洞察专家',
    '从指标与明细中提炼趋势与异常，输出结构化结论与可执行建议，适配经营看板与复盘场景。',
    4.9,
    '["趋势预测","异常检测","多维分析"]'::jsonb,
    'query_stats',
    10,
    true,
    '请基于当前业务数据视角：先用 3 条要点总结「现状与风险」，再给出下周可落地的 2～3 个动作建议。',
    'gpt-4o'
  ),
  (
    'agent-growth',
    '业务增长',
    '增长策略师',
    '围绕获客、激活、留存与转化，结合漏斗与分层思路拆解问题并给出实验优先级。',
    4.8,
    '["用户分层","竞品对标","投放优化"]'::jsonb,
    'trending_up',
    20,
    true,
    '请帮我梳理当前增长瓶颈：先定义核心指标与漏斗环节，再给出一组可验证的增长假设与实验排序。',
    'gpt-4o'
  ),
  (
    'agent-infra',
    '技术支持',
    '运维哨兵',
    '面向稳定性与可观测性，协助定位告警、容量与变更风险，并给出排障与预防检查清单。',
    4.7,
    '["健康监控","故障预测","变更风险"]'::jsonb,
    'dns',
    30,
    false,
    '请根据我描述的告警/现象，给出分步排障路径、需要采集的关键信息，以及临时缓解与根因排查建议。',
    'gpt-4o-mini'
  ),
  (
    'agent-content',
    '内容创作',
    '内容策划官',
    '生成与润色多场景文案：活动页、邮件、社媒与对内通报，保持品牌语气一致与信息密度平衡。',
    4.8,
    '["多版本改写","信息提炼","标题与大纲"]'::jsonb,
    'edit_note',
    40,
    false,
    '请按「目标受众 + 渠道 + 语气」先确认写作约束，再输出一版主文案与一版更简短的备选。',
    'gpt-4o-mini'
  ),
  (
    'agent-legal-lite',
    '合规辅助',
    '合规速览助手',
    '将政策与条款要点转写为内部可读的 checklist 与问答口径（不构成法律意见，需人工复核）。',
    4.6,
    '["要点提取","风险清单","FAQ 口径"]'::jsonb,
    'gavel',
    50,
    false,
    '请把下列材料整理为：① 关键义务与期限 ② 禁止项清单 ③ 面向业务同事的 FAQ 口径（注明需法务复核处）。',
    'gpt-4o'
  ),
  (
    'agent-curator',
    '知识协同',
    '知识策展人',
    '与知识库/对话结合，帮助整理专题、引用依据并控制幻觉：先列要点再附可追溯的表述方式。',
    4.9,
    '["知识专题","引用规范","问答结构"]'::jsonb,
    'menu_book',
    5,
    true,
    '请结合知识库与上下文：先给出结论，再用条目列出依据要点；若资料不足请明确说明缺口。',
    'gpt-4o'
  )
  ON CONFLICT (id) DO NOTHING;

  ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
  CREATE INDEX IF NOT EXISTS chat_sessions_user_active_idx
    ON chat_sessions (user_id, updated_at DESC)
    WHERE archived_at IS NULL;
`

@Injectable()
export class DatabaseSchemaService implements OnModuleInit {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async onModuleInit() {
    await this.pool.query(schemaSql)
    await this.pool.query(migrateSql)
  }
}

