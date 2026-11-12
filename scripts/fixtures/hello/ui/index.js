const count=document.getElementById('count'),button=document.getElementById('increment'),error=document.getElementById('error');
async function refresh(){const value=await window.medeoPlugin.invoke('storage.get',{key:'counter'});count.textContent=String(value??0)}
button.onclick=async()=>{button.disabled=true;error.textContent='';try{const result=await window.medeoPlugin.run('counter.increment');count.textContent=String(result.counter)}catch{error.textContent='⚠'}finally{button.disabled=false}};
refresh().catch(()=>{error.textContent='⚠'});
