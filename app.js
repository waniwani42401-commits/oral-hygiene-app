
'use strict';

const APP_VERSION = 2;
const STORAGE_KEY = 'oral-hygiene-quiz-pwa-v1';
const $ = id => document.getElementById(id);
let QUESTIONS = [];
let state;
let filtered = [];
let cursor = 0;
let answerVisible = false;
let figureVisible = false;
let deferredInstallPrompt = null;
let searchTimer = null;
let toastTimer = null;

function defaultState(){
  return {
    mode:'all',category:'all',order:'number',theme:'system',search:'',
    reviewedIds:[],unknownIds:[],shuffledIds:[],currentId:1,updatedAt:''
  };
}

function storageAvailable(){
  try{localStorage.setItem('__oh_test__','1');localStorage.removeItem('__oh_test__');return true}catch(_){return false}
}

function sanitizeState(raw){
  const base=defaultState();
  if(!raw||typeof raw!=='object')return base;
  const validIds=new Set(QUESTIONS.map(q=>q.id));
  const modes=new Set(['all','unlearned','unknown','known']);
  const orders=new Set(['number','shuffle']);
  const themes=new Set(['system','light','dark']);
  const categories=new Set(['all',...QUESTIONS.map(q=>q.category)]);
  base.mode=modes.has(raw.mode)?raw.mode:'all';
  base.category=categories.has(raw.category)?raw.category:'all';
  base.order=orders.has(raw.order)?raw.order:'number';
  base.theme=themes.has(raw.theme)?raw.theme:'system';
  base.search=typeof raw.search==='string'?raw.search.slice(0,200):'';
  base.reviewedIds=Array.isArray(raw.reviewedIds)?[...new Set(raw.reviewedIds.map(Number).filter(id=>validIds.has(id)))]:[];
  base.unknownIds=Array.isArray(raw.unknownIds)?[...new Set(raw.unknownIds.map(Number).filter(id=>validIds.has(id)))]:[];
  base.shuffledIds=Array.isArray(raw.shuffledIds)?raw.shuffledIds.map(Number).filter(id=>validIds.has(id)):[];
  base.currentId=validIds.has(Number(raw.currentId))?Number(raw.currentId):1;
  base.updatedAt=typeof raw.updatedAt==='string'?raw.updatedAt:'';
  return base;
}

function loadState(){
  if(!storageAvailable())return defaultState();
  try{return sanitizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'))}catch(_){return defaultState()}
}

function persist(message=''){
  state.updatedAt=new Date().toISOString();
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state))}catch(_){showStorageNotice()}
  updateSavedAt();
  if(message)toast(message);
}

function reviewedSet(){return new Set(state.reviewedIds)}
function unknownSet(){return new Set(state.unknownIds)}
function knownSet(){const r=reviewedSet(),u=unknownSet();return new Set([...r].filter(id=>!u.has(id)))}
function saveSet(key,set){state[key]=[...set].sort((a,b)=>a-b)}

function initControls(){
  const categories=[...new Set(QUESTIONS.map(q=>q.category))];
  for(const category of categories){
    const option=document.createElement('option');option.value=category;option.textContent=category;$('category').append(option);
  }
  $('mode').value=state.mode;$('category').value=state.category;$('order').value=state.order;$('theme').value=state.theme;$('search').value=state.search;
  applyTheme();
}

function applyTheme(){document.documentElement.dataset.theme=state.theme}

function fisherYates(ids){
  const arr=[...ids];
  for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]}
  return arr;
}

function questionMatches(q){
  const reviewed=reviewedSet(),unknown=unknownSet();
  if(state.mode==='unlearned'&&reviewed.has(q.id))return false;
  if(state.mode==='unknown'&&!unknown.has(q.id))return false;
  if(state.mode==='known'&&(!reviewed.has(q.id)||unknown.has(q.id)))return false;
  if(state.category!=='all'&&q.category!==state.category)return false;
  const term=state.search.trim().toLocaleLowerCase('ja');
  if(term){
    const hay=`${q.id} ${q.category} ${q.question} ${q.answer}`.toLocaleLowerCase('ja');
    if(!hay.includes(term))return false;
  }
  return true;
}

function refreshFiltered(tryCurrent=true){
  let list=QUESTIONS.filter(questionMatches);
  if(state.order==='shuffle'){
    const ids=list.map(q=>q.id);
    const idSet=new Set(ids);
    let order=state.shuffledIds.filter(id=>idSet.has(id));
    for(const id of ids)if(!order.includes(id))order.push(id);
    if(!state.shuffledIds.length||order.length!==ids.length)order=fisherYates(ids);
    state.shuffledIds=order;
    const byId=new Map(list.map(q=>[q.id,q]));
    list=order.map(id=>byId.get(id)).filter(Boolean);
  }else list.sort((a,b)=>a.id-b.id);
  filtered=list;
  if(!filtered.length){cursor=0;render();persist();return}
  const targetId=tryCurrent?state.currentId:(current()?.id||state.currentId);
  const found=filtered.findIndex(q=>q.id===targetId);
  cursor=found>=0?found:Math.min(cursor,filtered.length-1);
  if(cursor<0)cursor=0;
  state.currentId=filtered[cursor].id;
  answerVisible=false;
  figureVisible=false;
  render();persist();
}

