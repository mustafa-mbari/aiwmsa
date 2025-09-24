-- backend/prisma/migrations/search_system_complete.sql
-- Complete Search System Database Schema

-- ============================================
-- 1. EXTENSIONS
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search
CREATE EXTENSION IF NOT EXISTS "btree_gist"; -- For exclusion constraints
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- For query performance monitoring

-- ============================================
-- 2. MAIN TABLES
-- ============================================

-- Search logs table for analytics
CREATE TABLE IF NOT EXISTS search_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  query TEXT NOT NULL,
  query_vector vector(1536), -- Store query embedding for analysis
  results_count INTEGER DEFAULT 0,
  execution_time INTEGER, -- in milliseconds
  filters JSONB,
  language VARCHAR(2) DEFAULT 'en',
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  session_id VARCHAR(255),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for search_logs
CREATE INDEX idx_search_logs_user_id ON search_logs(user_id);
CREATE INDEX idx_search_logs_created_at ON search_logs(created_at DESC);
CREATE INDEX idx_search_logs_department ON search_logs(department_id);
CREATE INDEX idx_search_logs_warehouse ON search_logs(warehouse_id);
CREATE INDEX idx_search_logs_session ON search_logs(session_id);
CREATE INDEX idx_search_logs_query_trgm ON search_logs USING gin (query gin_trgm_ops);
CREATE INDEX idx_search_logs_filters ON search_logs USING gin (filters);

-- Search results feedback
CREATE TABLE IF NOT EXISTS search_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  search_log_id UUID REFERENCES search_logs(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  result_id UUID, -- Reference to specific result
  result_position INTEGER, -- Position in search results
  rating VARCHAR(20) NOT NULL CHECK (rating IN ('helpful', 'not_helpful', 'partially_helpful')),
  clicked BOOLEAN DEFAULT false,
  time_to_click INTEGER, -- milliseconds from search to click
  dwell_time INTEGER, -- milliseconds spent on result
  comment TEXT,
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for search_feedback
CREATE UNIQUE INDEX idx_search_feedback_unique ON search_feedback(search_log_id, user_id, result_id);
CREATE INDEX idx_search_feedback_rating ON search_feedback(rating);
CREATE INDEX idx_search_feedback_clicked ON search_feedback(clicked) WHERE clicked = true;

-- AI conversations for context management
CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255),
  summary TEXT,
  language VARCHAR(2) DEFAULT 'en',
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  context JSONB, -- Store conversation context
  tokens_used INTEGER DEFAULT 0,
  estimated_cost DECIMAL(10, 6) DEFAULT 0,
  message_count INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for ai_conversations
CREATE INDEX idx_ai_conversations_user ON ai_conversations(user_id);
CREATE INDEX idx_ai_conversations_department ON ai_conversations(department_id);
CREATE INDEX idx_ai_conversations_updated ON ai_conversations(updated_at DESC);
CREATE INDEX idx_ai_conversations_active ON ai_conversations(is_active) WHERE is_active = true;

-- AI conversation messages
CREATE TABLE IF NOT EXISTS ai_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'function')),
  content TEXT NOT NULL,
  function_name VARCHAR(100), -- For function calls
  function_args JSONB, -- Function arguments
  metadata JSONB, -- Store tokens used, model, confidence, sources, etc.
  embedding vector(1536), -- Store message embedding for context retrieval
  tokens_used INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for ai_messages
CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id);
CREATE INDEX idx_ai_messages_created ON ai_messages(created_at);
CREATE INDEX idx_ai_messages_role ON ai_messages(role);
CREATE INDEX idx_ai_messages_embedding ON ai_messages USING ivfflat (embedding vector_cosine_ops);

-- Cached embeddings for frequently searched queries
CREATE TABLE IF NOT EXISTS cached_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  text_hash VARCHAR(64) UNIQUE NOT NULL, -- MD5 hash of text
  text TEXT NOT NULL,
  embedding vector(1536), -- OpenAI embedding dimension
  model VARCHAR(50),
  dimensions INTEGER DEFAULT 1536,
  usage_count INTEGER DEFAULT 1,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for cached_embeddings
