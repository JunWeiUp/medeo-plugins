import css from './recorder.css';
import { useStyle } from './style';
import { describe } from './recorder-view.ts';
import {capture,capabilities,permissions,type CaptureRecord} from '@medeo-plugin/sdk';
export async function mountRecorder(audio=false){
 useStyle(css);
 const main=document.querySelector('main')!,copy=await capabilities.labels(),t=(key:string)=>copy[key]??key;
 const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};
 main.className='recorder';const header=el('header');header.append(el('small','Medeo'),el('h1',t('recording_title')),el('p',t('capture_hint')));
 const settings=el('section'),sourceLabel=el('label',t('recording_source')),source=el('select');sourceLabel.append(source);source.dataset.testid='drive.recorder.source';
 const refresh=el('button',t('recording_refresh')),access=el('button',t('capture_permission'));refresh.dataset.testid='drive.recorder.refresh';access.dataset.testid='drive.recorder.permission';settings.className='recorder-settings';settings.append(sourceLabel,refresh,access);
 const microphone=el('input'),systemAudio=el('input');microphone.type=systemAudio.type='checkbox';microphone.dataset.testid='drive.recorder.microphone';systemAudio.dataset.testid='drive.recorder.audio';
 if(audio){for(const [key,input]of [['recording_microphone',microphone],['recording_audio',systemAudio]] as const){const label=el('label');label.className='toggle';label.append(input,document.createTextNode(t(key)));settings.append(label)}}
 const status=el('p');status.setAttribute('role','status');status.dataset.testid='drive.recorder.status';
 const workspace=el('section'),history=el('section'),preview=el('section'),video=el('video'),caption=el('p');
 workspace.className='recorder-workspace';history.className='recorder-history';history.dataset.testid='drive.recorder.history';preview.className='recorder-preview';preview.append(video,caption);workspace.append(history,preview);
 video.controls=true;video.muted=true;video.preload='metadata';video.dataset.testid='drive.recorder.video';caption.textContent=t('recording_preview');
 const actions=el('footer'),start=el('button',t('recording_start')),stop=el('button',t('recording_stop')),cancel=el('button',t('cancel'));
 start.className='primary';start.dataset.testid='drive.recorder.start';stop.dataset.testid='drive.recorder.stop';cancel.dataset.testid='drive.recorder.cancel';actions.append(start,stop,cancel);
 main.append(header,settings,status,workspace,actions);
 let busy=false,loading=false,disposed=false,active:CaptureRecord|undefined,last='',selected:string|undefined,records:CaptureRecord[]=[];
 function controls(){source.disabled=loading||busy||!!active;refresh.disabled=loading||busy||!!active;access.disabled=loading||busy||!!active;start.disabled=loading||busy||!!active||!source.value;stop.disabled=busy||!active?.can_stop;cancel.disabled=stop.disabled;microphone.disabled=systemAudio.disabled=busy||!!active}
 function fail(error:unknown){status.textContent=t('error')+' · '+String(error).slice(0,200)}
 async function perform(action:()=>Promise<unknown>){if(busy)return;busy=true;controls();try{await action();await state()}catch(error){fail(error)}finally{busy=false;controls()}}
 async function scan(request=false){
  loading=true;controls();source.replaceChildren();try{
   if(request){
    const grants=await capabilities.list();
    if(!grants.find(p=>p.permission==='screen_capture')?.granted&&!(await permissions.request('screen_capture',t('recording_title'))).granted)return;
   }
   let snapshot=await capture.sources(true,request);
   while(snapshot.status==='loading'&&!disposed){await new Promise(r=>setTimeout(r,250));snapshot=await capture.sources()}
   if(disposed)return;
   if(snapshot.status!=='ready')throw Error(snapshot.error??'capture_failed');
   const placeholder=el('option','— '+t('recording_source')+' —');placeholder.value='';placeholder.disabled=true;placeholder.selected=true;source.append(placeholder);
   for(const item of snapshot.sources){const option=el('option',item.title+' · '+item.width+' × '+item.height);option.value=item.id;source.append(option)}
   status.textContent=t('recording_idle');
  }catch(error){fail(error)}finally{loading=false;controls()}
 }
 function show(record:CaptureRecord){
  selected=record.id;caption.textContent=record.source_title+' · '+describe(record).duration+' · '+describe(record).size;
  if(record.playable){const url=capture.previewURL(record.id);if(video.src!==url)video.src=url}else{video.removeAttribute('src');video.load()}
 }
 async function state(){
  const snapshot=await capture.state();if(disposed)return;records=snapshot.records;active=records.find(record=>record.active);
  if(active)status.textContent=[t(describe(active).key),describe(active).duration,describe(active).size].join(' · ');
  const signature=JSON.stringify(records);
  if(signature!==last){
   if(!active&&last)status.textContent=records[0] ? [t(describe(records[0]).key),describe(records[0]).duration,describe(records[0]).size].join(' · '):t('recording_idle');
   last=signature;history.replaceChildren();
   for(const record of records){
    const row=el('article');row.dataset.testid='drive.recorder.record.'+record.id;
    const choose=el('button',record.source_title);choose.className='record-title';choose.onclick=()=>show(record);
    row.append(choose,el('p',[t(describe(record).key),describe(record).duration,describe(record).size].join(' · ')));
    if(record.error)row.append(el('small',record.error==='no_video_frames'?t('capture_no_frames'):record.error));
    if(record.playable){const reveal=el('button',t('recording_reveal'));reveal.onclick=()=>void perform(()=>capture.open(record.id,'reveal'));row.append(reveal)}
    if(record.can_recover){const recover=el('button',t('recording_recover'));recover.dataset.testid='drive.recorder.recover.'+record.id;recover.onclick=()=>void perform(()=>capture.recover(record.id));row.append(recover)}
    history.append(row);
   }
   if(!records.length)history.append(el('p',t('capture_empty')));
   const focused=records.find(r=>r.id===selected)??records.find(r=>r.playable);
   if(focused)show(focused);
  }
  controls();
 }
 start.onclick=()=>void perform(async()=>{
  if(audio){
   const grants=await capabilities.list();
   for(const [name,on]of [['microphone',microphone.checked],['system_audio',systemAudio.checked]] as const){
    if(on&&!grants.find(p=>p.permission===name)?.granted&&!(await permissions.request(name,t('recording_title'))).granted)return;
   }
  }
  await capture.start(source.value,{microphone:audio&&microphone.checked,systemAudio:audio&&systemAudio.checked});
 });
 stop.onclick=()=>void perform(()=>capture.stop(active!.id));cancel.onclick=()=>void perform(()=>capture.cancel(active!.id));
 refresh.onclick=()=>void scan();access.onclick=()=>void scan(true);source.onchange=controls;
 window.addEventListener('pagehide',()=>{disposed=true;video.pause()});
 try{await state()}catch(error){fail(error)}
 await scan();document.body.setAttribute('aria-busy','false');
 const poll=async()=>{if(disposed)return;try{await state()}catch(error){fail(error)}finally{if(!disposed)setTimeout(()=>void poll(),400)}};void poll();
}