function current(){return filtered[cursor]||null}

function makeBadge(text,cls=''){
  const span=document.createElement('span');span.className=`badge ${cls}`.trim();span.textContent=text;$('badges').append(span);
}

function showFigureLoadError(fig, wrap){
  const error=document.createElement('div');
  error.className='figure-error';
  error.textContent=`画像を読み込めませんでした（${fig.src}）。GitHubに assets/figures フォルダが同じ階層でアップロードされているか確認してください。`;
  wrap.replaceChildren(error);
}

function renderFigures(q){
  const panel=$('figurePanel'),list=$('figureList');
  list.replaceChildren();
  if(!q.figures||!q.figures.length){panel.hidden=true;return}
  panel.hidden=false;
  panel.classList.toggle('figure-collapsed',!figureVisible);
  $('toggleFigures').textContent=figureVisible?'図・表を隠す':'図・表を表示';
  $('toggleFigures').setAttribute('aria-expanded',String(figureVisible));
  if(!figureVisible)return;
  for(const fig of q.figures){
    const wrap=document.createElement('figure');wrap.className='figure-item';
    const button=document.createElement('button');button.type='button';button.className='figure-button';button.setAttribute('aria-label',`${fig.caption}を拡大`);
    const img=document.createElement('img');img.src=fig.src;img.alt=fig.caption;img.loading='eager';img.decoding='async';
    img.addEventListener('error',()=>showFigureLoadError(fig,wrap),{once:true});
    button.append(img);button.addEventListener('click',()=>openImage(fig));
    const cap=document.createElement('figcaption');cap.textContent=`${fig.caption}（タップで拡大）`;
    wrap.append(button,cap);list.append(wrap);
  }
}

function render(){
  const q=current();
  const has=Boolean(q);
  $('studyCard').hidden=!has;$('emptyCard').hidden=has;$('prevButton').disabled=!has;$('nextButton').disabled=!has;
  if(!has){
    $('position').textContent='0 / 0';$('filterCount').textContent='0問を表示';updateStats();return;
  }
  state.currentId=q.id;
  $('badges').replaceChildren();makeBadge(q.category);
  const reviewed=reviewedSet(),unknown=unknownSet();
  if(unknown.has(q.id))makeBadge('復習対象','unknown');else if(reviewed.has(q.id))makeBadge('わかった','known');else makeBadge('未学習');
  $('questionNumber').textContent=`問${q.id} / ${QUESTIONS.length}`;
  $('questionText').textContent=q.question;
  $('answerText').textContent=q.answer;
  $('answerArea').hidden=!answerVisible;$('revealWrap').hidden=answerVisible;
  renderFigures(q);
  $('position').textContent=`${cursor+1} / ${filtered.length}`;
  updateStats();
}

function reveal(){answerVisible=true;render()}
function move(step){
  if(!filtered.length)return;
  cursor=(cursor+step+filtered.length)%filtered.length;state.currentId=filtered[cursor].id;answerVisible=false;figureVisible=false;render();persist();window.scrollTo({top:0,behavior:'smooth'});
}

function mark(isUnknown){
  const q=current();if(!q)return;
  const reviewed=reviewedSet(),unknown=unknownSet();reviewed.add(q.id);
  if(isUnknown)unknown.add(q.id);else unknown.delete(q.id);
  saveSet('reviewedIds',reviewed);saveSet('unknownIds',unknown);
  persist(isUnknown?'復習対象に保存しました':'「わかった」に更新しました');
  if((state.mode==='unknown'&&!isUnknown)||(state.mode==='known'&&isUnknown)||(state.mode==='unlearned'))refreshFiltered(false);else move(1);
}

function updateStats(){
  const reviewed=reviewedSet(),unknown=unknownSet(),known=knownSet();
  $('totalCount').textContent=QUESTIONS.length;$('reviewedCount').textContent=reviewed.size;$('unknownCount').textContent=unknown.size;$('knownCount').textContent=known.size;
  const pct=QUESTIONS.length?Math.round(reviewed.size/QUESTIONS.length*100):0;
  $('progressBar').style.width=`${pct}%`;$('progressLabel').textContent=`学習済み ${pct}%`;$('filterCount').textContent=`${filtered.length}問を表示`;
  updateSavedAt();
}

function updateSavedAt(){
  $('savedAt').textContent=state.updatedAt?`自動保存 ${new Date(state.updatedAt).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`:'自動保存ON';
}

function showStorageNotice(){
  if(storageAvailable())return;
  const n=$('storageNotice');n.hidden=false;n.textContent='この環境では学習状況を保存できません。固定URLをSafariで開いて使用してください。';
}

function setControl(key,value){
  state[key]=value;
  if(key==='order'&&value==='shuffle')state.shuffledIds=[];
  if(key==='theme')applyTheme();
  persist('設定を保存しました');refreshFiltered(false);
}

