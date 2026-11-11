/* Shared pure aggregation for the estimated defense dashboard and its tests. */
(function(root){
  'use strict';
  const sample=n=>n>=50?{key:'extensive',label:'50+ rounds'}:n>=25?{key:'established',label:'25–49 rounds'}:n>=10?{key:'developing',label:'10–24 rounds'}:{key:'limited',label:'Under 10 rounds'};
  const eligible=(bucket,minimum)=>(bucket?.players||[]).filter(p=>p.games>=Number(minimum));
  const sort=(players,key='defense')=>[...players].sort((a,b)=>(key==='player'?a.player.localeCompare(b.player):key==='conceded'?a.conceded-b.conceded:b[key]-a[key])||b.games-a.games||a.player.localeCompare(b.player));
  function observations(bucket,players){
    const ids=new Set(players.map(p=>String(p.id))),seen=new Set();
    return (bucket?.observations||[]).filter(o=>{
      const key=`${o.matchId}|${o.roundNum}|${o.team}`;
      if(seen.has(key)||!Number.isInteger(o.conceded)||o.conceded<0||!o.playerIds?.some(id=>ids.has(String(id))))return false;
      seen.add(key);return true;
    });
  }
  function distribution(observations){
    const max=Math.max(0,...observations.map(o=>o.conceded)),step=Math.max(1,Math.ceil((max+1)/8));
    const bins=Array.from({length:Math.ceil((max+1)/step)},(_,i)=>({lo:i*step,hi:(i+1)*step-1,count:0}));
    observations.forEach(o=>bins[Math.floor(o.conceded/step)].count++);return bins;
  }
  function trend(observations){
    const dated=observations.every(o=>typeof o.createdAt==='number'&&Number.isFinite(o.createdAt)&&o.createdAt>0);
    const ordered=[...observations].sort((a,b)=>(dated?a.createdAt-b.createdAt:0)||String(a.matchId).localeCompare(String(b.matchId),undefined,{numeric:true})||a.roundNum-b.roundNum||String(a.team).localeCompare(String(b.team)));
    return {dated,ordered,rolling:ordered.map((_,i)=>{const window=ordered.slice(Math.max(0,i-4),i+1);return window.reduce((s,o)=>s+o.conceded,0)/window.length;})};
  }
  const api={sample,eligible,sort,observations,distribution,trend};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.nnDefenseModel=api;
})(typeof window==='undefined'?globalThis:window);
