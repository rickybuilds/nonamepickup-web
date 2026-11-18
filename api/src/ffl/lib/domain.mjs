export const nameKey = name => String(name).normalize('NFKC').trim().toLowerCase();
export const average = (a,b) => (a+b)/2;
export const scheduleMaps = [
 'Suicide_ki','Cornfield','Alchimy_lg','5v5: Copper2\n7v7: osaka_r',
 'Respite','Phantom_lg','Troy2','Juno','Openfire_lowgrens',
 '5v5: Ostargh\n7v7: Palermo','Sandlot_b3','Mulch_trench_lg','Baconbowl',
 'Avantipt3','Demolish2_b6','KSOUR','5v5: Maya_sp_beta13\n7v7: Thecove',
 'Raiden9','Bayeaux','Breakout_ost_b2','Stormz2_lg',
 'Game 1: Magelli\nGame 2: Cranked'
];
export function validateWeek(body){
 if(!Number.isInteger(body.week)||body.week<1||body.week>scheduleMaps.length)throw new Error('Choose a valid league week.');
 if(typeof body.maps!=='string'||!body.maps.trim()||body.maps.trim().length>300)throw new Error('Enter maps between 1 and 300 characters.');
 const date=body.date;
 if(typeof date!=='string'||(date!==''&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'0001-01-01'||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)))throw new Error('Choose a valid date, or leave it blank for TBD.');
 return {week:body.week,maps:body.maps.trim(),date:date||null};
}
export function validatePlayer(body){
 const name=String(body.name??'').trim();
 if(!name||name.length>70) throw new Error('Enter a player name between 1 and 70 characters.');
 const percent=(v)=>{if(v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>100) throw new Error('Availability must be a number from 0 to 100.');return Math.round(Number(v)*10)/10;};
 if(!['regular','ringer'].includes(body.status)) throw new Error('Choose regular player or ringer only.');
 if(!['Y','N','Pending'].includes(body.captain)||!['Y','N','Pending'].includes(body.coCaptain)) throw new Error('Choose a valid captain preference.');
 const notes=String(body.notes??'').trim();if(notes.length>500) throw new Error('Keep notes under 500 characters.');
 return {name,nameKey:nameKey(name),saturday:percent(body.saturday),sunday:percent(body.sunday),status:body.status,captain:body.status==='ringer'?'N':body.captain,coCaptain:body.status==='ringer'?'N':body.coCaptain,notes};
}
