"use strict";
const fs = require("fs"), crypto = require("crypto");
function validateFinalizedPrefix(original, recovered) {
  if (recovered.size <= original.size_bytes || original.size_bytes < 544) throw new Error("Recovery must extend the original capture");
  const fd = fs.openSync(recovered.path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const header = Buffer.alloc(544);fs.readSync(fd,header,0,544,0);
    if (header.subarray(0,6).toString() !== "HLDEMO") throw new Error("Invalid finalized demo header");
    const offset=header.readInt32LE(540),countBytes=Buffer.alloc(4);
    if (offset<=544 || offset+4>recovered.size || fs.readSync(fd,countBytes,0,4,offset)!==4) throw new Error("Invalid finalized demo directory");
    const count=countBytes.readInt32LE(0);
    if (count<1 || count>1024 || offset+4+count*92>recovered.size) throw new Error("Invalid finalized demo directory");
    const entries=Buffer.alloc(count*92);fs.readSync(fd,entries,0,entries.length,offset+4);
    for(let i=0;i<count;i++){const start=entries.readInt32LE(i*92+84),length=entries.readInt32LE(i*92+88);if(start<544||length<0||start+length>offset)throw new Error("Invalid finalized demo entry");}
    // The source should be the same recording with a finalized header and tail,
    // not an unrelated demo sharing its filename/map. Only directory offset mutates.
    header.writeInt32LE(0,540);const digest=crypto.createHash("sha256").update(header),buffer=Buffer.alloc(1024*1024);
    let position=544;
    while(position<original.size_bytes){const length=Math.min(buffer.length,original.size_bytes-position),n=fs.readSync(fd,buffer,0,length,position);if(n!==length)throw new Error("Recovery prefix short read");digest.update(buffer.subarray(0,n));position+=n;}
    if(digest.digest("hex")!==original.sha256)throw new Error("Recovery prefix does not match original capture");
  } finally { fs.closeSync(fd); }
}
function recoverFinalizedSource(registry,originalId,input,actor) {
  return registry.db.transaction(()=>{
    const linked=registry.db.prepare("SELECT * FROM hltv_source_recoveries WHERE original_demo_id=?").get(originalId);
    if(linked)return {demo_id:linked.recovered_demo_id,run_id:linked.run_id,existing:true};
    const original=registry.get(originalId),oldFile=registry.storage.verify(original),header=Buffer.alloc(544),fd=fs.openSync(oldFile.path,"r");
    try{if(fs.readSync(fd,header,0,544,0)!==544||header.subarray(0,6).toString()!=="HLDEMO"||header.readInt32LE(540)!==0)throw new Error("Original is not an unfinished HLDEMO capture");}finally{fs.closeSync(fd);}
    const candidate=registry.storage.inspect(input.storage_key);validateFinalizedPrefix(original,candidate);
    if(registry.storage.inspect(input.storage_key).sha256!==candidate.sha256)throw new Error("Recovered source changed");
    const recovered=registry.ingest({version:1,match_id:original.match_id,server:original.server,map:original.map,demos:[{...input,recorded_at:original.recorded_at,round_id:null}]})[0];
    const rank={normal:0,low:1,medium:2,high:3,evidence:4},retention=rank[original.retention_class]>rank[recovered.retention_class]?original.retention_class:recovered.retention_class;
    registry.db.prepare("UPDATE hltv_demos SET retention_class=?,expires_at=MAX(expires_at,?) WHERE id=?").run(retention,original.expires_at,recovered.id);
    const run=require("./upstream").queueRun(registry,recovered.id,actor);
    registry.db.prepare("INSERT INTO hltv_source_recoveries(original_demo_id,recovered_demo_id,run_id,source_filename,original_sha256,recovered_sha256,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)")
      .run(original.id,recovered.id,run.id,original.filename,original.sha256,recovered.sha256,Date.now(),actor);
    registry.audit(original.id,actor,"finalized_source_recovered",{recovered_demo_id:recovered.id,run_id:run.id,sha256:recovered.sha256});
    registry.audit(recovered.id,actor,"recovered_from_unfinished_capture",{original_demo_id:original.id,original_sha256:original.sha256,source_filename:original.filename});
    return {demo_id:recovered.id,run_id:run.id,existing:false};
  }).immediate();
}
function downloadName(demo,round) {
  const safe=value=>String(value||"unknown").replace(/[^A-Za-z0-9_-]/g,"_").slice(0,80);
  return `${safe(demo.match_id)}-${safe(demo.map)}-${[1,2].includes(round)?"round-"+round:"unpaired-"+demo.id.slice(0,8)}.dem`;
}
module.exports={recoverFinalizedSource,downloadName};
