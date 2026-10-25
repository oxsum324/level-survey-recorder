import test from 'node:test';
import assert from 'node:assert/strict';
import {appHarness} from './checks/app-harness.js';

const clickTarget=dataset=>{const target={dataset};target.closest=()=>target;return target;};
function recorded(overrides={}){
 const h=appHarness(overrides);h.run(`project=blankProject();project.points.push({id:'s1',code:'S1',type:'S'});project.route.toleranceMm='5';project.setups=[{bsPointId:project.route.startId,bs:'1.500',bsUpper:'1.600',bsLower:'1.400',intermediate:[{pointId:'s1',value:'0.490'},{pointId:'s1',value:'0.501'}],fsPointId:project.route.endId,fs:'1.500',fsUpper:'1.700',fsLower:'1.300',distance:'25'}];bindInputs();bindActions();updateReadingWarning=()=>null;`);return h;
}
test('LS01 rejected candidate normalization never replaces current persistent case',async()=>{
 let replacements=0;const h=recorded({replaceProject:async()=>{replacements++;}});const before=h.run('project.id');
 h.context.file={text:async()=>JSON.stringify({format:'level-survey-case.v1',project:{schema:1,points:[],setups:[],photos:[],route:{}},media:[]})};
 h.run(`normalizeProject=()=>{throw Error('candidate invalid')}`);await h.run('importBackup(file)');assert.equal(replacements,0);assert.equal(h.run('project.id'),before);
});
test('LS02 case replacement waits for pending media and does not attach old equipment to new case',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);const h=recorded({saveMedia:async()=>gate});const before=h.run('project.id');h.context.image=new Blob(['png'],{type:'image/png'});h.context.image.name='old.png';
 const media=h.run(`addImage(image,'equipment')`);const replace=h.node('#newCase').onclick();await Promise.resolve();assert.equal(h.run('project.id'),before);
 release();await media;await replace;assert.notEqual(h.run('project.id'),before);assert.equal(h.run('project.equipmentPhotos.length'),0);
});
test('LS02 failed persistent replacement retains current in-memory case',async()=>{
 const h=recorded({replaceProject:async()=>{throw Error('write failed')}});const before=h.run('project.id');await h.node('#newCase').onclick();assert.equal(h.run('project.id'),before);
});
test('LS03 three-wire replacement stores previous distance and reason',async()=>{
 const h=recorded();h.run(`editReason=async()=> '複核三絲';`);await h.dispatch('click',clickTarget({copyWireDistance:'0'}));
 assert.equal(h.run('project.setups[0].distance'),'60.000');assert.equal(h.run('project.auditLog.length'),1);assert.equal(h.run('project.auditLog[0].from'),'25');assert.equal(h.run('project.auditLog[0].reason'),'複核三絲');
});
test('LS03 cancelling three-wire replacement retains existing distance',async()=>{
 const h=recorded();h.run(`editReason=async()=>null;`);await h.dispatch('click',clickTarget({copyWireDistance:'0'}));assert.equal(h.run('project.setups[0].distance'),'25');assert.equal(h.run('project.auditLog.length'),0);
});
test('LS03 numerically equal three-wire distance is not a correction',async()=>{
 const h=recorded();h.run(`project.setups[0].distance='60';editReason=async()=>{throw Error('unexpected dialog')};`);await h.dispatch('click',clickTarget({copyWireDistance:'0'}));assert.equal(h.run('project.auditLog.length'),0);assert.equal(h.run('project.setups[0].distance'),'60');
});
test('LS04 only edited sight is marked and point rename retains its correction',async()=>{
 const h=recorded();h.run(`editReason=async()=> '複核';`);const target={id:'',dataset:{isValue:'0:0'},value:'0.500'};await h.dispatch('change',target);
 assert.equal(h.run('project.auditLog.length'),1);assert.equal((h.run('resultRows(calculate(project))').match(/※已更正/g)||[]).length,1);
 h.run(`point('s1').code='S101';`);assert.equal((h.run('resultRows(calculate(project))').match(/※已更正/g)||[]).length,1);
 assert.ok(h.run('project.auditLog[0].observationId'));assert.equal(h.run('project.auditLog[0].pointId'),'s1');
});
test('LS04 loading legacy observations does not silently assign evidence IDs',()=>{
 const h=recorded();const before=h.run('JSON.stringify(project.setups)');h.run('normalizeProject();calculate(project);resultRows(calculate(project));');assert.equal(h.run('JSON.stringify(project.setups)'),before);
});
test('LS04 ambiguous legacy edits are not copied onto all repeated observations',()=>{
 const h=recorded();h.run(`project.auditLog=[{type:'edit',station:1,pointCode:'S1',field:'value',from:'0.480',to:'0.490',reason:'舊紀錄'}]`);
 assert.equal((h.run('resultRows(calculate(project))').match(/※已更正/g)||[]).length,0);
 assert.match(h.run('summaryChecks(calculate(project))'),/歷史更正/);
});

test('LS02 cancelling a case transition releases its media gate',async()=>{
 const h=recorded();h.run('confirmReplacement=async()=>false');const before=h.run('project.id');await h.node('#newCase').onclick();assert.equal(h.run('project.id'),before);assert.equal(h.run('caseTransition'),false);
});
test('LS02 failed persistence can be retried without poisoning the operation queue',async()=>{
 let fail=true;const h=recorded({saveProject:async()=>{if(fail)throw Error('full')}});const before=h.run('project.id');await h.node('#newCase').onclick();assert.equal(h.run('project.id'),before);fail=false;await h.node('#newCase').onclick();assert.notEqual(h.run('project.id'),before);
});
test('LS04 observation identity survives role conversion and undo',async()=>{
 const h=recorded();h.run(`editReason=async()=> '複核';project.setups[0].fsPointId='';project.setups[0].fs='';`);
 await h.dispatch('change',{id:'',dataset:{isValue:'0:1'},value:'0.502'});const id=h.run('project.setups[0].intermediate[1].observationId');assert.ok(id);
 h.click({convertIs:'0:1'});assert.equal(h.run('project.setups[0].fsObservationId'),id);assert.match(h.run('resultRows(calculate(project))'),/已更正/);
 h.run('undoLast()');assert.equal(h.run('project.setups[0].intermediate[1].observationId'),id);
 h.click({convertIs:'0:1'});h.click({convertFs:'0'});assert.equal(h.run('project.setups[0].intermediate.at(-1).observationId'),id);
});

test('LS02 pending case transition rejects new media and reading input mutations',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);const h=recorded({saveMedia:async()=>gate});h.context.image=new Blob(['png'],{type:'image/png'});h.context.image.name='old.png';
 const media=h.run(`addImage(image,'equipment')`);const replace=h.node('#newCase').onclick();
 await h.dispatch('input',{id:'startHeight',dataset:{},value:'99'});assert.equal(h.run('project.route.startHeight'),'10.000');assert.equal(await h.run(`addImage(image,'equipment')`),false);
 release();await media;await replace;assert.equal(h.run('project.equipmentPhotos.length'),0);
});
