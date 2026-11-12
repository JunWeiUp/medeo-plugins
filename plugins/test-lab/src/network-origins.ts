import {network} from '@medeo-plugin/sdk';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n};
/** Test permissions through the public SDK; origin consent is always the trusted native dialog. */
export async function mountNetworkOrigins(main:HTMLElement,copy:Record<string,string>){
 const section=el('section');section.className='origin-panel';section.append(el('h2',copy.network_origins),el('p',copy.network_origin_notice));
 const originLabel=el('label',copy.network_origin),origin=el('input');origin.type='url';origin.placeholder='https://api.example.com';origin.dataset.testid='drive.network.origin';originLabel.append(origin);
 const reasonLabel=el('label',copy.request_reason),reason=el('input');reason.maxLength=512;reason.dataset.testid='drive.network.reason';reasonLabel.append(reason);
 const request=el('button',copy.authorize);request.className='primary';request.dataset.testid='drive.network.authorize';
 const refreshButton=el('button',copy.network_origins_refresh);refreshButton.dataset.testid='drive.network.refresh';
 const actions=el('div');actions.className='origin-actions';actions.append(request,refreshButton);
 const message=el('p');message.setAttribute('role','status');message.dataset.testid='drive.network.result';
 const list=el('ul');list.dataset.testid='drive.network.origins';section.append(originLabel,reasonLabel,actions,message,list);main.append(section);
 let busy=false;
 async function perform(action:()=>Promise<void>){if(busy)return;busy=true;request.disabled=refreshButton.disabled=true;try{await action();await refresh()}catch(error){message.textContent=String(error)}finally{busy=false;request.disabled=refreshButton.disabled=false}}
 async function refresh(){const rows=await network.origins();list.replaceChildren();for(const row of rows){const item=el('li');item.dataset.origin=row.origin;item.dataset.allowed=String(row.allowed);item.append(el('code',row.origin),el('small',(row.declared?copy.network_origin_declared:copy.network_origin_added)+' · '+(row.allowed?copy.permission_granted:copy.permission_missing)));if(row.allowed){const revoke=el('button',copy.revoke);revoke.dataset.testid='drive.network.revoke';revoke.onclick=()=>void perform(async()=>{await network.revokeOrigin(row.origin)});item.append(revoke)}list.append(item)}}
 request.onclick=()=>void perform(async()=>{const result=await network.requestOrigin(origin.value.trim(),reason.value.trim());message.textContent=result.granted?copy.permission_granted:copy.permission_missing});
 refreshButton.onclick=()=>void perform(async()=>{});await refresh().catch(error=>{message.textContent=String(error)});
}
