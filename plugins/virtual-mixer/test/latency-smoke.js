'use strict';
// CABLE round-trip latency smoke: engine -> CABLE Input -> CABLE Output.
const fs=require('fs'), os=require('os'), path=require('path');
const {execFileSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..');
const ENGINE=path.join(ROOT,'engine','VirtualMixerEngine.exe');
let pass=0;
function ok(c,m){if(c){console.log('  PASS '+m);pass++;}else{console.log('  FAIL '+m);process.exitCode=1;}}
try{
  if(!fs.existsSync(ENGINE)) throw new Error('engine not built');
  const json=path.join(os.tmpdir(),'vrcb-latency-'+process.pid+'.json');
  execFileSync(ENGINE,['--latency-test','2',json],{encoding:'utf8',timeout:10000});
  const j=JSON.parse(fs.readFileSync(json,'utf8'));
  ok(j.ok===true && j.detected===true,'latency probe detected tone');
  ok(j.latencyMs>0,'latencyMs > 0: '+j.latencyMs);
  console.log('  INFO CABLE round-trip: '+j.latencyMs+' ms');
  fs.unlinkSync(json);
  console.log('  ---- '+pass+' PASS ----');
}catch(e){console.error('  FAIL '+e.message);process.exitCode=1;}