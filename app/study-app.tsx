'use client';
import React, { useEffect,useRef,useState, type KeyboardEvent } from 'react';
import { BookOpen,Plus,Check,Search,Settings,ArrowUpRight,RotateCcw,CalendarDays,Sun,Download,Upload,Archive,ChevronRight,Leaf,RefreshCw,X,Pause } from 'lucide-react';
import { PRESETS,emptyState,today,shift,parseCycle,createRecord,dueTasks,nextDate,complete,undo,postpone,pauseToday,resumeToday,validateState } from '../lib/review.mjs';
import { cycleLevel, studyTimeline } from '../lib/study-timeline.mjs';
type Rec={id:string;title:string;subject:string;date:string;note:string;cycle:string[];tasks:any[];history:any[];archived:boolean};type Data={schema:number;subjects:string[];records:Rec[];settings:any;lastPauseDate?:string;pauseUndo?:unknown[]};
const pretty=(v:string)=>v.replace(/d$/,'天').replace(/m$/,'个月');
type TimelineRow = {date:string; learned:Rec[]; reviews:{record:Rec; completed:boolean}[]};
const cycleLabels: Record<string,string> = {short:'短间隔', medium:'中间隔', long:'长间隔', custom:'自定义'};
const HISTORY_PAGE_SIZE = 30;
const historyTabs = [
  {key:'past', label:'今天及过去'},
  {key:'future', label:'未来复习'},
] as const;
type HistoryTab = typeof historyTabs[number]['key'];
const effectNames:Record<string,string>={normal:'完成复习',solid:'记得牢',vague:'有点模糊',forgot:'基本忘了'};
export default function StudyApp(){
 const [data,setData]=useState<Data|null>(null),[version,setVersion]=useState(0),[sync,setSync]=useState('正在连接'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState('');
 const [page,setPage]=useState('today'),[mobileTab,setMobileTab]=useState('review'),[day,setDay]=useState(today()),[title,setTitle]=useState(''),[subject,setSubject]=useState('数据结构'),[date,setDate]=useState(today()),[note,setNote]=useState(''),[preset,setPreset]=useState('medium'),[custom,setCustom]=useState('7d,14d,30d,3m,6m');
 const [filter,setFilter]=useState('全部科目'),[query,setQuery]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[expanded,setExpanded]=useState<string|null>(null),[effectId,setEffectId]=useState<string|null>(null),[editing,setEditing]=useState<Rec|null>(null),[showArchived,setShowArchived]=useState(false);
 const [historyTab,setHistoryTab] = useState<HistoryTab>('past');
 const [timelineLimit,setTimelineLimit] = useState({past:HISTORY_PAGE_SIZE, future:HISTORY_PAGE_SIZE});
 const [newSubject,setNewSubject]=useState('');
 const lock=useRef(false),inputRef=useRef<HTMLInputElement>(null),fileRef=useRef<HTMLInputElement>(null),dataRef=useRef<Data|null>(null),versionRef=useRef(0);
 function install(s:Data,v:number){dataRef.current=s;versionRef.current=v;setData(s);setVersion(v);}
 async function load(quiet=false){if(lock.current)return;try{const r=await fetch('/api/state',{cache:'no-store'});if(r.status===401){setError('登录已过期，请重新登录');setSync('需要登录');return;}if(!r.ok)throw Error('无法连接服务器');const p:any=await r.json();if(!lock.current&&(!dataRef.current||p.version>versionRef.current))install(p.state,p.version);setSync('已同步');if(!quiet)setError('');}catch{setSync('连接中断');if(!quiet)setError('暂时无法连接。请恢复网络后重试，已有数据仍保存在服务器。');}}
 useEffect(()=>{load();const timer=setInterval(()=>{setDay(today());if(document.visibilityState==='visible')load(true);},15000);const focus=()=>{setDay(today());load(true);};window.addEventListener('focus',focus);return()=>{clearInterval(timer);window.removeEventListener('focus',focus);};},[]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(t);},[toast]);
 async function mutate(fn:(s:Data)=>void,message='已保存并同步'){
 if(lock.current||!dataRef.current)return false;lock.current=true;setBusy(true);setError('');setSync('正在保存');
 try{const next=structuredClone(dataRef.current);fn(next);validateState(next);const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:versionRef.current,state:next})});const p:any=await r.json();if(!r.ok)throw Error(p.error||'保存失败');install(next,p.version);setSync('已同步');setToast(message);return true;}catch(e){setSync('未保存');setError(e instanceof Error?e.message:'保存失败');return false;}finally{lock.current=false;setBusy(false);}
 }
 if(!data)return <main className="loading"><div className="brand-icon"><BookOpen size={26}/></div><h1>温故</h1><p>{error||'正在取回你的学习记录…'}</p>{error&&<><button onClick={()=>load()}>重新连接</button><a href="/login" target="_top">重新登录</a></>}</main>;
 const records=data.records as Rec[],active=records.filter(r=>!r.archived),due=active.filter(r=>dueTasks(r,day).length).sort((a,b)=>(nextDate(a)||'').localeCompare(nextDate(b)||'')),done=active.filter(r=>r.history.some((h:any)=>h.date===day)),added=records.filter(r=>r.date===day),total=due.length+done.length,progress=total?Math.round(done.length/total*100):0;
 const shownDue=due.filter(r=>filter==='全部科目'||r.subject===filter);
 const pausedToday = data.lastPauseDate === day;
 const canResume = pausedToday && !!data.pauseUndo?.length;
 const hasUpcoming = active.some(record => record.tasks.some(task => !task.done && task.date >= day));

 async function pauseSchedule() {
   if (!confirm('将所有科目中，今天及以后的未完成任务顺延一天。此前逾期的任务和已完成的记录照常保留。确定暂停今天的复习安排吗？')) return;
   await mutate(state => {
     if (today() !== day) throw Error('日期已切换，请刷新后再试');
     if (!pauseToday(state, day)) throw Error('今天已暂停，或没有可顺延的任务');
   }, '今天及以后的未完成任务已顺延一天');
 }

 async function resumeSchedule() {
   await mutate(state => {
     if (today() !== day) throw Error('日期已切换，请刷新后再试');
     if (!resumeToday(state, day)) throw Error('找不到今天的暂停记录');
   }, '已取消暂停，复习日期已恢复');
 }

 let cycle:string[]=[];try{cycle=preset==='custom'?parseCycle(custom):PRESETS[preset as keyof typeof PRESETS];}catch{}
 const filtered = page === 'history' ? records.filter(record =>
   (showArchived || !record.archived) &&
   (filter === '全部科目' || record.subject === filter) &&
   (!query || `${record.title} ${record.note}`.toLowerCase().includes(query.trim().toLowerCase()))
 ) : [];
 const timeline: TimelineRow[] = studyTimeline(filtered, {from, to});
 const future = historyTab === 'future';
 const timelineRows = timeline
   .filter(row => future ? row.date > day : row.date <= day)
   .sort((a,b) => future ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));

 function handleHistoryTabKey(event:KeyboardEvent<HTMLButtonElement>, tab:HistoryTab) {
   let next:HistoryTab;
   switch (event.key) {
     case 'ArrowLeft':
     case 'ArrowRight':
       next = tab === 'past' ? 'future' : 'past';
       break;
     case 'Home':
       next = 'past';
       break;
     case 'End':
       next = 'future';
       break;
     default:
       return;
   }
   event.preventDefault();
   setHistoryTab(next);
   event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('#history-tab-' + next)?.focus();
 }

 async function add(e:React.FormEvent){e.preventDefault();try{const record=createRecord({title,subject,date,cycle:preset==='custom'?parseCycle(custom):cycle,note});if(await mutate(s=>{s.records.unshift(record);if(preset==='custom')s.settings.customCycle=custom;},'已记录，复习日期已安排')){setTitle('');setNote('');inputRef.current?.focus();}}catch(e){setError((e as Error).message);}}
 async function mark(id:string,effect='normal'){if(await mutate(s=>{complete(s.records.find((r:Rec)=>r.id===id),day,effect);},effect==='forgot'?'已完成，增加第1、3、7天加强复习':effect==='vague'?'已完成，增加第3天加强复习':'复习完成，继续原定周期'))setEffectId(null);}
 function exportBackup(){const blob=new Blob([JSON.stringify({app:'温故',exportedAt:new Date().toISOString(),state:data},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`温故备份_${day}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);localStorage.setItem('wengu-backup',new Date().toISOString());setToast('备份已导出，请妥善保存');}
 async function importBackup(file:File){try{if(file.size>8_000_000)throw Error('文件超过8MB');const p=JSON.parse(await file.text()),state=validateState(p.state||p);if(!confirm(`将合并导入 ${state.records.length} 条记录。同一ID使用备份中的版本，当前其他记录保留。建议先导出当前备份。是否继续？`))return;await mutate(s=>{const map=new Map(s.records.map((r:Rec)=>[r.id,r]));state.records.forEach((r:Rec)=>map.set(r.id,r));s.records=[...map.values()];s.subjects=[...new Set([...s.subjects,...state.subjects])];},'学习记录已合并恢复');}catch(e){setError((e as Error).message);}}
 async function deleteArchived(record: Rec) {
  if (!confirm(`永久删除「${record.title}」及其复习安排和历史？`)) return;
  if (await mutate(state => {
   state.records = state.records.filter(item => item.id !== record.id);
   if (state.pauseUndo) {
    state.pauseUndo = state.pauseUndo.filter((change: any) => change.recordId !== record.id);
    if (state.pauseUndo.length === 0) {
     delete state.pauseUndo;
     delete state.lastPauseDate;
    }
   }
  }, '已永久删除记录')) setExpanded(null);
 }
 function recordCard(r:Rec, isDue=false, timelineKey?:string, status?:string) {
  const tasks = dueTasks(r, day);
  const overdue = tasks.some((task:any) => task.date < day);
  const next = nextDate(r);
  const cardKey = timelineKey ?? r.id;
  const open = expanded === cardKey;
  const level = cycleLevel(r.cycle);
  const tags = <>
    <span className="tag" data-subject={r.subject}>{r.subject}</span>
    {!timelineKey && <span className="cycle-badge" data-cycle={level}>{cycleLabels[level]}</span>}
    {status && <span className={status==='已逾期'?'pill overdue':'pill'}>{status}</span>}
    {isDue && <span className={overdue?'pill overdue':'pill'}>{overdue?'已逾期':'今日到期'}</span>}
    {isDue && tasks.some((task:any)=>task.kind==='extra') && <span className="pill reinforcement">加强复习</span>}
    {r.archived && <span className="pill">已归档</span>}
  </>;
  return <article className={`record ${isDue?'due-record':''}`} key={cardKey}>
   <div className="record-main">
    {isDue && <button className="check-circle" disabled={busy} aria-label={`完成复习：${r.title}`} onClick={()=>mark(r.id)}><Check size={16}/></button>}
    <div className="record-info">
     {!timelineKey && <div className="record-heading">{tags}</div>}
     <button className="record-title" data-cycle={level} aria-expanded={open} onClick={()=>setExpanded(open?null:cardKey)}>
      <span className="record-name">{r.title}</span>
      {timelineKey && <span className="timeline-record-tags">{tags}</span>}
      <ChevronRight size={15} className={open?'rotated':''}/>
     </button>
     {(!timelineKey || open) && <div className="meta">学习于 {r.date}{isDue?` · 原定 ${next}`:` · ${next?'下次 '+next:'本轮已完成'}`}</div>}
     {r.note && (!timelineKey || open) && <p className="note">{r.note}</p>}
    </div>
   </div>
  {isDue&&<div className="record-actions"><button className="text-button" disabled={busy} onClick={()=>setEffectId(effectId===r.id?null:r.id)}>完成并评价 <ChevronRight size={13}/></button><button className="muted-button" disabled={busy} onClick={()=>mutate(s=>postpone(s.records.find((x:Rec)=>x.id===r.id),day),'已推迟到明天，未计为完成')}>明天再复习</button></div>}
  {effectId===r.id&&<div className="effect-options">{[['solid','记得牢','继续原计划'],['vague','有点模糊','加第3天'],['forgot','基本忘了','加第1 / 3 / 7天']].map(([v,label,desc])=><button disabled={busy} key={v} onClick={()=>mark(r.id,v)}><strong>{label}</strong><small>{desc}</small></button>)}</div>}
  {open&&<div className="record-details"><div className="meta">原定周期：{r.cycle.map(pretty).join(' · ')}</div><div className="dates">{[...new Set(r.tasks.filter((t:any)=>!t.done).map((t:any)=>t.date))].sort().map(d=><span key={String(d)}>{String(d)}</span>)}</div><h4>复习记录</h4>{r.history.length?r.history.slice().reverse().map((h:any)=><div className="history-row" key={h.id}><span>{h.date}</span><span>{effectNames[h.effect]}</span></div>):<p className="meta">还没有完成过复习</p>}<div className="inline-actions"><button onClick={()=>setEditing(structuredClone(r))}>编辑记录</button><button disabled={busy} onClick={()=>mutate(s=>{const x=s.records.find((x:Rec)=>x.id===r.id)!;x.archived=!x.archived;},r.archived?'已恢复复习安排':'已归档，不再出现在复习列表')}>{r.archived?'恢复':'归档'}</button>{!!r.history.length&&<button disabled={busy} onClick={()=>mutate(s=>undo(s.records.find((x:Rec)=>x.id===r.id)),'已撤销上一次复习')}>撤销上次复习</button>}{r.archived&&<button disabled={busy} onClick={()=>deleteArchived(r)}>永久删除</button>}</div></div>}
 </article>;}
 return <div className="app-shell"><aside className="sidebar"><a className="brand" href="/"><div className="brand-icon"><BookOpen size={24}/></div><span>温故</span></a><nav>{[['today','今日学习',CalendarDays],['history','学习记录',Search],['settings','设置',Settings]].map(([id,label,Icon]:any)=><button className={page===id?'active':''} key={id} onClick={()=>{setPage(id);setFilter('全部科目');}}><Icon size={19}/>{label}{id==='today'&&due.length>0&&<span>{due.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="sync"><i className={sync==='已同步'?'online':''}/>{sync}<button aria-label="刷新数据库数据" disabled={busy} onClick={()=>load()}><RefreshCw size={12}/></button></div></div></aside>
 <main className="main"><header className="topbar"><div className="top-right"><span><CalendarDays size={14}/>{day.replaceAll('-',' / ')}</span><div className="avatar">研</div></div></header>
 {error&&<div className="error-banner" role="alert">{error}<button disabled={busy} onClick={()=>load()}>刷新数据库</button><button aria-label="关闭提示" onClick={()=>setError('')}><X size={16}/></button></div>}
 {page==='today'&&<><section className="page-intro"><div><h1>今日学习</h1></div></section>
 <section className="stats"><div><span>今日新学</span><strong>{added.length}<small>个知识点</small></strong><Plus size={18}/></div><div><span>待复习</span><strong>{due.length}<small>个知识点</small></strong><BookOpen size={18}/></div><div><span>今日已完成</span><strong>{done.length}<small>/ {total} 项</small></strong><Check size={18}/></div><div className="progress-stat"><span>今日复习进度</span><strong>{progress}<small>%</small></strong><div className="progress-track"><i style={{width:`${progress}%`}}/></div></div></section>
 <div className="mobile-switch"><button className={mobileTab==='review'?'active':''} onClick={()=>setMobileTab('review')}>待复习 {due.length}</button><button className={mobileTab==='add'?'active':''} onClick={()=>setMobileTab('add')}>记录学习</button></div>
 <div className="workspace"><section className={`panel add-panel ${mobileTab==='add'?'mobile-visible':''}`}><div className="panel-heading"><div className="heading-icon"><Plus size={19}/></div><div><h2>新增学习记录</h2></div></div><form onSubmit={add}><label>知识点名称<span className="required"> *</span><input autoComplete="off" ref={inputRef} value={title} maxLength={150} onChange={e=>setTitle(e.target.value)} placeholder="例如：时间复杂度" required/></label><div className="two-fields"><label>所属科目<select value={subject} onChange={e=>setSubject(e.target.value)}>{data.subjects.map((s:string)=><option key={s}>{s}</option>)}</select></label><label>学习日期<input aria-label="学习日期" type="date" value={date} max={day} onInput={e=>setDate(e.currentTarget.value)} onChange={e=>setDate(e.target.value)} required/></label></div><label>复习周期</label><div className="cycle-options">{[['short','短间隔','容易忘的内容'],['medium','中间隔','一般掌握'],['long','长间隔','掌握较好'],['custom','自定义','自己安排']].map(([id,name,desc])=><button type="button" className={preset===id?'selected':''} key={id} onClick={()=>{setPreset(id);if(id==='custom'&&custom==='7d,14d,30d,3m,6m')setCustom(data.settings.customCycle);}}><strong>{name}</strong><small>{desc}</small>{preset===id&&<Check size={13}/>}</button>)}</div>{preset==='custom'&&<label className="custom-input"><input aria-label="自定义周期" value={custom} onChange={e=>setCustom(e.target.value)} placeholder="7d,14d,30d,3m,6m"/><small>d代表天，m代表日历月；用逗号分隔。</small></label>}<div className="schedule-preview"><span>复习安排 <small>从学习日期起</small></span><div>{cycle.length?cycle.map((o:string)=><span key={o} title={date?shift(date,o):''}>{pretty(o)}</span>):<small>请填写有效周期</small>}</div><details><summary>查看具体日期</summary><p>{cycle.map((o:string)=>{try{return `${pretty(o)}：${shift(date,o)}`;}catch{return '';}}).join('　')}</p></details></div><label>备注 <span className="optional">选填</span><textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={3000} placeholder="选填：重难点或复习注意事项" rows={3}/></label><button className="primary wide" type="submit" disabled={busy||!cycle.length}><Plus size={17}/>{busy?'正在保存…':'记录并安排复习'}</button></form>{added.length>0&&<div className="today-added"><h3>今日已记录 <span>{added.length}</span></h3>{added.slice(0,4).map(r=><div key={r.id}><span className="dot"/><span className="topic-title" data-cycle={cycleLevel(r.cycle)}>{r.title}</span><small className="tag" data-subject={r.subject}>{r.subject}</small></div>)}</div>}</section>
 <section className={`panel review-panel ${mobileTab==='review'?'mobile-visible':''}`}><div className="panel-heading"><div className="heading-icon warm"><BookOpen size={19}/></div><div><h2>待复习 <span className="count">{due.length}</span></h2><p>勾选即完成，评价可以不填。</p></div><button className="pause-review" disabled={busy || (pausedToday ? !canResume : !hasUpcoming)} onClick={canResume ? resumeSchedule : pauseSchedule}>{canResume ? <RotateCcw size={14}/> : <Pause size={14}/>} {canResume ? "取消暂停" : pausedToday ? "今日已暂停" : "今日暂停"}</button></div>{pausedToday&&!canResume&&<p className="pause-note">此次暂停发生在更新前，无法自动恢复原日期。</p>}<div className="review-toolbar"><span>{due.some(r=>dueTasks(r,day).some((t:any)=>t.date<day))?'逾期优先 · 已合并重复任务':'按复习日期排序'}</span><select aria-label="按科目筛选复习" value={filter} onChange={e=>setFilter(e.target.value)}><option>全部科目</option>{data.subjects.map((s:string)=><option key={s}>{s}</option>)}</select></div><div className="review-list">{shownDue.length?shownDue.map(r=>recordCard(r,true)):<div className="empty-state"><h3>{due.length?'此科目暂无待复习任务':'暂无待复习任务'}</h3>{!active.length&&<button className="text-button" onClick={()=>{setMobileTab('add');inputRef.current?.focus();}}>记录第一个知识点 <ArrowUpRight size={15}/></button>}</div>}</div>{done.length>0&&<details className="completed-list"><summary><Check size={15}/> 今日已完成 {done.length} 项</summary>{done.map(r=><div key={r.id}><span className="topic-title" data-cycle={cycleLevel(r.cycle)}>{r.title}<small>{effectNames[r.history.filter((h:any)=>h.date===day).at(-1)?.effect||'normal']}</small></span><button disabled={busy} onClick={()=>mutate(s=>undo(s.records.find((x:Rec)=>x.id===r.id)),'已撤销复习')}><RotateCcw size={13}/>撤销</button></div>)}</details>}</section></div>
 <section className="week-panel"><div><h3>未来7天</h3></div><div className="week-days">{Array.from({length:7},(_,i)=>shift(day,`${i+1}d`)).map(d=>{const n=active.filter(r=>r.tasks.some((t:any)=>!t.done&&t.date===d)).length;return <div key={d}><small>{d.slice(5).replace('-','/')}</small><strong>{n}</strong><span>项复习</span></div>;})}</div></section></>}
 {page==='history'&&<><section className="page-intro"><h1>学习记录</h1></section><section className="panel history-panel"><div className="search-tools"><label className="search-field"><Search size={17}/><input aria-label="搜索知识点" placeholder="搜索知识点或备注" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="筛选科目" value={filter} onChange={e=>setFilter(e.target.value)}><option>全部科目</option>{data.subjects.map((s:string)=><option key={s}>{s}</option>)}</select><label>日期从<input aria-label="记录起始日期" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>至<input aria-label="记录结束日期" type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div><div className="history-tabs" role="tablist" aria-label="学习记录时段">
   {historyTabs.map(tab => (
     <button key={tab.key} type="button" role="tab" id={`history-tab-${tab.key}`}
       aria-selected={historyTab===tab.key} aria-controls={`history-panel-${tab.key}`}
       tabIndex={historyTab===tab.key?0:-1} onClick={()=>setHistoryTab(tab.key)}
       onKeyDown={event=>handleHistoryTabKey(event,tab.key)}>
       {tab.label}
     </button>
   ))}
 </div><div className="history-caption"><span>共 {timelineRows.length} 天</span><label><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/>包含已归档</label></div>{historyTabs.map(tab => (
   <div key={tab.key} id={`history-panel-${tab.key}`} role="tabpanel"
     aria-labelledby={`history-tab-${tab.key}`} tabIndex={0}
     hidden={historyTab!==tab.key} className="study-timeline">
     {historyTab===tab.key && (timelineRows.length ? <>
       <div className="timeline-row timeline-columns" aria-hidden="true">
         <span>日期</span><span>学习内容</span><span>复习内容</span>
       </div>
       {timelineRows.slice(0, timelineLimit[tab.key]).map(row => (
         <article className="timeline-row" key={row.date}>
           <h3><time dateTime={row.date}>{row.date}</time>{row.date===day && <span className="pill">今天</span>}</h3>
           <section className="timeline-cell" aria-label="学习内容">
             <h4>学习内容</h4>
             {row.learned.length ? row.learned.map(record => recordCard(record, false, `${row.date}:learn:${record.id}`)) : <span className="timeline-empty">无</span>}
           </section>
           <section className="timeline-cell" aria-label="复习内容">
             <h4>复习内容</h4>
             {row.reviews.length ? row.reviews.map(({record, completed}) => recordCard(record, false, `${row.date}:review:${record.id}`, completed ? '已完成' : row.date < day ? '已逾期' : '待复习')) : <span className="timeline-empty">无</span>}
           </section>
         </article>
       ))}
       {timelineRows.length > timelineLimit[tab.key] && <button className="timeline-more" onClick={()=>setTimelineLimit(previous=>({...previous,[tab.key]:previous[tab.key]+HISTORY_PAGE_SIZE}))}>显示更多日期</button>}
     </> : <div className="empty-state"><Search size={36}/><h3>{future?'没有符合条件的未来复习':'还没有符合条件的记录'}</h3></div>)}
   </div>
 ))}</section></>}
 {page==='settings'&&<><section className="page-intro"><h1>设置</h1></section><div className="settings-grid">
 <section className="panel settings-panel"><h2><Archive size={20}/>备份与恢复</h2><p>导出学习记录、复习安排和历史；建议每周备份。</p><div className="backup-count"><strong>{records.length}</strong><span>条学习记录，包含复习历史与安排</span></div><div className="inline-actions"><button className="primary" onClick={exportBackup}><Download size={16}/>导出完整备份</button><button onClick={()=>fileRef.current?.click()} disabled={busy}><Upload size={16}/>导入备份</button></div><input hidden type="file" accept=".json,application/json" ref={fileRef} onChange={e=>{if(e.target.files?.[0])importBackup(e.target.files[0]);e.target.value='';}}/><p className="tiny">导入采用合并方式；同一ID使用备份版本，不会删除当前其他记录。备份包含备注，请自行保管。</p></section>
 <section className="panel settings-panel"><h2><Plus size={20}/>科目管理</h2><div className="subject-chips">{data.subjects.map((s:string)=><span className="tag" data-subject={s} key={s}>{s}</span>)}</div><form className="inline-actions" onSubmit={async e=>{e.preventDefault();const name=newSubject.trim();if(!name||data.subjects.includes(name)){setError('科目名称为空或已存在');return;}if(await mutate(s=>s.subjects.push(name),'科目已添加'))setNewSubject('');}}><input aria-label="自定义科目" placeholder="输入自定义科目" maxLength={50} value={newSubject} onChange={e=>setNewSubject(e.target.value)}/><button disabled={busy}>添加</button></form></section><section className="panel settings-panel"><h2><BookOpen size={20}/>复习规则</h2><p>周期从最初学习日期计算；日历月遇到月底取目标月最后一天。</p><ul className="rules"><li>短间隔：第1、3、7、14天，1个月、3个月、6个月。</li><li>中间隔：第1、7、14天，1个月、3个月、6个月。</li><li>长间隔：第7天，1个月、3个月、6个月。</li><li>直接打钩 / 记得牢：继续原定周期。</li><li>有点模糊：额外加第3天。</li><li>基本忘了：额外加第1、3、7天。</li><li>再次忘记：重排未完成的加强安排；记得牢：取消剩余加强安排。</li><li>同一天只复习一次；逾期保留，完成后合并清理已到期安排。</li></ul></section></div></>}
 <footer><span>北京时间 · {sync}</span></footer></main>
 {editing&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="编辑学习记录"><div className="modal-heading"><h2>编辑学习记录</h2><button aria-label="关闭编辑" onClick={()=>setEditing(null)}><X size={20}/></button></div><label>知识点<input value={editing.title} maxLength={150} onChange={e=>setEditing({...editing,title:e.target.value})}/></label><label>科目<select value={editing.subject} onChange={e=>setEditing({...editing,subject:e.target.value})}>{data.subjects.map((s:string)=><option key={s}>{s}</option>)}</select></label><label>备注<textarea rows={5} maxLength={3000} value={editing.note} onChange={e=>setEditing({...editing,note:e.target.value})}/></label><p className="tiny">学习日期 {editing.date} · 本次编辑保留已有复习安排。</p><button className="primary wide" disabled={busy} onClick={async()=>{if(await mutate(s=>{const i=s.records.findIndex((r:Rec)=>r.id===editing.id);s.records[i]={...s.records[i],title:editing.title,subject:editing.subject,note:editing.note};},'记录已更新'))setEditing(null);}}>保存修改</button></section></div>}
 {toast&&<div className="toast" role="status"><Check size={17}/>{toast}</div>}
 </div>;
}




