import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { emptyState } from '../lib/review.mjs';
import { exampleRecords } from './examples.mjs';

export const pool = new pg.Pool({
  connectionTimeoutMillis: 4000,
  max: 8,
});
pool.on('error', error => console.error('openGauss connection:', error.message));

async function transaction(work, begin = 'BEGIN') {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query(begin);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

export async function initialize() {
  const { rows: [{ version }] } = await pool.query('SELECT version()');
  if (!/opengauss/i.test(version)) throw Error('数据库服务必须为 openGauss');
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  const { subjects, settings } = emptyState();
  await transaction(async client => {
    await client.query(schema);
    await client.query('LOCK TABLE wengu_workspace IN EXCLUSIVE MODE');
    const { rowCount } = await client.query('SELECT id FROM wengu_workspace WHERE id=1');
    if (rowCount) return;
    await client.query('INSERT INTO wengu_workspace(id, custom_cycle) VALUES (1,$1)', [settings.customCycle]);
    const records = exampleRecords();
    const subjectNames = [...new Set([...subjects, ...records.map(record => record.subject)])];
    for (const [position, name] of subjectNames.entries()) {
      await client.query('INSERT INTO wengu_subject(name, position) VALUES ($1,$2)', [name, position]);
    }
    for (const [position, record] of records.entries()) {
      await writeRecord(client, record, position, false);
    }
  });
  return version;
}

async function readWorkspace(client) {
  const { rows: [workspace] } = await client.query(
    "SELECT revision, custom_cycle, to_char(last_pause_date, 'YYYY-MM-DD') AS pause_date, pause_undo FROM wengu_workspace WHERE id=1",
  );
  const { rows: subjects } = await client.query('SELECT name FROM wengu_subject ORDER BY position');
  const { rows } = await client.query(
    "SELECT id, subject, title, to_char(studied_on, 'YYYY-MM-DD') AS date, note, cycle, archived FROM wengu_study_record ORDER BY position",
  );
  const records = new Map(rows.map(row => [row.id, { ...row, tasks: [], history: [] }]));
  const { rows: tasks } = await client.query(
    "SELECT record_id, id, to_char(due_on, 'YYYY-MM-DD') AS date, kind, done FROM wengu_review_task ORDER BY record_id, position",
  );
  for (const { record_id, ...task } of tasks) records.get(record_id).tasks.push(task);
  const { rows: events } = await client.query(
    "SELECT record_id, id, to_char(reviewed_on, 'YYYY-MM-DD') AS date, effect, created_at, previous_tasks FROM wengu_review_event ORDER BY record_id, position",
  );
  for (const event of events) {
    records.get(event.record_id).history.push({
      ...(event.id === null ? {} : { id: event.id }),
      date: event.date,
      effect: event.effect,
      before: event.previous_tasks,
      ...(event.created_at === null ? {} : { createdAt: event.created_at }),
    });
  }
  const state = emptyState();
  state.subjects = subjects.map(row => row.name);
  state.records = [...records.values()];
  state.settings.customCycle = workspace.custom_cycle;
  if (workspace.pause_date) state.lastPauseDate = workspace.pause_date;
  if (workspace.pause_undo) state.pauseUndo = workspace.pause_undo;
  return { version: workspace.revision, state };
}

export function readState() {
  return transaction(readWorkspace, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
}

async function writeRecord(client, record, position, exists) {
  const values = [
    record.id, record.subject, record.title, record.date, record.note,
    JSON.stringify(record.cycle), record.archived, position,
  ];
  if (exists) {
    await client.query(
      'UPDATE wengu_study_record SET subject=$2,title=$3,studied_on=$4,note=$5,cycle=$6,archived=$7,position=$8 WHERE id=$1',
      values,
    );
    await client.query('DELETE FROM wengu_review_task WHERE record_id=$1', [record.id]);
    await client.query('DELETE FROM wengu_review_event WHERE record_id=$1', [record.id]);
  } else {
    await client.query(
      'INSERT INTO wengu_study_record(id,subject,title,studied_on,note,cycle,archived,position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      values,
    );
  }
  for (const [index, task] of record.tasks.entries()) {
    await client.query(
      'INSERT INTO wengu_review_task(record_id,id,due_on,kind,done,position) VALUES ($1,$2,$3,$4,$5,$6)',
      [record.id, task.id, task.date, task.kind, task.done, index],
    );
  }
  for (const [index, event] of record.history.entries()) {
    await client.query(
      'INSERT INTO wengu_review_event(record_id,position,id,reviewed_on,effect,created_at,previous_tasks) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [record.id, index, event.id ?? null, event.date, event.effect, event.createdAt ?? null, JSON.stringify(event.before)],
    );
  }
}

export function saveState(version, state) {
  return transaction(async client => {
    const result = await client.query(
      'UPDATE wengu_workspace SET revision=revision+1,custom_cycle=$2,last_pause_date=$3,pause_undo=$4 WHERE id=1 AND revision=$1',
      [version, state.settings.customCycle, state.lastPauseDate ?? null, state.pauseUndo ? JSON.stringify(state.pauseUndo) : null],
    );
    if (!result.rowCount) return false;

    const { state: previous } = await readWorkspace(client);
    const beforeSubjects = new Map(previous.subjects.map((name, position) => [name, position]));
    for (const [position, name] of state.subjects.entries()) {
      if (!beforeSubjects.has(name)) {
        await client.query('INSERT INTO wengu_subject(name,position) VALUES ($1,$2)', [name, position]);
      } else if (beforeSubjects.get(name) !== position) {
        await client.query('UPDATE wengu_subject SET position=$2 WHERE name=$1', [name, position]);
      }
    }

    const beforeRecords = new Map(previous.records.map((record, position) => [record.id, { record, position }]));
    const ids = new Set(state.records.map(record => record.id));
    for (const id of beforeRecords.keys()) {
      if (!ids.has(id)) await client.query('DELETE FROM wengu_study_record WHERE id=$1', [id]);
    }
    for (const [position, record] of state.records.entries()) {
      const before = beforeRecords.get(record.id);
      if (!before || !sameRecord(before.record, record)) {
        await writeRecord(client, record, position, Boolean(before));
      } else if (before.position !== position) {
        await client.query('UPDATE wengu_study_record SET position=$2 WHERE id=$1', [record.id, position]);
      }
    }

    const subjectNames = new Set(state.subjects);
    for (const name of beforeSubjects.keys()) {
      if (!subjectNames.has(name)) await client.query('DELETE FROM wengu_subject WHERE name=$1', [name]);
    }
    return true;
  });
}

function sameRecord(left, right) {
  const fields = ['subject', 'title', 'date', 'note', 'archived', 'cycle', 'tasks', 'history'];
  return fields.every(field => JSON.stringify(left[field]) === JSON.stringify(right[field]));
}

