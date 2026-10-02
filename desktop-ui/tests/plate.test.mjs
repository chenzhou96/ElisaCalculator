import test from 'node:test'
import assert from 'node:assert/strict'
import {createPlate, WELL_IDS, ROWS, previewPaste, applyPaste, numericOD, rectangleIds, selectWells, assignWells, compilePlate, plateExample, validatePlate} from '../src/workbench/plate.ts'
import {initialWorkspace, defaultOptions, reducer} from '../src/workbench/model.ts'
import {serializeRecord, parseRecord} from '../src/workbench/record.ts'
const assignment={kind:'comparison',group:'R',start:128,factor:2,direction:'decreasing',axis:'column',spacing:'physical',dilution:1}
const options={...defaultOptions,reference_group:'Reference',reference_assigned_value:10}
const od=(p,id)=>p.wells.find(w=>w.id===id)

test('96 distinct Excel coordinates remain row-major, including empty and trailing cells',()=>{
 const values=[...ROWS].map((r,i)=>Array.from({length:12},(_,c)=>String((i+1)*100+c+1)))
 values[0][0]='0';values[2][4]='';values[7][11]=''
 const pv=previewPaste(values.map(r=>r.join('\t')).join('\r\n')+'\r\n')
 assert.equal(pv.error,'');assert.equal(pv.cells.length,96);assert.equal(pv.columns,12)
 const p=applyPaste(createPlate(),pv,false,false)
 assert.equal(od(p,'A1').raw,'0');assert.equal(numericOD(od(p,'A1').raw),0)
 assert.equal(od(p,'A12').raw,'112');assert.equal(od(p,'H1').raw,'801')
 assert.equal(od(p,'C5').raw,'');assert.equal(od(p,'H12').raw,'');assert.equal(numericOD(''),null)
})
test('ragged, oversized, transposed, invalid and overwrite imports never partially mutate',()=>{
 const p=createPlate(), original=JSON.stringify(p)
 for(const s of ['1\t2\n3',Array(9).fill('1').join('\n'),Array(13).fill('1').join('\t')])assert.throws(()=>applyPaste(p,previewPaste(s),false,false))
 assert.throws(()=>applyPaste(p,previewPaste('0\tbad'),false,false));assert.equal(JSON.stringify(p),original)
 const next=applyPaste(p,previewPaste('0\tbad'),false,true)
 assert.equal(od(next,'A2').raw,'bad');assert.throws(()=>applyPaste(next,previewPaste('2'),false,false))
 assert.equal(od(applyPaste(next,previewPaste('2'),true,false),'A1').raw,'2')
})
test('single, toggle and rectangular selection use stable coordinates',()=>{
 let p=selectWells(createPlate(),'C3','single');p=selectWells(p,'A1','toggle')
 assert.deepEqual(p.selected,['A1','C3']);p=selectWells(p,'B2','range')
 assert.deepEqual(p.selected,['A1','A2','B1','B2']);assert.equal(rectangleIds('H12','G11').length,4)
})
test('duplicate columns restart 128 to 1 regardless of click order; each group has own gradient',()=>{
 let p=assignWells(createPlate(),rectangleIds('A1','H2').reverse(),assignment)
 for(const col of [1,2])for(let r=0;r<8;r++)assert.equal(od(p,`${ROWS[r]}${col}`).dose,128/2**r)
 p=assignWells(p,rectangleIds('A3','H3'),{...assignment,group:'S',start:1000,factor:3})
 assert.equal(od(p,'B3').dose,1000/3);assert.equal(od(p,'B1').dose,64)
 assert.throws(()=>assignWells(p,['A4'],{...assignment,factor:1}))
})
test('seven wells and missing physical positions distinguish physical from compact spacing',()=>{
 const ids=[...ROWS].filter(r=>r!=='C').map(r=>r+'1')
 const physical=assignWells(createPlate(),ids,assignment),compact=assignWells(createPlate(),ids,{...assignment,spacing:'compact'})
 assert.equal(od(physical,'D1').dose,16);assert.equal(od(compact,'D1').dose,32)
 assert.equal(od(physical,'C1').kind,'unassigned');assert.equal(od(compact,'H1').dose,2)
 const increasing=assignWells(createPlate(),['B1','B2','B3'],{...assignment,axis:'row',direction:'increasing',start:1})
 assert.equal(od(increasing,'B3').dose,4)
})
test('replicate columns and every source well are explicit; unknowns never enter standard fit',()=>{
 const c=compilePlate(plateExample('comparative'),options)
 assert.equal(c.ok,true);assert.equal(c.options.input_mode,'dilution_step');assert.equal(c.options.replicate_groups.Reference.length,2)
 assert.equal(c.mapping.rows.length,96);assert.notEqual(c.mapping.rows.find(r=>r.well==='A1').tableColumn,c.mapping.rows.find(r=>r.well==='A2').tableColumn)
 const p=plateExample('standard_curve'),o={...options,workflow:'standard_curve',standard_group:'Standard'}
 const before=compilePlate(p,o);od(p,'A3').raw='999999';const after=compilePlate(p,o)
 assert.equal(before.rawText,after.rawText);assert.equal(after.mapping.rows.find(r=>r.well==='A3').tableColumn,null)
 assert.equal(after.options.unknown_samples[0].od[0],999999-.02)
 const named=plateExample('comparative');for(const w of named.wells)if(w.group==='Reference')w.group='__proto__';const safe=compilePlate(named,{...options,reference_group:'__proto__'});assert.equal(safe.ok,true);assert.equal(Object.hasOwn(safe.options.replicate_groups,'__proto__'),true);assert.equal(JSON.parse(JSON.stringify(safe.options)).replicate_groups.__proto__.length,2)
})
test('blank scopes are explicit; missing group blocks, negatives retained and subtraction once',()=>{
 const p=plateExample('comparative');p.blankMode='group'
 let c=compilePlate(p,options);assert.equal(c.ok,false);assert.match(c.errors.join(),/不会回退/)
 od(p,'A5').group='Reference';od(p,'B5').group='Sample_4X';od(p,'A5').raw='.1';od(p,'B5').raw='.2'
 c=compilePlate(p,options);assert.equal(c.ok,true);assert.equal(c.mapping.rows.find(r=>r.well==='H1').blank,.1)
 assert.equal(c.options.blank_mode,'none');assert.equal(c.options.blank_value,0)
 od(p,'H1').raw='0';c=compilePlate(p,options);assert.equal(c.mapping.rows.find(r=>r.well==='H1').processedOD,-.1);assert.match(c.warnings.join(),/不裁零/)
 p.blankMode='none';assert.equal(compilePlate(p,options).mapping.rows.find(r=>r.well==='H1').processedOD,0)
})
test('missing/illegal included observations block; explicit exclude preserves raw identity',()=>{
 let p=plateExample('comparative');od(p,'A1').raw='bad'
 assert.equal(compilePlate(p,options).ok,false)
 p=assignWells(p,['A1'],{...assignment,kind:'excluded'})
 assert.equal(od(p,'A1').raw,'bad');assert.equal(od(p,'A1').group,'Reference');assert.equal(compilePlate(p,options).ok,true)
 od(p,'H2').raw='';assert.equal(compilePlate(p,options).ok,false)
})
test('standard reference, absolute units, unknown dilution and reference positivity are validated',()=>{
 const p=plateExample('standard_curve'), o={...options,workflow:'standard_curve',standard_group:'Standard'}
 assert.equal(compilePlate(p,o).ok,true);p.basis='relative';assert.equal(compilePlate(p,o).ok,false)
 p.basis='absolute';od(p,'B3').dilution=10;assert.equal(compilePlate(p,o).ok,false)
 assert.equal(compilePlate(plateExample('comparative'),{...options,reference_assigned_value:0}).ok,false)
 const relative=plateExample('comparative');od(relative,'A1').dose=2;assert.match(compilePlate(relative,options).errors.join(),/分数不能大于 1/)
})
test('atomic undo/redo restore plate and reference options and invalidate old async/results',()=>{
 let s=structuredClone(initialWorkspace);s=reducer(s,{type:'plate-example',workflow:'comparative'})
 const snapshot=JSON.stringify(s.plate);s={...s,result:{ok:true},parsed:{ok:true},busy:'run',request:1}
 s=reducer(s,{type:'options',patch:{reference_assigned_value:2}})
 assert.equal(s.result,null);assert.equal(s.parsed,null);const changedVersion=s.version
 s=reducer(s,{type:'plate-undo'});assert.equal(s.options.reference_assigned_value,10);assert.equal(JSON.stringify(s.plate),snapshot);assert.ok(s.version>changedVersion)
 s=reducer(s,{type:'plate-redo'});assert.equal(s.options.reference_assigned_value,2)
 const version=s.version;s=reducer(s,{type:'plate-selection',selected:['H12'],anchor:'H12'});assert.equal(s.version,version)
})
test('portable plate record retains raw, excluded, references and DF; table/plate views remain independent',()=>{
 let s=reducer(structuredClone(initialWorkspace),{type:'plate-example',workflow:'standard_curve'})
 s={...s,rawText:'Dose,T\n1,0',source:'legacy table'}
 const restored=parseRecord(serializeRecord(s));assert.deepEqual(restored.plate,s.plate);assert.equal(restored.options.standard_group,'Standard');assert.equal(od(restored.plate,'A3').dilution,5)
 const c=compilePlate(restored.plate,restored.options);assert.equal(c.mapping.rows.find(r=>r.well==='A3').blank,.02)
 s=reducer(s,{type:'view',view:'table'});s=reducer(s,{type:'view',view:'plate'});assert.equal(s.rawText,'Dose,T\n1,0');assert.equal(s.plate.wells.length,96)
})
test('malformed persisted coordinates/types and prototype kind names are rejected',()=>{
 for(const mutate of [p=>p.wells.reverse(),p=>p.wells[0].kind='constructor',p=>p.wells[0].dose=0,p=>p.wells[0].dilution=0,p=>p.wells.pop()]){
  const p=createPlate();mutate(p);assert.throws(()=>validatePlate(p))
 }
 assert.deepEqual(validatePlate(createPlate()).wells.map(w=>w.id),WELL_IDS)
})

