export const SUBJECTS=['高等数学','线性代数','概率论','数据结构','计算机组成原理','计算机网络','操作系统','英语','政治'];
export const PRESETS={short:['1d','3d','7d','14d','1m','3m','6m'],medium:['1d','7d','14d','1m','3m','6m'],long:['7d','1m','3m','6m']};
export function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
export function shift(date,offset){const m=/^(\d{1,4})(d|m)$/.exec(offset);if(!m||+m[1]<1||+m[1]>3650||!validDate(date))throw Error('周期格式不正确');const d=new Date(date+'T12:00:00Z');if(m[2]==='d')d.setUTCDate(d.getUTCDate()+Number(m[1]));else{const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+Number(m[1]));const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));}return d.toISOString().slice(0,10);}
export function parseCycle(value){const tokens=value.replaceAll('，',',').replaceAll('、',',').split(/[\s,;；]+/).filter(Boolean).map(t=>t.replace(/天$/,'d').replace(/个月$|月$/,'m'));if(!tokens.length||tokens.length>30||tokens.some(t=>!/^\d{1,4}[dm]$/.test(t)||+t.slice(0,-1)<1||+t.slice(0,-1)>3650))throw Error('请输入如 1d,3d,7d,1m,3m,6m 的周期');return [...new Set(tokens)];}
export function emptyState(){return {schema:1,subjects:[...SUBJECTS],records:[],settings:{morning:'08:00',evening:'20:00',morningOn:false,eveningOn:true,notifyEmpty:false,customCycle:'7d,14d,30d,3m,6m'}};}
export function createRecord({title,subject,date,cycle,note=''}){if(!title.trim()||title.length>150)throw Error('知识点名称应为1–150字');if(!validDate(date)||date>today())throw Error('学习日期不能晚于今天');const offsets=Array.isArray(cycle)?parseCycle(cycle.join(',')):parseCycle(cycle);return {id:crypto.randomUUID(),title:title.trim(),subject,date,note:note.slice(0,3000),cycle:offsets,tasks:offsets.map(o=>({id:crypto.randomUUID(),date:shift(date,o),kind:'base',done:false})),history:[],archived:false};}
export function dueTasks(record,day){return record.archived?[]:record.tasks.filter(t=>!t.done&&t.date<=day);}
export function nextDate(record){return record.tasks.filter(t=>!t.done).map(t=>t.date).sort()[0]||null;}
export function complete(record,day,effect='normal'){const ids=dueTasks(record,day).map(t=>t.id);if(!ids.length)throw Error('没有待完成的复习');const before=JSON.parse(JSON.stringify(record.tasks));record.tasks.forEach(t=>{if(ids.includes(t.id))t.done=true;});if(effect==='forgot'||effect==='solid')record.tasks=record.tasks.filter(t=>t.kind!=='extra'||t.done);const added=effect==='forgot'?['1d','3d','7d']:effect==='vague'?['3d']:[];for(const o of added){const date=shift(day,o);if(!record.tasks.some(t=>!t.done&&t.date===date))record.tasks.push({id:crypto.randomUUID(),date,kind:'extra',done:false});}const event={id:crypto.randomUUID(),date:day,effect,before,createdAt:new Date().toISOString()};record.history.push(event);return event;}
export function undo(record){const h=record.history.pop();if(!h)throw Error('没有可撤销的复习');record.tasks=h.before;}
export function postpone(record,day){const target=shift(day,'1d');for(const t of dueTasks(record,day))t.date=target;}

export function pauseToday(state, day) {
  if (state.lastPauseDate === day) return 0;
  const changes = [];
  let moved = 0;
  for (const record of state.records) {
    if (record.archived) continue;
    const dates = new Map();
    for (const task of record.tasks) {
      if (task.done || task.date < day) continue;
      dates.set(task.id, task.date);
      task.date = shift(task.date, '1d');
      moved++;
    }
    if (!dates.size) continue;
    const history = [];
    for (const [index, event] of record.history.entries()) {
      for (const task of event.before) {
        if (task.done || !dates.has(task.id)) continue;
        const originalDate = dates.get(task.id);
        if (task.date !== originalDate) {
          history.push({index, eventId:event.id ?? null, taskId:task.id, date:task.date});
        }
        task.date = shift(originalDate, '1d');
      }
    }
    changes.push({recordId:record.id, dates:[...dates], history});
  }
  if (moved) {
    state.lastPauseDate = day;
    state.pauseUndo = changes;
  }
  return moved;
}