CREATE INDEX idx_cached_embeddings_hash ON cached_embeddings(text_hash);
CREATE INDEX idx_cached_embeddings_usage ON cached_embeddings(usage_count DESC);
CREATE INDEX idx_cached_embeddings_last_used ON cached_embeddings(last_used_at DESC);
CREATE INDEX idx_cached_embeddings_vector ON cached_embeddings USING ivfflat (embedding vector_cosine_ops);

-- Search suggestions and autocomplete
CREATE TABLE IF NOT EXISTS search_suggestions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  query TEXT NOT NULL,
  normalized_query TEXT NOT NULL, -- Lowercase, trimmed version
  display_text TEXT NOT NULL,
  category VARCHAR(50), -- 'common', 'department', 'equipment', 'safety', 'error_code'
  subcategory VARCHAR(50),
  usage_count INTEGER DEFAULT 0,
  success_rate DECIMAL(5, 2), -- Percentage of searches that led to clicks
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE CASCADE,
  language VARCHAR(2) DEFAULT 'en',
  priority INTEGER DEFAULT 0, -- Higher priority suggestions show first
  is_active BOOLEAN DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for search_suggestions
CREATE UNIQUE INDEX idx_search_suggestions_unique ON search_suggestions(normalized_query, department_id, language);
CREATE INDEX idx_search_suggestions_query ON search_suggestions USING gin (query gin_trgm_ops);
CREATE INDEX idx_search_suggestions_normalized ON search_suggestions USING gin (normalized_query gin_trgm_ops);
CREATE INDEX idx_search_suggestions_category ON search_suggestions(category);
CREATE INDEX idx_search_suggestions_usage ON search_suggestions(usage_count DESC);
CREATE INDEX idx_search_suggestions_priority ON search_suggestions(priority DESC);
CREATE INDEX idx_search_suggestions_active ON search_suggestions(is_active) WHERE is_active = true;

-- Related searches mapping
CREATE TABLE IF NOT EXISTS related_searches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  primary_query TEXT NOT NULL,
  primary_query_normalized TEXT NOT NULL,
  related_query TEXT NOT NULL,
  related_query_normalized TEXT NOT NULL,
  relation_type VARCHAR(50), -- 'synonym', 'broader', 'narrower', 'related'
  relation_score FLOAT DEFAULT 1.0, -- Strength of relationship
  co_occurrence_count INTEGER DEFAULT 1,
  click_through_rate DECIMAL(5, 2),
  language VARCHAR(2) DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for related_searches
CREATE UNIQUE INDEX idx_related_searches_unique ON related_searches(primary_query_normalized, related_query_normalized, language);
CREATE INDEX idx_related_searches_primary ON related_searches(primary_query_normalized);
CREATE INDEX idx_related_searches_related ON related_searches(related_query_normalized);
CREATE INDEX idx_related_searches_score ON related_searches(relation_score DESC);
CREATE INDEX idx_related_searches_type ON related_searches(relation_type);

-- Search sessions for tracking user journey
CREATE TABLE IF NOT EXISTS search_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id VARCHAR(255) UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  search_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  total_dwell_time INTEGER DEFAULT 0, -- milliseconds
  successful BOOLEAN,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  metadata JSONB
);

-- Indexes for search_sessions
CREATE INDEX idx_search_sessions_user ON search_sessions(user_id);
CREATE INDEX idx_search_sessions_started ON search_sessions(started_at DESC);
CREATE INDEX idx_search_sessions_department ON search_sessions(department_id);

-- Query expansion terms (synonyms, abbreviations)
CREATE TABLE IF NOT EXISTS query_expansions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  term TEXT NOT NULL,
  expanded_terms TEXT[] NOT NULL,
  expansion_type VARCHAR(50), -- 'synonym', 'abbreviation', 'typo', 'translation'
  language VARCHAR(2) DEFAULT 'en',
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for query_expansions
CREATE UNIQUE INDEX idx_query_expansions_unique ON query_expansions(term, language, department_id);
CREATE INDEX idx_query_expansions_term ON query_expansions USING gin (term gin_trgm_ops);
CREATE INDEX idx_query_expansions_active ON query_expansions(is_active) WHERE is_active = true;

-- ============================================
-- 3. UPDATE EXISTING TABLES
-- ============================================

