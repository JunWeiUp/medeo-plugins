import {server,capabilities,events} from '@medeo-plugin/sdk';
/** The test app only echoes authenticated bytes or returns its own health data.
 * It never evaluates requests as code or translates paths into filesystem IO. */
export function startLocalServerFixture(){
 let active=true,pulling=false,again=false;
 async function pull(){
  if(!active)return;if(pulling){again=true;return}pulling=true;
  try{if(!(await capabilities.list()).find(c=>c.permission==='local_server')?.granted)return;
  for(const listener of await server.list()){
   if(listener.status!=='running')continue;
   const events=await server.events(listener.id);
   for(const request of events.requests){
    const health=btoa(JSON.stringify({ok:true,provider:'medeo-local-server'}));
    try{await server.respond(listener.id,request.id,{status:200,content_type:request.path==='/health'?'application/json':'application/octet-stream',body_base64:request.path==='/health'?health:request.body_base64})}catch{/* Expired, revoked or stopped: never replay the request. */}
   }
  }}catch{/* The grant may be absent or revoked. No request content is logged. */}
  finally{pulling=false;if(again){again=false;void pull()}}
 }
 // Each accepted request raises a signal; the slow timer covers grants that change later.
 const off=events.onSignal('server',pull);const timer=setInterval(()=>void pull(),5000);
 return()=>{active=false;off();clearInterval(timer)};
}