export function resumeToday(state, day) {
  if (state.lastPauseDate !== day || !state.pauseUndo?.length) return false;
  const records = new Map(state.records.map(record => [record.id, record]));
  for (const change of state.pauseUndo) {
    const record = records.get(change.recordId);
    if (!record) continue;
    const dates = new Map(change.dates);
    const restoreDate = task => {
      const original = dates.get(task.id);
      if (original && task.date === shift(original, '1d')) task.date = original;
    };
    record.tasks.forEach(restoreDate);
    for (const event of record.history) {
      event.before.filter(task => !task.done).forEach(restoreDate);
    }
    for (const {index, eventId, taskId, date} of change.history) {
      const event = record.history[index];
      if (!event || (event.id ?? null) !== eventId) continue;
      const task = event.before.find(item => item.id === taskId && !item.done);
      if (task?.date === dates.get(taskId)) task.date = date;
    }
  }
  delete state.lastPauseDate;
  delete state.pauseUndo;
  return true;
}

function validPauseUndo(changes) {
  return Array.isArray(changes) && changes.every(change =>
    change && typeof change.recordId === 'string' &&
    Array.isArray(change.dates) && change.dates.every(entry =>
      Array.isArray(entry) && typeof entry[0] === 'string' && validDate(entry[1])
    ) &&
    Array.isArray(change.history) && change.history.every(entry =>
      entry && Number.isInteger(entry.index) && entry.index >= 0 &&
      (typeof entry.eventId === 'string' || entry.eventId === null) &&
      typeof entry.taskId === 'string' && validDate(entry.date)
    )
  );
}
export function validateState(s){if(!s||s.schema!==1||!Array.isArray(s.subjects)||!Array.isArray(s.records)||s.records.length>15000||s.subjects.length>100||!s.settings)throw Error('备份格式不正确');if(s.subjects.some(x=>typeof x!=='string'||!x.trim()||x.length>50)||new Set(s.subjects).size!==s.subjects.length)throw Error('科目格式不正确');if(s.lastPauseDate!==undefined&&!validDate(s.lastPauseDate))throw Error('暂停日期格式不正确');if(s.pauseUndo!==undefined&&(!s.lastPauseDate||!validPauseUndo(s.pauseUndo)))throw Error('暂停恢复记录格式不正确');const ids=new Set();for(const r of s.records){if(!r||typeof r.id!=='string'||ids.has(r.id)||typeof r.title!=='string'||!r.title.trim()||r.title.length>150||typeof r.subject!=='string'||!validDate(r.date)||typeof r.note!=='string'||r.note.length>3000||!Array.isArray(r.tasks)||r.tasks.length>5000||!Array.isArray(r.history)||r.history.length>2000||typeof r.archived!=='boolean')throw Error('学习记录格式不正确');ids.add(r.id);if(!Array.isArray(r.cycle))throw Error('周期不正确');parseCycle(r.cycle.join(','));for(const t of r.tasks)if(typeof t.id!=='string'||!validDate(t.date)||!['base','extra'].includes(t.kind)||typeof t.done!=='boolean')throw Error('复习安排格式不正确');for(const h of r.history)if(!validDate(h.date)||!Array.isArray(h.before)||!['normal','solid','vague','forgot'].includes(h.effect)||h.before.some(t=>!validDate(t.date)||typeof t.done!=='boolean'||!['base','extra'].includes(t.kind)))throw Error('复习历史格式不正确');}for(const k of ['morning','evening'])if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.settings[k]))throw Error('提醒时间不正确');for(const k of ['morningOn','eveningOn','notifyEmpty'])if(typeof s.settings[k]!=='boolean')throw Error('提醒开关不正确');parseCycle(s.settings.customCycle);return s;}
