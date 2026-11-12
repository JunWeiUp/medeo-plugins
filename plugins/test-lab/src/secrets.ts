import css from './panel.css';
import { useStyle } from './style';
import {capabilities,permissions,secrets} from '@medeo-plugin/sdk';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
export async function mountSecrets(){
 useStyle(css);
 const copy=await capabilities.labels(),main=document.querySelector('main')!;main.className='secrets-lab';
 const header=el('header');header.append(el('small','Medeo · '+copy.permission_lab),el('h1',copy.secrets),el('p',copy.secrets_note));main.append(header);
 const status=el('section');status.className='status';status.dataset.testid='drive.secrets.status';main.append(status);
 const fields=el('section');fields.className='secret-fields';
 const key=el('input');key.value='fixture';key.maxLength=128;key.autocomplete='off';key.spellcheck=false;key.dataset.testid='drive.secrets.key';
 const value=el('input');value.type='password';value.maxLength=16384;value.autocomplete='new-password';value.spellcheck=false;value.dataset.testid='drive.secrets.value';
 for(const [name,input] of [[copy.secrets_key,key],[copy.secrets_value,value]] as const){const label=el('label',name);label.append(input);fields.append(label)}main.append(fields);
 const actions=el('div');actions.className='origin-actions';main.append(actions);
 const result=el('pre','—');result.dataset.testid='drive.secrets.result';result.setAttribute('aria-live','polite');main.append(result);
 async function refresh(){const d=(await capabilities.list()).find(d=>d.permission==='secrets')!;status.textContent=(d.granted?copy.permission_granted:copy.permission_missing)+' · '+copy.available_capabilities+' '+d.available_methods.length+' / '+d.methods.length}
 const buttons:HTMLButtonElement[]=[];
 for(const action of ['set','get','remove','authorize'] as const){
  const button=el('button',action==='authorize'?copy.authorize:'secrets.'+action);button.dataset.testid='drive.secrets.'+action;if(action==='set')button.className='primary';buttons.push(button);actions.append(button);
  button.onclick=async()=>{buttons.forEach(b=>b.disabled=true);document.body.setAttribute('aria-busy','true');result.dataset.outcome='running';try{
   if(action==='authorize'){await permissions.request('secrets',copy.permission_lab);result.textContent=copy.completed}
   else if(action==='get'){let secret=await secrets.get(key.value);result.textContent=JSON.stringify({found:secret!==null});secret=null}
   else if(action==='set'){const pending=secrets.set(key.value,value.value);value.value='';await pending;result.textContent=copy.completed}
   else {await secrets.remove(key.value);result.textContent=copy.completed}
   result.dataset.outcome='passed';result.className='';
  }catch(error){result.textContent=String(error);result.dataset.outcome='failed';result.className='error'}finally{value.value='';buttons.forEach(b=>b.disabled=false);document.body.setAttribute('aria-busy','false');await refresh()}};
 }
 await refresh();document.body.setAttribute('aria-busy','false');
}
