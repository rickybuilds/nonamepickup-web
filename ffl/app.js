'use strict';
const $=id=>document.getElementById(id);
const state={players:[],teams:[],admin:false,filter:'all',sort:'name',direction:1,editing:null,deleting:null,loaded:false,busy:false};
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const percent=value=>Number.isInteger(value)?String(value):Number(value).toFixed(1);
const avg=p=>(p.saturday+p.sunday)/2;
const icons={edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6L16 3Z"/><path d="m13 6 5 5"/></svg>',trash:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>',shield:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"/></svg>'};
let toastTimer;
function toast(message,isError=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').dataset.error=String(isError);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
async function api(body){
 const response=await fetch('/ffl/api/league',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});
 let data;try{data=await response.json();}catch{throw new Error('The server could not be reached. Please try again.');}
 if(!response.ok){if(response.status===401&&body?.action!=='login'){state.admin=false;render();}throw new Error(data.error??'Could not complete that action.');}return data;
}
async function load(throwOnError=false){try{const data=await api();state.players=data.players;state.teams=data.teams;state.admin=data.admin;state.loaded=true;$('load-error').hidden=true;render();return true;}catch(e){$('load-error').hidden=false;$('load-error').querySelector('span').textContent=e.message;if(throwOnError)throw e;return false;}}
async function mutate(body,message){await api(body);const refreshed=await load();toast(refreshed?message:message+' Refresh the page to see the latest roster.');}
function identity(p){const initials=p.name.replace(/[^\p{L}\p{N}]/gu,'').slice(0,2).toUpperCase()||'FF';const tone=[...p.name].reduce((n,c)=>n+c.codePointAt(0),0)%4;return `<div class="player-identity"><span class="avatar" data-tone="${tone}" aria-hidden="true">${escapeHtml(initials)}</span><span class="name-stack"><span class="player-name">${escapeHtml(p.name)}</span>${p.status==='ringer'?'<span class="mini-ringer">Ringer only</span>':''}</span></div>`;}
function roles(p){if(p.status==='ringer')return '<span class="muted">Substitute</span>';const badges=[];if(p.captain==='Y')badges.push('<span class="badge captain">Captain</span>');if(p.coCaptain==='Y')badges.push('<span class="badge">Co-captain</span>');if(p.captain==='Pending'||p.coCaptain==='Pending')badges.push(`<span class="badge pending">${p.captain==='Pending'?'Captain':'Co-captain'} pending</span>`);return badges.join(' ')||'<span class="muted">Player</span>';}
function availability(v){return `<span class="percent"><span class="percent-number">${percent(v)}%</span><progress class="percent-track" aria-hidden="true" value="${Number(v)}" max="100"></progress></span>`;}
function render(){
 $('total-count').textContent=state.players.length;$('teams-count').textContent=state.teams.length;$('admin-bar').hidden=!state.admin;$('admin-button').textContent=state.admin?'Admin settings':'Admin login';$('action-heading').hidden=!state.admin;$('add-team').hidden=!state.admin;
 renderRoster();renderTeams();renderPage();
}
function renderPage(){const teams=location.hash==='#teams';$('roster-view').hidden=teams;$('teams-view').hidden=!teams;$('page-title').textContent=teams?'Team rosters':'Player roster';$('page-description').textContent=teams?'The draft starts here. Give every player a place.':'Find your teammates. Plan your weekends.';for(const id of ['roster-link','teams-link'])$(id).removeAttribute('aria-current');$(teams?'teams-link':'roster-link').setAttribute('aria-current','page');}
function renderRoster(){
 const query=$('search').value.trim().toLocaleLowerCase();const role=$('role-filter').value;
 const players=state.players.filter(p=>(state.filter==='all'||p.status===state.filter)&&p.name.toLocaleLowerCase().includes(query)&&(role==='all'||p[role]==='Y')).sort((a,b)=>state.direction*(state.sort==='average'?avg(a)-avg(b):a.name.localeCompare(b.name)));
 $('player-rows').innerHTML=players.length?players.map(p=>`<tr><td>${identity(p)}${p.notes?`<span class="note-label" title="${escapeHtml(p.notes)}">${escapeHtml(p.notes)}</span>`:''}</td><td>${availability(p.saturday)}</td><td>${availability(p.sunday)}</td><td><span class="average ${p.status==='ringer'?'ringer-average':''}" ${p.status==='ringer'?'title="Ringer percentages are not regular-season commitments."':''}>${percent(avg(p))}%</span></td><td>${roles(p)}</td><td><span class="team-name">${escapeHtml(state.teams.find(t=>t.id===p.teamId)?.name??'Unassigned')}</span></td>${state.admin?`<td><div class="row-actions"><button data-edit="${p.id}" aria-label="Edit ${escapeHtml(p.name)}">${icons.edit}</button><button class="delete" data-delete="${p.id}" aria-label="Remove ${escapeHtml(p.name)}">${icons.trash}</button></div></td>`:''}</tr>`).join(''):`<tr><td colspan="7" class="empty">${state.loaded?'No players match these filters. Try another name or filter.':'Loading the player roster…'}</td></tr>`;
 $('result-count').textContent=`${players.length} of ${state.players.length} players${state.filter==='ringer'?' · Ringer availability is indicative':''}`;
 document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===state.filter)));
 document.querySelectorAll('thead th').forEach(th=>th.removeAttribute('aria-sort'));$(state.sort==='name'?'sort-name':'sort-average').closest('th').setAttribute('aria-sort',state.direction===1?'ascending':'descending');
}
function teamOptions(selected=null){return `<option value="">Unassigned</option>`+state.teams.map(t=>`<option value="${t.id}" ${selected===t.id?'selected':''}>${escapeHtml(t.name)}</option>`).join('');}
function assignment(p){return `<select class="move-player" data-assign="${p.id}" aria-label="Team for ${escapeHtml(p.name)}" ${state.busy?'disabled':''}>${teamOptions(p.teamId)}</select>`;}
function renderTeams(){
 const unassigned=state.players.filter(p=>!p.teamId);const query=$('draft-search').value.trim().toLocaleLowerCase();
 $('draft-summary').textContent=`${state.players.length-unassigned.length} drafted · ${unassigned.length} unassigned · ${state.teams.length} teams`;
 $('team-grid').innerHTML=state.teams.map(t=>{const players=state.players.filter(p=>p.teamId===t.id);return `<article class="team-card"><div class="team-top"><div class="team-emblem">${icons.shield}<h2>${escapeHtml(t.name)}</h2></div><span>${players.length} player${players.length===1?'':'s'}</span></div>${players.length?`<ul class="team-members">${players.map(p=>`<li>${identity(p)}${state.admin?assignment(p):p.captain==='Y'?'<span class="badge captain">Captain</span>':''}</li>`).join('')}</ul>`:'<div class="team-empty"><strong>Ready for the draft</strong>No players assigned yet.</div>'}${state.admin?`<div class="team-draft"><select data-draft-to="${t.id}" aria-label="Add player to ${escapeHtml(t.name)}" ${state.busy?'disabled':''}><option value="">Add a player…</option>${unassigned.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}${p.status==='ringer'?' (ringer)':''}</option>`).join('')}</select></div>`:''}</article>`;}).join('');
 $('unassigned-count').textContent=unassigned.length;
 const visible=unassigned.filter(p=>p.name.toLocaleLowerCase().includes(query));
 $('unassigned-list').innerHTML=visible.length?visible.map(p=>`<div class="draft-player">${identity(p)}${state.admin?assignment(p):`<span class="draft-average">${percent(avg(p))}% avg.</span>`}</div>`).join(''):`<p class="empty">${unassigned.length?'No players match that search.':'Everyone has a team. Ready to play.'}</p>`;
}
function clearError(id){$(id).hidden=true;$(id).textContent='';}
function showError(id,message){$(id).hidden=false;$(id).textContent=message;}
function openEditor(id=null){
 state.editing=id;const form=$('player-form');form.reset();clearError('player-error');const p=state.players.find(p=>p.id===id);if(p)for(const key of ['name','status','saturday','sunday','captain','coCaptain','notes'])form.elements.namedItem(key).value=p[key];
 $('editor-title').textContent=p?'Edit player':'Add a player';$('editor-description').textContent=p?'Changes will update the shared roster.':'Your entry will appear on the shared roster.';$('save-player').textContent=p?'Save changes':'Add player';updateForm();$('editor').showModal();
}
function updateForm(){const f=$('player-form').elements;const ringer=f.namedItem('status').value==='ringer';$('ringer-note').hidden=!ringer;$('captain-fields').disabled=ringer;$('captain-fields').hidden=ringer;const a=f.namedItem('saturday').value,b=f.namedItem('sunday').value;$('form-average').textContent=a!==''&&b!==''?percent((Number(a)+Number(b))/2)+'%':'—';}
async function formAction(form,errorId,action){clearError(errorId);const controls=[...form.querySelectorAll('button')];controls.forEach(b=>b.disabled=true);try{await action();}catch(e){showError(errorId,e.message);}finally{controls.forEach(b=>b.disabled=false);}}
document.querySelectorAll('.close-dialog').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('add-player').addEventListener('click',()=>openEditor());
$('search').addEventListener('input',renderRoster);$('role-filter').addEventListener('change',renderRoster);$('draft-search').addEventListener('input',renderTeams);
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{state.filter=b.dataset.filter;renderRoster();}));
for(const key of ['name','average'])$('sort-'+key).addEventListener('click',()=>{state.direction=state.sort===key?-state.direction:key==='average'?-1:1;state.sort=key;renderRoster();});
$('player-rows').addEventListener('click',e=>{const edit=e.target.closest('[data-edit]'),del=e.target.closest('[data-delete]');if(edit)openEditor(edit.dataset.edit);if(del){state.deleting=del.dataset.delete;const p=state.players.find(p=>p.id===state.deleting);$('delete-description').textContent=`Remove ${p.name} from the league roster?`;clearError('delete-error');$('delete-dialog').showModal();}});
$('confirm-delete').addEventListener('click',async()=>{const b=$('confirm-delete');b.disabled=true;try{await mutate({action:'delete',id:state.deleting},'Player removed.');$('delete-dialog').close();}catch(e){showError('delete-error',e.message);}finally{b.disabled=false;}});
$('player-form').addEventListener('input',updateForm);
$('player-form').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;formAction(f,'player-error',async()=>{const player=Object.fromEntries(new FormData(f));if(player.status==='ringer'){player.captain='N';player.coCaptain='N';}await mutate({action:state.editing?'edit':'add',id:state.editing,player},state.editing?'Player updated.':'Player added to the roster.');$('editor').close();});});
$('admin-button').addEventListener('click',()=>{if(state.admin){clearError('password-error');$('password-form').reset();$('password-dialog').showModal();}else{$('login-form').reset();clearError('login-error');$('login-dialog').showModal();}});
$('login-form').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;formAction(f,'login-error',async()=>{await mutate({action:'login',password:f.elements.namedItem('password').value},'Admin mode is on.');f.reset();$('login-dialog').close();});});
$('password-button').addEventListener('click',()=>{$('password-form').reset();clearError('password-error');$('password-dialog').showModal();});
$('password-form').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;formAction(f,'password-error',async()=>{const values=Object.fromEntries(new FormData(f));if(values.newPassword!==values.confirmPassword)throw new Error('The new passwords don’t match.');await mutate({action:'password',...values},'Password changed. Log in with your new password.');f.reset();$('password-dialog').close();});});
$('logout-button').addEventListener('click',async()=>{try{await mutate({action:'logout'},'Logged out.');}catch(e){toast(e.message,true);}});
$('add-team').addEventListener('click',()=>{$('team-form').reset();$('team-form').elements.namedItem('name').value='Team '+(state.teams.length+1);clearError('team-error');$('team-dialog').showModal();});
$('team-form').addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;formAction(f,'team-error',async()=>{await mutate({action:'teamAdd',name:f.elements.namedItem('name').value},'Team added.');$('team-dialog').close();});});
$('teams-view').addEventListener('change',async e=>{const select=e.target.closest('[data-assign],[data-draft-to]');if(!select||state.busy)return;let id,teamId;if(select.dataset.assign){id=select.dataset.assign;teamId=select.value||null;}else{if(!select.value)return;id=select.value;teamId=select.dataset.draftTo;}state.busy=true;document.querySelectorAll('[data-assign],[data-draft-to]').forEach(s=>s.disabled=true);try{await mutate({action:'assign',id,teamId},'Team assignment saved.');}catch(e){toast(e.message,true);}finally{state.busy=false;renderTeams();}});
$('retry-button').addEventListener('click',()=>load());
$('export-button').addEventListener('click',()=>{const cell=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const rows=[['Player','Saturday Availability %','Sunday Availability %','Average %','Participation','Captain','Co-Captain','Team','Notes'],...state.players.map(p=>[p.name,p.saturday,p.sunday,avg(p),p.status==='ringer'?'Ringer only':'Regular',p.captain,p.coCaptain,state.teams.find(t=>t.id===p.teamId)?.name??'Unassigned',p.notes])];const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='ffl-players.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('hashchange',renderPage);
// Refresh shared data when returning to this tab; do not disturb an open form.
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))load();});
renderPage();load();