test('each input view preserves its own reference, workflow and fit conventions across examples, undo and restore',()=>{
 let s=reducer(structuredClone(initialWorkspace),{type:'plate-example',workflow:'comparative'})
 s=reducer(s,{type:'options',patch:{reference_group:'Sample_4X',reference_assigned_value:7}})
 const raw=od(s.plate,'A1').raw;s=reducer(s,{type:'view',view:'table'})
 s=reducer(s,{type:'options',patch:{reference_group:'DifferentTableReference',reference_assigned_value:3,fit_mode:'independent'}})
 s=reducer(s,{type:'view',view:'plate'});assert.equal(s.options.reference_group,'Sample_4X');assert.equal(s.options.reference_assigned_value,7);assert.equal(s.options.fit_mode,'shared');assert.equal(od(s.plate,'A1').raw,raw)
 s=reducer(s,{type:'options',patch:{reference_assigned_value:8}});s=reducer(s,{type:'plate-undo'});assert.equal(s.options.reference_assigned_value,7)
 const restored=parseRecord(serializeRecord(s));assert.equal(restored.viewOptions.table.reference_group,'DifferentTableReference')
 s={...s,...restored};s=reducer(s,{type:'view',view:'table'});assert.equal(s.options.reference_assigned_value,3);assert.equal(s.options.fit_mode,'independent')
 s=reducer(s,{type:'example',workflow:'standard_curve'});s=reducer(s,{type:'view',view:'plate'});assert.equal(s.options.reference_group,'Sample_4X');assert.equal(s.options.workflow,'comparative')
 const legacy=JSON.parse(serializeRecord(s));delete legacy.inputs.viewOptions
 const old=parseRecord(JSON.stringify(legacy));assert.equal(old.options.reference_assigned_value,7);assert.equal(old.viewOptions.table.reference_assigned_value,defaultOptions.reference_assigned_value)
 const bad=JSON.parse(serializeRecord(s));bad.inputs.viewOptions.table.workflow='bad';assert.throws(()=>parseRecord(JSON.stringify(bad)))
})

test('plate parse preserves a non-first table X column for later table parsing and portable restoration',()=>{
 let s=reducer(structuredClone(initialWorkspace),{type:'plate-example',workflow:'comparative'})
 s=reducer(s,{type:'view',view:'table'});s={...s,xColumn:'CustomDose',rawText:'Reference,CustomDose\n2,1'}
 s=reducer(s,{type:'view',view:'plate'});s=reducer(s,{type:'begin',busy:'parse',request:1})
 s=reducer(s,{type:'parsed',request:1,version:s.version,response:{ok:true,meta:{columns:['Dose','Reference · 列 1 · 复孔 1']}}})
 assert.equal(s.xColumn,'CustomDose');assert.equal(parseRecord(serializeRecord(s)).xColumn,'CustomDose')
 s=reducer(s,{type:'view',view:'table'});s=reducer(s,{type:'begin',busy:'parse',request:2});s=reducer(s,{type:'parsed',request:2,version:s.version,response:{ok:true,meta:{columns:['Reference','CustomDose']}}});assert.equal(s.xColumn,'CustomDose')
})
