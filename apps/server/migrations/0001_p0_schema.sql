-- migrate:up
CREATE TABLE users (
	id uuid PRIMARY KEY,
	username text NOT NULL UNIQUE,
	password_hash text NOT NULL,
	role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
	status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
	is_self_reported boolean NOT NULL DEFAULT true,
	failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
	locked_until timestamptz,
	anonymized_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_username_casefold_unique ON users (lower(username));

CREATE TABLE admin_audit (
	id uuid PRIMARY KEY,
	actor_type text NOT NULL CHECK (actor_type IN ('user', 'system', 'os_operator')),
	actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
	actor_principal text,
	action text NOT NULL,
	target_type text NOT NULL,
	target_id text,
	params_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
	at timestamptz NOT NULL DEFAULT now(),
	CONSTRAINT admin_audit_actor_shape CHECK (
		(actor_type = 'user' AND actor_user_id IS NOT NULL AND actor_principal IS NULL)
		OR (actor_type = 'system' AND actor_user_id IS NULL AND actor_principal IS NULL)
		OR (
			actor_type = 'os_operator'
			AND actor_user_id IS NULL
			AND actor_principal ~ '^uid:[0-9]+$'
		)
	)
);

CREATE TABLE auth_sessions (
	id uuid PRIMARY KEY,
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	refresh_token_hash text NOT NULL UNIQUE,
	issued_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL,
	revoked_at timestamptz,
	device_id text,
	client_version text,
	CONSTRAINT auth_sessions_time_order CHECK (expires_at > issued_at)
);

CREATE INDEX auth_sessions_user_active_idx ON auth_sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE consents (
	id uuid PRIMARY KEY,
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	notice_version text NOT NULL,
	consented_at timestamptz NOT NULL DEFAULT now(),
	client_version text,
	withdrawn_at timestamptz,
	invalidated_at timestamptz,
	CONSTRAINT consents_terminal_time CHECK (
		(withdrawn_at IS NULL OR withdrawn_at >= consented_at)
		AND (invalidated_at IS NULL OR invalidated_at >= consented_at)
	)
);

CREATE UNIQUE INDEX consents_current_version_unique
	ON consents (user_id, notice_version)
	WHERE withdrawn_at IS NULL AND invalidated_at IS NULL;

CREATE TABLE password_resets (
	id uuid PRIMARY KEY,
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	token_hash text NOT NULL UNIQUE,
	expires_at timestamptz NOT NULL,
	issued_by_audit_id uuid NOT NULL REFERENCES admin_audit(id) ON DELETE RESTRICT,
	used_at timestamptz
);

CREATE INDEX password_resets_user_expiry_idx ON password_resets (user_id, expires_at);

CREATE TABLE model_proxy_calls (
	id uuid PRIMARY KEY,
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	model text NOT NULL,
	started_at timestamptz NOT NULL DEFAULT now(),
	ended_at timestamptz,
	status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'error', 'cancelled')),
	error_code text,
	prompt_tokens integer CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
	completion_tokens integer CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
	latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
	CONSTRAINT model_proxy_calls_terminal_shape CHECK (
		(status = 'in_progress' AND ended_at IS NULL)
		OR (status <> 'in_progress' AND ended_at IS NOT NULL)
	)
);

CREATE INDEX model_proxy_calls_user_started_idx ON model_proxy_calls (user_id, started_at);
CREATE INDEX model_proxy_calls_in_progress_idx ON model_proxy_calls (started_at) WHERE status = 'in_progress';

CREATE TABLE usage_records (
	event_id text PRIMARY KEY,
	session_id text NOT NULL,
	turn_id text NOT NULL,
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
	group_snapshot jsonb,
	received_at timestamptz NOT NULL DEFAULT now(),
	client_created_at timestamptz,
	task_category text CHECK (task_category IS NULL OR task_category IN ('Coding', 'Hydro', 'Document', 'Data', 'Operations', 'Knowledge')),
	model text,
	client_version text,
	device_id text,
	turn_status text NOT NULL CHECK (turn_status IN ('completed', 'aborted', 'error')),
	user_input bytea NOT NULL,
	assistant_final bytea,
	anonymous boolean NOT NULL DEFAULT false,
	payload_fingerprint text NOT NULL,
	CONSTRAINT usage_records_p0_group_empty CHECK (group_snapshot IS NULL)
);

CREATE INDEX usage_records_user_received_idx ON usage_records (user_id, received_at);
CREATE INDEX usage_records_session_turn_idx ON usage_records (session_id, turn_id);

CREATE TABLE turn_model_call_links (
	usage_event_id text NOT NULL REFERENCES usage_records(event_id) ON DELETE CASCADE,
	model_call_id uuid NOT NULL REFERENCES model_proxy_calls(id) ON DELETE CASCADE,
	PRIMARY KEY (usage_event_id, model_call_id)
);

-- migrate:down
DROP TABLE IF EXISTS turn_model_call_links;
DROP TABLE IF EXISTS usage_records;
DROP TABLE IF EXISTS model_proxy_calls;
DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS consents;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS admin_audit;
DROP TABLE IF EXISTS users;
