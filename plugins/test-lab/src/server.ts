import css from './panel.css';
import { useStyle } from './style';
import {capabilities,permissions,server} from '@medeo-plugin/sdk';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
export async function mountLocalServer(){
 useStyle(css);
 const copy=await capabilities.labels(),main=document.querySelector('main')!;main.className='secrets-lab server-lab';
 const header=el('header');header.append(el('small','Medeo · '+copy.permission_lab),el('h1',copy.local_server),el('p',copy.server_note));main.append(header);
 const status=el('section');status.className='status';status.dataset.testid='drive.server.status';main.append(status);
 const fields=el('section');fields.className='secret-fields';main.append(fields);
 const port=el('input');port.type='number';port.min='0';port.max='65535';port.value='0';port.dataset.testid='drive.server.port';
 const address=el('input');address.readOnly=true;address.dataset.testid='drive.server.address';
 const token=el('input');token.type='text';token.readOnly=true;token.autocomplete='off';token.dataset.testid='drive.server.token';
 for(const [name,input] of [[copy.server_port,port],[copy.server_address,address],[copy.server_token,token]] as const){const label=el('label',name);label.append(input);fields.append(label)}
 fields.append(el('code','GET /health · POST /echo'));
 const actions=el('div');actions.className='origin-actions';main.append(actions);
 const result=el('pre','—');result.dataset.testid='drive.server.result';result.setAttribute('aria-live','polite');main.append(result);
 const buttons:HTMLButtonElement[]=[];let id='';
 async function refresh(){const d=(await capabilities.list()).find(d=>d.permission==='local_server')!;status.textContent=(d.granted?copy.permission_granted:copy.permission_missing)+' · '+copy.available_capabilities+' '+d.available_methods.length+' / '+d.methods.length;return d.granted;}
 for(const action of ['start','state','stop','authorize'] as const){
  const button=el('button',action==='authorize'?copy.authorize:'server.'+action);button.dataset.testid='drive.server.'+action;if(action==='start')button.className='primary';buttons.push(button);actions.append(button);
  button.onclick=async()=>{buttons.forEach(b=>b.disabled=true);document.body.setAttribute('aria-busy','true');try{
   if(action==='authorize'){await permissions.request('local_server',copy.permission_lab);result.textContent=copy.completed}
   else if(action==='start'){
    if(id){const old=await server.state(id).catch(error=>{if(String(error).includes('server_missing'))return null;throw error});if(old&&['starting','running','stopping'].includes(old.status))throw Error('server_already_running')}
    const started=await server.start({port:Number(port.value),routes:[{method:'GET',path:'/health'},{method:'POST',path:'/echo'}]});id=started.id;token.value=started.access_token;
    const deadline=Date.now()+5000;let state=await server.state(id);while(state.status==='starting'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,40));state=await server.state(id)}
    if(state.status!=='running'){token.value='';throw Error(state.error??'server_not_ready')};address.value=state.origin??'';result.textContent=JSON.stringify(state,null,2);
   }else if(action==='state'){result.textContent=JSON.stringify(id?await server.state(id):await server.list(),null,2)}
   else {if(id)await server.stop(id);token.value='';address.value='';result.textContent=copy.stopped;id=''}
   result.dataset.outcome='passed';result.className='';
  }catch(error){result.textContent=String(error);result.dataset.outcome='failed';result.className='error'}finally{buttons.forEach(b=>b.disabled=false);document.body.setAttribute('aria-busy','false');await refresh()}};
 }
 // Reopening a window recovers the listener reference, but never re-exposes the
 // old token. Stop and restart to obtain a fresh token if it was not retained.
 const existing=((await refresh())?await server.list():[]).find(s=>s.status==='running');if(existing){id=existing.id;address.value=existing.origin??'';result.textContent=JSON.stringify(existing,null,2)}
 await refresh();document.body.setAttribute('aria-busy','false');
 window.addEventListener('pagehide',()=>{token.value=''});
}