-- Update chunks table to add more search-related fields
ALTER TABLE chunks 
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS language VARCHAR(2) DEFAULT 'en',
ADD COLUMN IF NOT EXISTS keywords TEXT[],
ADD COLUMN IF NOT EXISTS entities JSONB, -- Named entities extracted
ADD COLUMN IF NOT EXISTS search_text TEXT, -- Preprocessed text for search
ADD COLUMN IF NOT EXISTS importance_score FLOAT DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS access_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;

-- Add indexes for chunks
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_language ON chunks(language);
CREATE INDEX IF NOT EXISTS idx_chunks_keywords ON chunks USING gin(keywords);
CREATE INDEX IF NOT EXISTS idx_chunks_entities ON chunks USING gin(entities);
CREATE INDEX IF NOT EXISTS idx_chunks_importance ON chunks(importance_score DESC);
CREATE INDEX IF NOT EXISTS idx_chunks_search_text ON chunks USING gin(to_tsvector('english', search_text));

-- Documents search optimization
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS embedding vector(1536), -- Average embedding of all chunks
ADD COLUMN IF NOT EXISTS search_vector tsvector,
ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS download_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS relevance_score FLOAT DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(2, 1),
ADD COLUMN IF NOT EXISTS total_ratings INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS keywords TEXT[],
ADD COLUMN IF NOT EXISTS auto_summary TEXT;

-- Create indexes for documents
CREATE INDEX IF NOT EXISTS idx_documents_embedding ON documents USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_documents_search_vector ON documents USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_documents_view_count ON documents(view_count DESC);
CREATE INDEX IF NOT EXISTS idx_documents_relevance ON documents(relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_documents_rating ON documents(avg_rating DESC) WHERE avg_rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_keywords ON documents USING gin(keywords);

-- ============================================
-- 4. MATERIALIZED VIEWS
-- ============================================

-- Search analytics aggregates
CREATE MATERIALIZED VIEW IF NOT EXISTS search_analytics_daily AS
SELECT 
  DATE(created_at) as date,
  department_id,
  warehouse_id,
  language,
  COUNT(*) as search_count,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(DISTINCT query) as unique_queries,
  AVG(results_count) as avg_results,
  AVG(execution_time) as avg_execution_time,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY execution_time) as median_execution_time,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY execution_time) as p95_execution_time,
  COUNT(*) FILTER (WHERE results_count = 0) as zero_result_searches
FROM search_logs
GROUP BY DATE(created_at), department_id, warehouse_id, language;

-- Indexes for materialized view
CREATE INDEX idx_search_analytics_date ON search_analytics_daily(date DESC);
CREATE INDEX idx_search_analytics_dept ON search_analytics_daily(department_id);
CREATE INDEX idx_search_analytics_warehouse ON search_analytics_daily(warehouse_id);

-- Top queries materialized view
CREATE MATERIALIZED VIEW IF NOT EXISTS top_queries_weekly AS
SELECT 
  query,
  language,
  COUNT(*) as search_count,
  COUNT(DISTINCT user_id) as unique_users,
  AVG(results_count) as avg_results,
  COUNT(*) FILTER (WHERE results_count = 0) as zero_results,
  MAX(created_at) as last_searched,
  ARRAY_AGG(DISTINCT department_id) FILTER (WHERE department_id IS NOT NULL) as departments
FROM search_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY query, language
ORDER BY search_count DESC
LIMIT 100;

-- Click-through rate view
CREATE MATERIALIZED VIEW IF NOT EXISTS search_ctr_stats AS
SELECT 
  sl.query,
  sl.language,
  COUNT(DISTINCT sl.id) as search_count,
  COUNT(DISTINCT sf.id) as click_count,
  CASE 
    WHEN COUNT(DISTINCT sl.id) > 0 
    THEN COUNT(DISTINCT sf.id)::FLOAT / COUNT(DISTINCT sl.id) * 100 
    ELSE 0 
  END as ctr_percentage,
  AVG(sf.time_to_click) as avg_time_to_click,
  AVG(sf.dwell_time) as avg_dwell_time
FROM search_logs sl
LEFT JOIN search_feedback sf ON sf.search_log_id = sl.id AND sf.clicked = true
WHERE sl.created_at > NOW() - INTERVAL '30 days'
GROUP BY sl.query, sl.language
HAVING COUNT(DISTINCT sl.id) > 5; -- Only include queries with enough data

-- ============================================
-- 5. FUNCTIONS AND PROCEDURES
-- ============================================

