import {capabilities,events,inputMethod,storage} from '@medeo-plugin/sdk';
export const DEFAULT_WORDS="nihao=你好|您好\nmedeo=Medeo\nxiexie=谢谢\nzaijian=再见";
export function parseWords(text:string){
 if(text.length>32768)throw Error('input_dictionary_too_large');
 const words=new Map<string,string[]>();
 for(const row of text.split('\n').filter(s=>s.trim())){
  const at=row.indexOf('='),key=row.slice(0,at).trim().toLowerCase(),values=row.slice(at+1).split('|').map(s=>s.trim());
  if(at<1||!/^[a-z']{1,64}$/.test(key)||values.length>9||values.some(s=>!s||[...s].length>256||/[\x00-\x1f\x7f]/.test(s)))throw Error('invalid_dictionary_entry');
  words.set(key,values);
 }
 if(words.size>256)throw Error('input_dictionary_too_large');return words;
}
/** Starts answering compositions; dispose the result to stop. */
export function startInputProvider(persist=false):{dispose():void}{
 let words=parseWords(DEFAULT_WORDS),lastLoad=0,stopped=false,enabled=false,pulling=false,again=false;
 // Compositions are pushed as signals; the slow heartbeat only keeps the provider lease alive.
 const pull=async()=>{
  if(stopped)return;if(pulling){again=true;return}pulling=true;
  try{
   if(!enabled&&!(await capabilities.list()).find(p=>p.permission==='input_method')?.granted)return;
   enabled=(await inputMethod.status()).enabled;
   if(!enabled)return;
   if(persist&&performance.now()-lastLoad>1000){lastLoad=performance.now();if((await capabilities.list()).find(p=>p.permission==='storage')?.granted){const saved=await storage.get<string>('dictionary');if(typeof saved==='string')words=parseWords(saved)}}
   for(const event of await inputMethod.events()){
    const pinyin=event.text.match(/[A-Za-z']+$/)?.[0].toLowerCase()??'';
    await inputMethod.respond(event.id,words.get(pinyin)??[]);
   }
  }catch{enabled=false;/* Disabled, revoked and expired compositions are normal lifecycle states. */}
  finally{pulling=false;if(again){again=false;void pull()}}
 };
 const off=events.onSignal('input_method',pull);
 const heartbeat=()=>{if(stopped)return;void pull();setTimeout(heartbeat,enabled?1000:2000)};setTimeout(heartbeat,100);
 return {dispose(){stopped=true;off()}};
}
