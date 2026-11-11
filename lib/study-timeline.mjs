import { PRESETS } from './review.mjs';

export function cycleLevel(cycle) {
  const offsets = new Set(cycle);
  return Object.entries(PRESETS).find(([, preset]) =>
    offsets.size === preset.length && preset.every(offset => offsets.has(offset))
  )?.[0] ?? 'custom';
}

export function studyTimeline(records, {from = '', to = ''} = {}) {
  const days = new Map();
  function entry(date) {
    if ((from && date < from) || (to && date > to)) return;
    if (!days.has(date)) days.set(date, {date, learned:[], reviews:new Map()});
    return days.get(date);
  }
  for (const record of records) {
    entry(record.date)?.learned.push(record);
    for (const task of record.tasks) {
      if (task.done) continue;
      const row = entry(task.date);
      if (row && !row.reviews.has(record.id)) {
        row.reviews.set(record.id, {record, completed:false});
      }
    }
    for (const event of record.history) {
      entry(event.date)?.reviews.set(record.id, {record, completed:true});
    }
  }
  return [...days.values()].map(row => ({...row, reviews:[...row.reviews.values()]}));
}