-- Function to update document search vector
CREATE OR REPLACE FUNCTION update_document_search_vector() 
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := 
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.tags, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.keywords, ' '), '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for search vector
DROP TRIGGER IF EXISTS update_document_search_vector_trigger ON documents;
CREATE TRIGGER update_document_search_vector_trigger
BEFORE INSERT OR UPDATE OF title, content, tags, keywords
ON documents
FOR EACH ROW
EXECUTE FUNCTION update_document_search_vector();

-- Function to calculate cosine similarity
CREATE OR REPLACE FUNCTION cosine_similarity(a vector, b vector) 
RETURNS float AS $$
BEGIN
  RETURN 1 - (a <=> b);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get trending queries with time decay
CREATE OR REPLACE FUNCTION get_trending_queries(
  p_days INTEGER DEFAULT 7,
  p_limit INTEGER DEFAULT 10,
  p_language VARCHAR DEFAULT NULL,
  p_department_id UUID DEFAULT NULL
)
RETURNS TABLE (
  query TEXT,
  search_count BIGINT,
  unique_users BIGINT,
  trend_score FLOAT,
  avg_results FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sl.query,
    COUNT(*) as search_count,
    COUNT(DISTINCT sl.user_id) as unique_users,
    -- Calculate trend score with time decay
    COUNT(*) * EXP(-0.1 * EXTRACT(EPOCH FROM (NOW() - MAX(sl.created_at)))/86400) as trend_score,
    AVG(sl.results_count) as avg_results
  FROM search_logs sl
  WHERE sl.created_at > NOW() - INTERVAL '1 day' * p_days
    AND (p_language IS NULL OR sl.language = p_language)
    AND (p_department_id IS NULL OR sl.department_id = p_department_id)
  GROUP BY sl.query
  ORDER BY trend_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to find similar documents using vector similarity
CREATE OR REPLACE FUNCTION find_similar_documents(
  p_document_id UUID,
  p_limit INTEGER DEFAULT 5,
  p_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE (
  document_id UUID,
  title VARCHAR(255),
  similarity_score FLOAT,
  category VARCHAR(50),
  tags TEXT[]
) AS $$
DECLARE
  v_embedding vector;
BEGIN
  -- Get document embedding
  SELECT embedding INTO v_embedding
  FROM documents
  WHERE id = p_document_id;
  
  IF v_embedding IS NULL THEN
    -- If document doesn't have embedding, calculate from chunks
    SELECT AVG(embedding)::vector INTO v_embedding
    FROM chunks
    WHERE document_id = p_document_id;
  END IF;
  
  IF v_embedding IS NULL THEN
    RETURN;
  END IF;
  
  -- Find similar documents
  RETURN QUERY
  SELECT 
    d.id as document_id,
    d.title,
    1 - (d.embedding <=> v_embedding) as similarity_score,
    d.category,
    d.tags
  FROM documents d
  WHERE d.id != p_document_id
    AND d.embedding IS NOT NULL
    AND 1 - (d.embedding <=> v_embedding) > p_threshold
  ORDER BY similarity_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Procedure to log search with all analytics
CREATE OR REPLACE PROCEDURE log_search(
  p_user_id UUID,
  p_query TEXT,
  p_results_count INTEGER,
  p_execution_time INTEGER,
  p_filters JSONB DEFAULT NULL,
  p_language VARCHAR(2) DEFAULT 'en',
  p_department_id UUID DEFAULT NULL,
  p_warehouse_id UUID DEFAULT NULL,
  p_session_id VARCHAR DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_search_id UUID;
  v_normalized_query TEXT;
BEGIN
  -- Normalize query for suggestions
  v_normalized_query := LOWER(TRIM(p_query));
  
  -- Insert search log
  INSERT INTO search_logs (
    user_id, query, results_count, execution_time, 
    filters, language, department_id, warehouse_id,
    session_id, ip_address, user_agent
  ) VALUES (
    p_user_id, p_query, p_results_count, p_execution_time,
    p_filters, p_language, p_department_id, p_warehouse_id,
    p_session_id, p_ip_address, p_user_agent
  ) RETURNING id INTO v_search_id;
  
  -- Update search suggestions
  INSERT INTO search_suggestions (
    query, normalized_query, display_text, usage_count, 
    language, department_id, warehouse_id
  ) VALUES (
    p_query, v_normalized_query, p_query, 1, 
    p_language, p_department_id, p_warehouse_id
  )
  ON CONFLICT (normalized_query, department_id, language) 
  DO UPDATE SET 
    usage_count = search_suggestions.usage_count + 1,
    updated_at = NOW();
  
  -- Update session if provided
  IF p_session_id IS NOT NULL THEN
    UPDATE search_sessions 
    SET search_count = search_count + 1,
        ended_at = NOW()
    WHERE session_id = p_session_id;
  END IF;
  
  COMMIT;
END;
$$;

-- Procedure to update search feedback and analytics
CREATE OR REPLACE PROCEDURE update_search_feedback(
  p_search_log_id UUID,
  p_user_id UUID,
  p_result_id UUID,
  p_rating VARCHAR,
  p_clicked BOOLEAN DEFAULT false,
  p_time_to_click INTEGER DEFAULT NULL,
  p_dwell_time INTEGER DEFAULT NULL,
  p_comment TEXT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert or update feedback
  INSERT INTO search_feedback (
    search_log_id, user_id, result_id, rating,
    clicked, time_to_click, dwell_time, comment
  ) VALUES (
    p_search_log_id, p_user_id, p_result_id, p_rating,
    p_clicked, p_time_to_click, p_dwell_time, p_comment
  )
  ON CONFLICT (search_log_id, user_id, result_id)
  DO UPDATE SET
    rating = EXCLUDED.rating,
    clicked = EXCLUDED.clicked,
    time_to_click = EXCLUDED.time_to_click,
    dwell_time = EXCLUDED.dwell_time,
    comment = EXCLUDED.comment,
    created_at = NOW();
  
  -- Update session stats if clicked
  IF p_clicked THEN
    UPDATE search_sessions ss
    SET click_count = click_count + 1,
        total_dwell_time = total_dwell_time + COALESCE(p_dwell_time, 0)
    FROM search_logs sl
    WHERE sl.id = p_search_log_id
      AND ss.session_id = sl.session_id;
  END IF;
  
  COMMIT;
END;
$$;

-- Procedure to refresh materialized views
CREATE OR REPLACE PROCEDURE refresh_search_analytics()
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY search_analytics_daily;
  REFRESH MATERIALIZED VIEW CONCURRENTLY top_queries_weekly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY search_ctr_stats;
END;
$$;

-- Procedure to cleanup old data (retention policy)
CREATE OR REPLACE PROCEDURE cleanup_old_search_data(
  p_retention_days INTEGER DEFAULT 90,
  p_cache_retention_days INTEGER DEFAULT 30
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted_logs INTEGER;
  v_deleted_cache INTEGER;
  v_deleted_sessions INTEGER;
BEGIN
  -- Delete old search logs
  DELETE FROM search_logs 
  WHERE created_at < NOW() - INTERVAL '1 day' * p_retention_days;
  GET DIAGNOSTICS v_deleted_logs = ROW_COUNT;
  
  -- Clean up unused cached embeddings
  DELETE FROM cached_embeddings
  WHERE last_used_at < NOW() - INTERVAL '1 day' * p_cache_retention_days
    AND usage_count < 5;
  GET DIAGNOSTICS v_deleted_cache = ROW_COUNT;
  
  -- Delete old sessions
  DELETE FROM search_sessions
  WHERE started_at < NOW() - INTERVAL '1 day' * p_retention_days;
  GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;
  
  RAISE NOTICE 'Cleanup complete: % logs, % cache entries, % sessions deleted', 
    v_deleted_logs, v_deleted_cache, v_deleted_sessions;
  
  COMMIT;
END;
$$;

-- Function to calculate document relevance score
CREATE OR REPLACE FUNCTION calculate_document_relevance(
  p_document_id UUID
)
RETURNS FLOAT AS $$
DECLARE
  v_score FLOAT := 1.0;
  v_view_count INTEGER;
  v_avg_rating DECIMAL;
  v_age_days INTEGER;
  v_feedback_score FLOAT;
BEGIN
  -- Get document stats
  SELECT 
    view_count,
    avg_rating,
    EXTRACT(DAY FROM NOW() - created_at)
  INTO v_view_count, v_avg_rating, v_age_days
  FROM documents
  WHERE id = p_document_id;
  
  -- Calculate feedback score from search feedback
  SELECT 
    CASE 
      WHEN COUNT(*) > 0 THEN
        SUM(CASE 
          WHEN rating = 'helpful' THEN 1
          WHEN rating = 'partially_helpful' THEN 0.5
          ELSE 0
        END) / COUNT(*)::FLOAT
      ELSE 0.5
    END
  INTO v_feedback_score
  FROM search_feedback sf
  JOIN search_logs sl ON sf.search_log_id = sl.id
  WHERE sf.result_id = p_document_id;
  
  -- Calculate composite score
  -- View count factor (logarithmic scale)
  IF v_view_count > 0 THEN
    v_score := v_score * (1 + LOG(v_view_count) / 10);
  END IF;
  
  -- Rating factor
  IF v_avg_rating IS NOT NULL THEN
    v_score := v_score * (0.5 + v_avg_rating / 10);
  END IF;
  
  -- Feedback factor
  v_score := v_score * (0.5 + v_feedback_score);
  
  -- Age penalty (newer documents get slight boost)
  v_score := v_score * EXP(-0.001 * v_age_days);
  
  RETURN v_score;
END;
$$ LANGUAGE plpgsql;

-- Function to get search recommendations for user
CREATE OR REPLACE FUNCTION get_search_recommendations(
  p_user_id UUID,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  query TEXT,
  reason TEXT,
  score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH user_searches AS (
    -- Get user's recent searches
    SELECT DISTINCT query, department_id, language
    FROM search_logs
    WHERE user_id = p_user_id
      AND created_at > NOW() - INTERVAL '30 days'
    ORDER BY created_at DESC
    LIMIT 20
  ),
  related AS (
    -- Get related searches
    SELECT 
      rs.related_query as query,
      'Related to your searches' as reason,
      AVG(rs.relation_score) as score
    FROM user_searches us
    JOIN related_searches rs ON rs.primary_query_normalized = LOWER(TRIM(us.query))
    WHERE rs.related_query NOT IN (SELECT query FROM user_searches)
    GROUP BY rs.related_query
  ),
  department_popular AS (
    -- Get popular in user's department
    SELECT 
      tq.query,
      'Popular in your department' as reason,
      tq.search_count::FLOAT / 100 as score
    FROM top_queries_weekly tq
    WHERE tq.departments @> ARRAY[(
      SELECT department_id 
      FROM search_logs 
      WHERE user_id = p_user_id 
      ORDER BY created_at DESC 
      LIMIT 1
    )]
    AND tq.query NOT IN (SELECT query FROM user_searches)
  )
  SELECT * FROM (
    SELECT * FROM related
    UNION ALL
    SELECT * FROM department_popular
  ) recommendations
  ORDER BY score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. PERMISSIONS
-- ============================================

-- Create roles if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'search_user') THEN
    CREATE ROLE search_user;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'search_admin') THEN
    CREATE ROLE search_admin;
  END IF;
END
$$;

-- Grant permissions for search_user role
GRANT SELECT, INSERT ON search_logs TO search_user;
GRANT SELECT, INSERT, UPDATE ON search_feedback TO search_user;
GRANT SELECT ON search_suggestions TO search_user;
GRANT SELECT ON search_analytics_daily TO search_user;
GRANT SELECT ON top_queries_weekly TO search_user;
GRANT SELECT ON search_ctr_stats TO search_user;
GRANT SELECT, INSERT, UPDATE ON ai_conversations TO search_user;
GRANT SELECT, INSERT ON ai_messages TO search_user;
GRANT EXECUTE ON FUNCTION get_trending_queries TO search_user;
GRANT EXECUTE ON FUNCTION find_similar_documents TO search_user;
GRANT EXECUTE ON FUNCTION get_search_recommendations TO search_user;

-- Grant permissions for search_admin role
GRANT ALL ON ALL TABLES IN SCHEMA public TO search_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO search_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO search_admin;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO search_admin;

-- ============================================
-- 7. SCHEDULED JOBS (using pg_cron if available)
-- ============================================

-- Note: Requires pg_cron extension
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule analytics refresh every hour
-- SELECT cron.schedule('refresh-search-analytics', '0 * * * *', 'CALL refresh_search_analytics()');

-- Schedule cleanup every day at 2 AM
-- SELECT cron.