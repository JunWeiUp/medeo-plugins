import css from './launcher.css';
import { useStyle } from './style';
import { applications, shortcuts, capabilities, permissions, type ApplicationEntry } from '@medeo-plugin/sdk';
import { Recent, search as rank } from './launcher-search.ts';
export async function mountLauncher(withShortcut=false){
 useStyle(css);
 const main=document.querySelector('main')!,copy=await capabilities.labels(),t=(key:string)=>copy[key]??key;
 const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};
 main.className='launcher';
 const header=el('header'),brand=el('small','Medeo'),title=el('h1',t('launcher_title'));header.append(brand,title);
 const toolbar=el('div'),search=el('input'),refresh=el('button',t('launcher_refresh'));toolbar.className='launcher-toolbar';
 search.type='search';search.placeholder=t('launcher_search');search.setAttribute('aria-label',t('launcher_search'));search.dataset.testid='drive.launcher.search';search.maxLength=512;refresh.dataset.testid='drive.launcher.refresh';toolbar.append(search,refresh);
 const status=el('p'),results=el('div'),footer=el('footer'),detail=el('p');
 status.setAttribute('role','status');status.dataset.testid='drive.launcher.status';results.className='launcher-results';results.setAttribute('role','listbox');results.setAttribute('aria-label',t('applications'));results.dataset.testid='drive.launcher.results';detail.className='launcher-detail';
 const grant=el('button',t('authorize'));grant.dataset.testid='drive.launcher.authorize';grant.hidden=true;footer.append(grant);
 let entries:ApplicationEntry[]=[],inventory:ApplicationEntry[]=[],selected=0,revision=0,launching=false,disposed=false;const recent=new Recent();
 async function render(force=false){
  const request=++revision;entries=[];results.replaceChildren();detail.textContent='';results.setAttribute('aria-busy','true');refresh.disabled=true;
  try{
   let snapshot=await applications.list(force);
   while(snapshot.status==='loading'&&!disposed&&request===revision){status.textContent=t('running');await new Promise(r=>setTimeout(r,200));snapshot=await applications.list()}
   if(disposed||request!==revision)return;
   if(snapshot.status==='failed')throw Error(snapshot.error??'application_adapter_failed');
   inventory=snapshot.entries;entries=rank(inventory,search.value,recent.order);selected=0;
   status.textContent=(snapshot.incomplete?t('applications_partial')+' · ':'')+snapshot.total;
   results.replaceChildren(...entries.map((entry,index)=>{
    const row=el('button');row.className='launcher-row';row.type='button';row.setAttribute('role','option');row.dataset.testid='drive.launcher.result.'+index;row.dataset.application=entry.id;
    const icon=el('span',entry.title.slice(0,1));icon.className='launcher-icon';icon.setAttribute('aria-hidden','true');
    const text=el('span'),name=el('strong',entry.title),meta=el('small',entry.bundle_id);text.append(name,meta);row.append(icon,text,el('span','↵'));
    row.onfocus=()=>select(index);row.onclick=()=>void launch(entry);return row;
   }));
   if(!entries.length)results.append(el('p',t('launcher_empty')));select(0);grant.hidden=true;
  }catch(error){if(request!==revision)return;results.replaceChildren();status.textContent=t('launcher_failed')+' · '+String(error).slice(0,180);grant.hidden=!String(error).includes('permission_denied')}
  finally{if(request===revision){results.setAttribute('aria-busy','false');refresh.disabled=false}}
 }
 function select(index:number){selected=index;const rows=results.querySelectorAll<HTMLElement>('.launcher-row');rows.forEach((r,n)=>{r.setAttribute('aria-selected',String(n===index));r.classList.toggle('selected',n===index);r.tabIndex=n===index?0:-1});detail.textContent=entries[index]?.path??'';rows[index]?.scrollIntoView({block:'nearest'})}
 async function launch(entry:ApplicationEntry){
  if(launching)return;launching=true;refresh.disabled=true;
  try{const task=await applications.launch(entry.id);status.textContent=t('running');for(;;){const state=await applications.state();if(state.launch?.id!==task.id)throw Error('application_outcome_unknown');if(state.launch.status!=='running'){if(state.launch.status!=='completed')throw Error(state.launch.error??state.launch.status);status.textContent=t('completed')+' · '+entry.title;recent.used(entry.path);break}await new Promise(r=>setTimeout(r,100));if(disposed)return}}
  catch(error){status.textContent=t('launcher_failed')+' · '+String(error).slice(0,180)}
  finally{launching=false;refresh.disabled=false}
 }
 let timer:ReturnType<typeof setTimeout>;
 search.oninput=()=>{++revision;entries=[];results.replaceChildren();clearTimeout(timer);timer=setTimeout(()=>void render(),100)};
 search.onkeydown=event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();select(Math.max(0,Math.min(entries.length-1,selected+(event.key==='ArrowDown'?1:-1))))}else if(event.key==='Enter'&&entries[selected]){event.preventDefault();void launch(entries[selected])}};
 results.onkeydown=event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();select(Math.max(0,Math.min(entries.length-1,selected+(event.key==='ArrowDown'?1:-1))));(results.children[selected] as HTMLElement|undefined)?.focus()}};
 refresh.onclick=()=>void render(true);
 grant.onclick=async()=>{await permissions.request('applications',t('launcher_title'));await render()};
 if(withShortcut){
  const label=el('label'),toggle=el('input');toggle.type='checkbox';toggle.dataset.testid='drive.launcher.shortcut';label.append(toggle,document.createTextNode(t('launcher_shortcut')));footer.append(label,el('small',t('launcher_shortcut_session')));
  try{toggle.checked=(await shortcuts.list()).some(s=>s.id==='launcher.open')}catch{toggle.checked=false}
  toggle.onchange=async()=>{toggle.disabled=true;try{if(toggle.checked){const granted=(await capabilities.list()).some(c=>c.permission==='global_shortcuts'&&c.granted);if(!granted&&!(await permissions.request('global_shortcuts',t('launcher_shortcut'))).granted){toggle.checked=false;return}await shortcuts.register('launcher.open','CommandOrControl+Shift+Space',true)}else await shortcuts.unregister('launcher.open');status.textContent=''}catch(error){toggle.checked=false;status.textContent=t(String(error).includes('shortcut_conflict')?'launcher_conflict':'error')+' · '+String(error).slice(0,120)}finally{toggle.disabled=false}};
 }
 footer.append(detail);main.append(header,toolbar,status,results,footer);
 window.addEventListener('pagehide',()=>{disposed=true;++revision;clearTimeout(timer)});
 await render();search.focus();document.body.setAttribute('aria-busy','false');
}
