import css from './panel.css';
import { useStyle } from './style';
import { agent, capabilities, operations, permissions, type AgentJob } from '@medeo-plugin/sdk';
export async function mountChat(){
 useStyle(css);
 const main=document.querySelector('main')!,copy=await capabilities.labels(),t=(key:string)=>copy[key]??key;
 const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n};
 const header=el('header');header.append(el('small','Medeo'),el('h1',t('agent_chat')),el('p',t('agent_note')));
 const authorize=el('button',t('authorize'));authorize.dataset.testid='drive.permission.authorize';header.append(authorize);
 const status=el('p'),conversation=el('section'),composer=el('form'),label=el('label',t('agent_message')),input=el('textarea');
 conversation.className='conversation';conversation.setAttribute('aria-live','polite');conversation.dataset.testid='drive.agent.conversation';
 input.required=true;input.maxLength=8000;input.dataset.testid='drive.agent.message';label.append(input);
 const send=el('button',t('agent_send')),cancel=el('button',t('cancel'));send.className='primary';send.type='submit';cancel.type='button';cancel.disabled=true;send.dataset.testid='drive.agent.send';cancel.dataset.testid='drive.agent.cancel';
 composer.append(label,send,cancel);composer.className='composer';main.className='chat';main.append(header,status,conversation,composer);
 let busy=false,jobId:string|undefined,messages:{role:'user'|'assistant';content:string}[]=[];
 const fail=(error:unknown)=>{status.textContent=String(error).includes('agent_not_configured')?t('agent_not_configured'):t('error')+' · '+String(error).slice(0,220)};
 authorize.onclick=async()=>{try{const result=await permissions.request('agent_api',t('agent_chat'));authorize.hidden=result.granted;status.textContent=''}catch(error){fail(error)}};
 const renderJob=async(job:AgentJob)=>{
  jobId=job.id;const reply=el('article');reply.dataset.testid='drive.agent.reply';conversation.append(reply);busy=true;send.disabled=true;cancel.disabled=false;
  try{
   job=await agent.follow(job.id,current=>{reply.textContent=current.text||'…';status.textContent=t(current.status);conversation.scrollTop=conversation.scrollHeight});
   if(job.status==='completed'&&job.text)messages.push({role:'assistant',content:job.text});
   if(job.error)fail(job.error);
  }catch(error){fail(error)}finally{busy=false;send.disabled=false;cancel.disabled=true;jobId=undefined}
 };
 composer.onsubmit=event=>{event.preventDefault();if(busy||!input.value.trim())return;void(async()=>{
  busy=true;send.disabled=true;const content=input.value;status.textContent='';messages.push({role:'user',content});
  try{const job=await agent.start(messages);conversation.append(el('article',content));input.value='';await renderJob(job)}
  catch(error){messages.pop();fail(error)}finally{busy=false;send.disabled=false}
 })()};
 cancel.onclick=()=>{if(jobId){cancel.disabled=true;void agent.cancel(jobId).catch(fail)}};
 // Reopening the window recovers current output without restarting a request.
 try{authorize.hidden=(await capabilities.list()).find(c=>c.permission==='agent_api')?.granted??false;const last=(await operations.list()).filter(o=>o.method==='agent.start').at(-1);if(last)void renderJob(await agent.state(last.id))}catch(error){fail(error)}
 document.body.setAttribute('aria-busy','false');
}
