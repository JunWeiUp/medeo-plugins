import css from './ime.css';
import { useStyle } from './style';
import {capabilities,inputMethod,storage,permissions} from '@medeo-plugin/sdk';
import {DEFAULT_WORDS,parseWords} from './ime-worker';
export async function mountInputMethod(persist=false){
 useStyle(css);
 const main=document.querySelector('main')!,copy=await capabilities.labels(),t=(key:string)=>copy[key]??key;
 const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};
 main.className='ime';const header=el('header');header.append(el('small','Medeo'),el('h1',t('input_method')),el('p',t('ime_hint')));
 const system=el('section'),systemText=el('p'),setup=el('button',t('ime_setup')),remove=el('button',t('ime_remove')),settings=el('button',t('ime_settings')),reload=el('button',t('ime_refresh'));
 system.className='ime-system';systemText.dataset.testid='drive.ime.system';systemText.setAttribute('role','status');setup.dataset.testid='drive.ime.setup';remove.dataset.testid='drive.ime.remove';settings.dataset.testid='drive.ime.settings';reload.dataset.testid='drive.ime.system-refresh';remove.className='danger';
 const sourceHeading=el('div');sourceHeading.append(el('strong',t('ime_system')),systemText);const sourceActions=el('div');sourceActions.append(setup,remove,settings,reload);system.append(sourceHeading,sourceActions);
 const panel=el('section'),label=el('label',t('ime_dictionary')),editor=el('textarea');editor.spellcheck=false;editor.dataset.testid='drive.ime.dictionary';editor.value=DEFAULT_WORDS;editor.readOnly=!persist;label.append(editor);panel.append(label,el('code','nihao=你好|您好'));
 const footer=el('footer'),status=el('p'),enable=el('button',t('enable')),disable=el('button',t('disable')),save=el('button',t('agent_save'));
 status.setAttribute('role','status');status.dataset.testid='drive.ime.status';enable.className='primary';enable.dataset.testid='drive.ime.enable';disable.dataset.testid='drive.ime.disable';save.dataset.testid='drive.ime.save';footer.append(status,enable,disable);if(persist)footer.append(save);main.append(header,system,panel,footer);
 let busy=false,disposed=false;
 async function refresh(){const state=await inputMethod.status();if(disposed)return;status.textContent=t(state.enabled?'ime_provider_enabled':'ime_provider_disabled');enable.disabled=busy||state.enabled||state.occupied;disable.disabled=busy||!state.enabled;save.disabled=busy;}
 async function refreshSystem(refresh=false){const state=await inputMethod.system(refresh);if(disposed)return;systemText.textContent=t(state.state_key);setup.disabled=busy||!state.can_setup;remove.disabled=busy||!state.can_remove;settings.disabled=busy||state.status==='running'||state.status==='unavailable';reload.disabled=busy;return state;}
 async function finishOperation(result:{task?:string;cancelled?:boolean}){if(!result.task)return;for(let n=0;n<400&&!disposed;n++){const state=await refreshSystem();if(state?.last_operation?.id===result.task){if(state.last_operation.status==='failed')throw Error(state.last_operation.error??'input_source_failed');return;}await new Promise(r=>setTimeout(r,100))}if(!disposed)throw Error('input_source_pending');}
 async function action(fn:()=>Promise<unknown>){if(busy)return;busy=true;enable.disabled=disable.disabled=save.disabled=setup.disabled=remove.disabled=settings.disabled=reload.disabled=true;try{await fn();busy=false;await refresh();await refreshSystem()}catch(e){status.textContent=t('error')+' · '+String(e);busy=false;enable.disabled=disable.disabled=save.disabled=false;void refreshSystem().catch(()=>{})}}
 enable.onclick=()=>void action(async()=>{const grants=await capabilities.list();if(!grants.find(p=>p.permission==='input_method')?.granted&&!(await permissions.request('input_method',t('input_method'))).granted)return;await inputMethod.enable()});
 disable.onclick=()=>void action(()=>inputMethod.disable());save.onclick=()=>void action(async()=>{parseWords(editor.value);const grants=await capabilities.list();if(!grants.find(p=>p.permission==='storage')?.granted&&!(await permissions.request('storage',t('ime_dictionary'))).granted)return;await storage.set('dictionary',editor.value)});
 setup.onclick=()=>void action(async()=>finishOperation(await inputMethod.setup()));remove.onclick=()=>void action(async()=>finishOperation(await inputMethod.remove()));settings.onclick=()=>void action(async()=>finishOperation(await inputMethod.settings()));reload.onclick=()=>void refreshSystem(true).catch(e=>{systemText.textContent=t('error')+' · '+String(e)});
 if(persist){try{const grants=await capabilities.list();if(grants.find(p=>p.permission==='storage')?.granted){const saved=await storage.get<string>('dictionary');if(typeof saved==='string')editor.value=saved}}catch{status.textContent=t('permission_missing')}}
 try{await refresh()}catch{status.textContent=t('permission_missing');disable.disabled=true}
 try{await refreshSystem()}catch{systemText.textContent=t('ime_source_unavailable');setup.disabled=remove.disabled=settings.disabled=true}
 document.body.setAttribute('aria-busy','false');window.addEventListener('pagehide',()=>{disposed=true});
 const poll=async()=>{if(disposed)return;try{if(!busy){await refresh();await refreshSystem()}}catch{}finally{if(!disposed)setTimeout(()=>void poll(),300)}};void poll();
}
