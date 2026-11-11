CREATE TABLE IF NOT EXISTS wengu_workspace (
    id integer PRIMARY KEY CHECK (id = 1),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    custom_cycle varchar(200) NOT NULL,
    last_pause_date date,
    pause_undo json
);

CREATE TABLE IF NOT EXISTS wengu_subject (
    name varchar(50) PRIMARY KEY,
    position integer NOT NULL CHECK (position >= 0)
);

CREATE TABLE IF NOT EXISTS wengu_study_record (
    id varchar(128) PRIMARY KEY,
    subject varchar(50) NOT NULL REFERENCES wengu_subject(name),
    title varchar(150) NOT NULL CHECK (length(trim(title)) > 0),
    studied_on date NOT NULL,
    note varchar(3000) NOT NULL,
    cycle json NOT NULL,
    archived boolean NOT NULL DEFAULT false,
    position integer NOT NULL CHECK (position >= 0)
);

CREATE TABLE IF NOT EXISTS wengu_review_task (
    record_id varchar(128) NOT NULL REFERENCES wengu_study_record(id) ON DELETE CASCADE,
    id varchar(128) NOT NULL,
    due_on date NOT NULL,
    kind varchar(5) NOT NULL CHECK (kind IN ('base', 'extra')),
    done boolean NOT NULL DEFAULT false,
    position integer NOT NULL CHECK (position >= 0),
    PRIMARY KEY (record_id, id)
);

CREATE TABLE IF NOT EXISTS wengu_review_event (
    record_id varchar(128) NOT NULL REFERENCES wengu_study_record(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 0),
    id varchar(128),
    reviewed_on date NOT NULL,
    effect varchar(6) NOT NULL CHECK (effect IN ('normal', 'solid', 'vague', 'forgot')),
    created_at varchar(40),
    previous_tasks json NOT NULL,
    PRIMARY KEY (record_id, position)
);

CREATE TABLE IF NOT EXISTS wengu_session (
    token char(64) PRIMARY KEY,
    expires bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS wengu_task_due_idx ON wengu_review_task(done, due_on);
CREATE INDEX IF NOT EXISTS wengu_study_subject_date_idx ON wengu_study_record(subject, studied_on);
