export const migrationOne = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  username varchar(80) NOT NULL,
  display_name varchar(160) NOT NULL,
  password_hash text NOT NULL,
  role varchar(20) NOT NULL CHECK (role IN ('admin', 'sales', 'reader')),
  must_change_password boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_ci
  ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_failures (
  key_hash char(64) PRIMARY KEY,
  failure_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);

CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY,
  code varchar(40) NOT NULL,
  name varchar(180) NOT NULL,
  customer varchar(180) NOT NULL,
  value_eur bigint NOT NULL CHECK (value_eur >= 0),
  stage varchar(80) NOT NULL,
  probability integer NOT NULL CHECK (probability BETWEEN 0 AND 100),
  close_date date NOT NULL,
  summary varchar(2000) NOT NULL,
  use_case text NOT NULL,
  accent varchar(20) NOT NULL DEFAULT 'violet',
  context_marker varchar(100) NOT NULL,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS opportunities_code_ci
  ON opportunities (lower(code));
CREATE INDEX IF NOT EXISTS opportunities_stage ON opportunities(stage);
CREATE INDEX IF NOT EXISTS opportunities_updated_at ON opportunities(updated_at DESC);

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  type varchar(20) NOT NULL CHECK (type IN ('appointment', 'todo', 'note')),
  title varchar(180) NOT NULL,
  due_at timestamptz NOT NULL,
  status varchar(20) NOT NULL,
  body varchar(4000) NOT NULL,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_opportunity_due
  ON activities(opportunity_id, due_at);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  name varchar(180) NOT NULL,
  media_type varchar(100) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  storage_key varchar(240) NOT NULL UNIQUE,
  checksum_sha256 char(64) NOT NULL,
  content bytea NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_opportunity_created
  ON documents(opportunity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  aida_conversation_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_opportunity_updated
  ON conversations(opportunity_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  kind varchar(60) NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_created
  ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  kind varchar(60) NOT NULL,
  title varchar(180) NOT NULL,
  content text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artifacts_opportunity_created
  ON artifacts(opportunity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assistant_definitions (
  assistant_key varchar(60) PRIMARY KEY,
  display_name varchar(120) NOT NULL,
  description varchar(500) NOT NULL,
  starter_prompt varchar(2000) NOT NULL,
  action_instructions text NOT NULL,
  output_label varchar(180),
  creates_artifact boolean NOT NULL DEFAULT true,
  uses_product_knowledge boolean NOT NULL DEFAULT true,
  model_profile_name varchar(180),
  cloud_processing_confirmed boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(100) NOT NULL,
  entity_type varchar(80) NOT NULL,
  entity_id varchar(100),
  outcome varchar(20) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_at ON audit_log(created_at DESC);
`;

export const migrationTwo = `
ALTER TABLE assistant_definitions
  ADD COLUMN IF NOT EXISTS uses_product_knowledge boolean NOT NULL DEFAULT true;
ALTER TABLE messages ALTER COLUMN kind TYPE varchar(60);
ALTER TABLE artifacts ALTER COLUMN kind TYPE varchar(60);
UPDATE assistant_definitions SET uses_product_knowledge = true;
`;

export const migrationThree = `
UPDATE assistant_definitions
SET action_instructions = replace(
      replace(action_instructions, E'\\nAim\\n', E'\\nAct\\n'),
      E'\\nTasks\\n', E'\\nTask\\n'),
    updated_at = now()
WHERE action_instructions LIKE E'%\\nAim\\n%'
   OR action_instructions LIKE E'%\\nTasks\\n%';
`;

export const migrationFour = `
ALTER TABLE assistant_definitions
  ADD COLUMN IF NOT EXISTS cloud_processing_confirmed BOOLEAN NOT NULL DEFAULT false;

UPDATE assistant_definitions
SET uses_product_knowledge = CASE assistant_key
      WHEN 'offer-author' THEN true
      WHEN 'feasibility-analyst' THEN true
      WHEN 'implementation-handout' THEN true
      WHEN 'aida-gap-analyst' THEN true
      ELSE false
    END,
    updated_at = now()
WHERE assistant_key IN (
  'sales-copilot', 'meeting-briefing', 'email-drafter', 'risk-analyst',
  'offer-author', 'feasibility-analyst', 'implementation-handout', 'aida-gap-analyst'
);

UPDATE assistant_definitions
SET action_instructions = action_instructions || E'\\n- Support every AIDA product capability claim with approved AIDA product knowledge. If the knowledge base does not support a claim, label it NOT DOCUMENTED instead of guessing.',
    updated_at = now()
WHERE assistant_key IN ('offer-author', 'feasibility-analyst', 'implementation-handout', 'aida-gap-analyst')
  AND action_instructions NOT LIKE '%label it NOT DOCUMENTED%';
`;

export const migrationFive = `
ALTER TABLE documents ADD COLUMN IF NOT EXISTS content bytea;
UPDATE documents SET content = decode('', 'hex') WHERE content IS NULL;
ALTER TABLE documents ALTER COLUMN content SET NOT NULL;
`;

export const migrationSix = `
CREATE TABLE IF NOT EXISTS chat_dispatches (
  id uuid PRIMARY KEY,
  aida_job_id uuid UNIQUE,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  expected_aida_conversation_id uuid NOT NULL,
  assistant_key varchar(60) NOT NULL,
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 4000),
  output_label varchar(180),
  creates_artifact boolean NOT NULL,
  submitted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL CHECK (
    status IN ('Submitting', 'Queued', 'Processing', 'Succeeded', 'Failed')),
  error_message varchar(1000),
  profile_name varchar(180),
  model_name varchar(180),
  used_fallback boolean,
  submitted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK ((status IN ('Submitting', 'Queued', 'Processing')
          AND completed_at IS NULL AND error_message IS NULL)
      OR (status = 'Succeeded'
          AND completed_at IS NOT NULL AND error_message IS NULL)
      OR (status = 'Failed'
          AND completed_at IS NOT NULL AND error_message IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_dispatches_one_active_conversation
  ON chat_dispatches(conversation_id)
  WHERE status IN ('Submitting', 'Queued', 'Processing');
CREATE INDEX IF NOT EXISTS chat_dispatches_opportunity_updated
  ON chat_dispatches(opportunity_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_dispatches_retention
  ON chat_dispatches(completed_at)
  WHERE completed_at IS NOT NULL;
`;