function reshuffle(){state.shuffledIds=[];if(state.order!=='shuffle'){$('order').value='shuffle';state.order='shuffle'}refreshFiltered(false);persist('並びをシャッフルしました')}
function clearSearch(){$('search').value='';state.search='';refreshFiltered(false);persist('検索を解除しました')}

function exportData(){
  const payload={app:'口腔衛生学 暗記アプリ',version:APP_VERSION,questionCount:QUESTIONS.length,exportedAt:new Date().toISOString(),state:sanitizeState(state)};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`口腔衛生学_学習データ_${new Date().toISOString().slice(0,10)}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('バックアップを書き出しました');
}

function importData(file){
  if(!file)return;const reader=new FileReader();
  reader.onload=()=>{try{const data=JSON.parse(String(reader.result));state=sanitizeState(data.state||data);syncControls();persist('バックアップを読み込みました');refreshFiltered(true)}catch(_){alert('この学習データは読み込めませんでした。')}finally{$('importFile').value=''}};reader.readAsText(file);
}

function syncControls(){$('mode').value=state.mode;$('category').value=state.category;$('order').value=state.order;$('theme').value=state.theme;$('search').value=state.search;applyTheme()}
function resetUnknown(){if(!confirm('「分からなかった」の記録をすべて消しますか？'))return;state.unknownIds=[];persist('復習対象をリセットしました');refreshFiltered(false)}
function resetAll(){if(!confirm('学習状況と設定をすべて初期化しますか？\nこの操作は元に戻せません。'))return;state=defaultState();try{localStorage.removeItem(STORAGE_KEY)}catch(_){}syncControls();refreshFiltered(true);persist('すべて初期化しました')}

function openImage(fig){
  $('dialogImage').src=fig.src;$('dialogImage').alt=fig.caption;$('dialogCaption').textContent=fig.caption;
  const d=$('imageDialog');if(typeof d.showModal==='function')d.showModal();
}
function closeImage(){const d=$('imageDialog');if(d.open)d.close()}

function toast(text){const el=$('toast');el.textContent=text;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),1700)}

function bind(){
  $('revealButton').addEventListener('click',reveal);$('knownButton').addEventListener('click',()=>mark(false));$('unknownButton').addEventListener('click',()=>mark(true));
  $('prevButton').addEventListener('click',()=>move(-1));$('nextButton').addEventListener('click',()=>move(1));
  $('mode').addEventListener('change',e=>setControl('mode',e.target.value));$('category').addEventListener('change',e=>setControl('category',e.target.value));$('order').addEventListener('change',e=>setControl('order',e.target.value));$('theme').addEventListener('change',e=>setControl('theme',e.target.value));
  $('search').addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.search=e.target.value;persist();refreshFiltered(false)},180)});
  $('clearSearch').addEventListener('click',clearSearch);$('reshuffle').addEventListener('click',reshuffle);
  $('showAllButton').addEventListener('click',()=>{$('mode').value='all';state.mode='all';$('category').value='all';state.category='all';state.search='';$('search').value='';refreshFiltered(false)});
  $('toggleFigures').addEventListener('click',()=>{figureVisible=!figureVisible;render()});
  $('exportButton').addEventListener('click',exportData);$('importFile').addEventListener('change',e=>importData(e.target.files&&e.target.files[0]));$('resetUnknownButton').addEventListener('click',resetUnknown);$('resetAllButton').addEventListener('click',resetAll);
  $('closeDialog').addEventListener('click',closeImage);$('imageDialog').addEventListener('click',e=>{if(e.target===$('imageDialog'))closeImage()});
  document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;if(e.key===' '&&!answerVisible){e.preventDefault();reveal()}else if(e.key==='ArrowRight')move(1);else if(e.key==='ArrowLeft')move(-1);else if(answerVisible&&e.key.toLowerCase()==='w')mark(false);else if(answerVisible&&e.key.toLowerCase()==='x')mark(true);else if(e.key==='Escape')closeImage()});
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;$('installButton').hidden=false});
  $('installButton').addEventListener('click',async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$('installButton').hidden=true});
}

async function registerServiceWorker(){
  if('serviceWorker' in navigator&&location.protocol.startsWith('http')){try{await navigator.serviceWorker.register('./sw.js')}catch(e){console.warn('Service Worker registration failed',e)}}
}

function fatal(error){console.error(error);$('fatal').hidden=false;$('fatal').textContent=`アプリの読み込みに失敗しました。\n${error?.message||String(error)}`;$('app').hidden=true}

function init(){
  try{
    QUESTIONS=JSON.parse($('questionData').textContent);
    if(!Array.isArray(QUESTIONS)||QUESTIONS.length!==491)throw new Error('問題データが正しくありません');
    state=loadState();initControls();bind();showStorageNotice();refreshFiltered(true);registerServiceWorker();
  }catch(e){fatal(e)}
}

document.addEventListener('DOMContentLoaded',init);
