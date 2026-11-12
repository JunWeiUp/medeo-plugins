import css from './panel.css';
import { useStyle } from './style';
import {mountNetworkOrigins} from './network-origins';
import { capabilities, permissions } from '@medeo-plugin/sdk';
export interface Case { permission:string; title:string; grant:unknown; actions:{method:string;args:Record<string,unknown>}[] }
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};
export async function mount(spec:Case){
 useStyle(css);
 const main=document.querySelector('main')!,copy=await capabilities.labels();document.title=spec.title;
 const header=el('header');header.append(el('small','Medeo · '+copy.permission_lab),el('h1',copy[spec.permission]??spec.title),el('code',spec.permission));main.append(header);
 const status=el('section');status.className='status';status.dataset.testid='drive.permission.status';main.append(status);
 const result=el('pre');result.dataset.testid='drive.permission.result';result.setAttribute('aria-live','polite');result.textContent='—';
 if(spec.permission==='network')await mountNetworkOrigins(main,copy);
 const buttons:HTMLButtonElement[]=[];let previous:unknown=null;
 async function refresh(){const descriptor=(await capabilities.list()).find(d=>d.permission===spec.permission)!;status.replaceChildren(el('span',copy.permissions),el('strong',descriptor.granted?copy.permission_granted:copy.permission_missing),el('code',copy.available_capabilities+' '+descriptor.available_methods.length+' / '+descriptor.methods.length));return descriptor;}
 const substitute=(value:unknown):unknown=>{if(value==='$last.id')return(previous as {id?:string}|null)?.id??'';if(Array.isArray(value))return value.map(substitute);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,substitute(v)]));return value;};
 for(const action of spec.actions){
  const section=el('section');section.className='operation';const label=el('label',action.method),input=el('textarea');input.value=JSON.stringify(action.args,null,2);input.spellcheck=false;input.setAttribute('aria-label',action.method);input.dataset.testid='drive.permission.args.'+action.method;label.append(input);
  const button=el('button',copy.run);button.className='primary';button.dataset.testid='drive.permission.run.'+action.method;buttons.push(button);section.append(label,button);main.append(section);
  button.onclick=async()=>{for(const b of buttons)b.disabled=true;document.body.setAttribute('aria-busy','true');result.className='';try{const descriptor=await refresh();if(!descriptor.available_methods.includes(action.method))throw Error('capability_unavailable');const value=await capabilities.invoke(action.method,substitute(JSON.parse(input.value)) as Record<string,unknown>);if(value&&typeof value==='object'&&'id' in value)previous=value;result.textContent=JSON.stringify(value,null,2)??'null';result.dataset.outcome='passed';}catch(error){result.textContent=String(error);result.dataset.outcome='failed';result.className='error';}finally{for(const b of buttons)b.disabled=false;document.body.setAttribute('aria-busy','false');await refresh();}};
 }
 const authorize=el('button',copy.authorize);authorize.dataset.testid='drive.permission.authorize';authorize.onclick=async()=>{authorize.disabled=true;try{const granted=await permissions.request(spec.permission,copy.permission_lab);result.textContent=JSON.stringify(granted);await refresh()}catch(error){result.textContent=String(error)}finally{authorize.disabled=false}};header.append(authorize);
 main.append(result);await refresh();document.body.setAttribute('aria-busy','false');
}
