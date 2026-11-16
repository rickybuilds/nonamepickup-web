export const nameKey = name => String(name).normalize('NFKC').trim().toLowerCase();
export const average = (a,b) => (a+b)/2;
export function validatePlayer(body){
 const name=String(body.name??'').trim();
 if(!name||name.length>70) throw new Error('Enter a player name between 1 and 70 characters.');
 const percent=(v)=>{if(v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>100) throw new Error('Availability must be a number from 0 to 100.');return Math.round(Number(v)*10)/10;};
 if(!['regular','ringer'].includes(body.status)) throw new Error('Choose regular player or ringer only.');
 if(!['Y','N','Pending'].includes(body.captain)||!['Y','N','Pending'].includes(body.coCaptain)) throw new Error('Choose a valid captain preference.');
 const notes=String(body.notes??'').trim();if(notes.length>500) throw new Error('Keep notes under 500 characters.');
 return {name,nameKey:nameKey(name),saturday:percent(body.saturday),sunday:percent(body.sunday),status:body.status,captain:body.status==='ringer'?'N':body.captain,coCaptain:body.status==='ringer'?'N':body.coCaptain,notes};
}
