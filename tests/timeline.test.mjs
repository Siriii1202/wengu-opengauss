import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecord, complete, emptyState, pauseToday, resumeToday, validateState} from '../lib/review.mjs';
import {studyTimeline} from '../lib/study-timeline.mjs';

test('日期列表跟随暂停及取消，历史完成日期和此前逾期不变', () => {
  const day = '2026-11-07';
  const state = emptyState();
  const record = createRecord({title:'概率分布', subject:'概率论', date:'2026-11-01', cycle:['1d','3d','6d','29d']});
  complete(record, '2026-11-02');
  state.records.push(record);
  const before = structuredClone(state);
  const summary = data => Object.fromEntries(studyTimeline(data.records).map(row =>
    [row.date, [row.learned.length, row.reviews[0]?.completed ?? null]]
  ));
  assert.equal(pauseToday(state, day), 2);
  assert.equal(pauseToday(state, day), 0);
  const paused = validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(summary(paused), {
    '2026-11-01':[1,null],
    '2026-11-02':[0,true],
    '2026-11-04':[0,false],
    '2026-11-08':[0,false],
    '2026-12-01':[0,false],
  });
  assert.equal(resumeToday(paused, day), true);
  assert.deepEqual(paused, before);
  assert.deepEqual(studyTimeline(paused.records, {from:day, to:day}).map(row => row.date), [day]);
});

test('取消暂停能恢复历史快照中与当前安排不同的原日期', () => {
  const state = emptyState();
  const record = createRecord({title:'树', subject:'数据结构', date:'2026-11-01', cycle:['1d','3d']});
  complete(record, '2026-11-02');
  record.tasks[1].date = '2026-11-07';
  state.records.push(record);
  const before = structuredClone(state);
  assert.equal(pauseToday(state, '2026-11-07'), 1);
  assert.equal(record.history[0].before[1].date, '2026-11-08');
  assert.equal(resumeToday(state, '2026-11-07'), true);
  assert.deepEqual(state, before);
});
