import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {readFileSync} from 'node:fs'
import {plateExample,compilePlate,assignWells} from '../src/workbench/plate.ts'
import {defaultOptions,initialWorkspace} from '../src/workbench/model.ts'
import {serializeRecord,parseRecord} from '../src/workbench/record.ts'
const repo=fileURLToPath(new URL('../../',import.meta.url))
const options={...defaultOptions,reference_group:'Reference',reference_assigned_value:10}
const well=(p,id)=>p.wells.find(w=>w.id===id)
function execute(raw_text,analysis_options,plate_mapping){
 const r=spawnSync(process.env.ELISA_PYTHON||'python',['-m','elisa_calculator.bridge'],{cwd:repo,input:JSON.stringify({command:'run',raw_text,analysis_options,plate_mapping,header_mode:'present',x_col_name:raw_text.split('\n')[0].split(/[\t,]/)[0],save_outputs:false}),encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,MPLCONFIGDIR:'/tmp/elisa-plate-science-mpl',XDG_CACHE_HOME:'/tmp/elisa-plate-science-cache'}})
 assert.equal(r.status,0,r.stderr);const body=JSON.parse(r.stdout);assert.equal(body.ok,true,body.error);return body.report
}
function run(p,o=options){const c=compilePlate(p,o);assert.equal(c.ok,true,c.errors.join('\n'));return execute(c.rawText,c.options,c.mapping)}
function close(actual,expected,tol=1e-5){assert.ok(Math.abs(actual-expected)<tol,`${actual} ≠ ${expected}`)}

test('independent comparison truth: relative plate and existing table produce 10X and 40X',()=>{
 const p=plateExample('comparative'),report=run(p)
 close(report.summary_rows.find(r=>r.Group==='Reference').Relative_stock_potency_X,10)
 const sample=report.summary_rows.find(r=>r.Group==='Sample_4X');close(sample.Relative_stock_potency_X,40)
 assert.equal(report.metadata.plate_mapping.rows.length,96);assert.equal(report.metadata.plate_mapping.rows.find(r=>r.well==='A1').raw,well(p,'A1').raw)
 const fixture=JSON.parse(readFileSync(repo+'examples/comparison_request.json','utf8'))
 const table=execute(fixture.raw_text,{...defaultOptions,...fixture.analysis_options},undefined)
 close(sample.EC50,table.summary_rows.find(r=>r.Group==='Sample_4X').EC50)
})
test('explicit replicate weighting: 16 observations vs 8 dose means retain correct truth',()=>{
 const p=plateExample('comparative');const individual=run(p);p.replicateMode='mean';const mean=run(p)
 assert.equal(individual.summary_rows[0].N,16);assert.equal(mean.summary_rows[0].N,8)
 close(mean.summary_rows.find(r=>r.Group==='Sample_4X').Relative_stock_potency_X,40)
})
test('standard 12×5=60 and restored 4×10=40; dilution and blank each applied once',()=>{
 const p=plateExample('standard_curve'), o={...options,workflow:'standard_curve',standard_group:'Standard',fit_mode:'independent'}
 const report=run(p,o),known=report.unknown_results.find(r=>r.Sample==='Known_truth_12')
 close(known.Concentration,12);close(known.Corrected_concentration,60)
 assert.equal(report.unknown_results.find(r=>r.Sample==='Below_range').Concentration,null)
 for(const id of ['A3','B3']){well(p,id).raw=String(.7046929169719343+.02);well(p,id).dilution=10}
 const restored=parseRecord(serializeRecord({...structuredClone(initialWorkspace),plate:p,options:o}))
 const once=run(restored.plate,restored.options).unknown_results.find(r=>r.Sample==='Known_truth_12')
 close(once.Concentration,4);close(once.Corrected_concentration,40)
})
test('extreme unknown OD cannot alter the fitted standard curve or its observations',()=>{
 const p=plateExample('standard_curve'),o={...options,workflow:'standard_curve',standard_group:'Standard',fit_mode:'independent'}
 const baseline=run(p,o);well(p,'A3').raw='99999';well(p,'B3').raw='99999';const changed=run(p,o)
 assert.deepEqual(changed.summary_rows,baseline.summary_rows);assert.deepEqual(changed.detailed_rows,baseline.detailed_rows)
 assert.equal(changed.unknown_results.find(r=>r.Sample==='Known_truth_12').Concentration,null)
})
test('same-group blanks, raw preservation and a negative corrected observation reach the engine uncut',()=>{
 const p=plateExample('comparative');p.blankMode='group';well(p,'A5').group='Reference';well(p,'B5').group='Sample_4X'
 for(const w of p.wells)if(w.group==='Sample_4X'&&w.kind==='comparison')w.raw=String(Number(w.raw)+.03)
 well(p,'B5').raw='.05';const report=run(p)
 close(report.summary_rows.find(r=>r.Group==='Sample_4X').Relative_stock_potency_X,40)
 well(p,'H1').raw='0';const negative=run(p)
 const point=negative.detailed_rows.find(r=>r.group_name==='Reference').processed_points.find(r=>r.processed_y===-.02)
 assert.ok(point,'negative value retained through actual engine')
 assert.equal(negative.metadata.plate_mapping.rows.find(r=>r.well==='H1').raw,'0')
})
test('different group factors and dose grids preserve relative stock fraction truth and sparse mapping',()=>{
 let p=plateExample('comparative')
 const ids=p.wells.filter(w=>w.group==='Sample_4X').map(w=>w.id)
 p=assignWells(p,ids,{kind:'comparison',group:'Sample_4X',start:.9,factor:3,direction:'decreasing',axis:'column',spacing:'physical',dilution:1})
 for(const w of p.wells.filter(w=>w.group==='Sample_4X'))w.raw=String(.08+2.8/(1+(.04419417382415922/w.dose)**1.8)+.02)
 const c=compilePlate(p,options);assert.equal(c.ok,true);assert.match(c.warnings.join(),/剂量不同/)
 const report=run(p);close(report.summary_rows.find(r=>r.Group==='Sample_4X').Relative_stock_potency_X,40)
 assert.equal(report.summary_rows.find(r=>r.Group==='Sample_4X').N,16)
})
test('unfit reference never produces a normalized X or EC50 ratio',()=>{
 const p=plateExample('comparative')
 for(const w of p.wells.filter(w=>w.group==='Reference'))w.raw='.5'
 const report=run(p,{...options,fit_mode:'independent'})
 for(const row of report.summary_rows){assert.equal(row.Relative_stock_potency_X,null);assert.equal(row.EC50_ratio,null)}
})
test('absolute input does not fabricate unknown stock concentration or stock X',()=>{
 const p=plateExample('comparative');p.basis='absolute';p.unit='nM'
 const report=run(p);assert.equal(report.summary_rows.find(r=>r.Group==='Sample_4X').Relative_stock_potency_X,null)
 assert.match(report.summary_rows.find(r=>r.Group==='Sample_4X').Warning,/original-stock potency unavailable/)
})
test('opposite directions suppress ratios; nonparallel output explicitly limits midpoint interpretation',()=>{
 const p=plateExample('comparative');const a=.08,d=2.88,c=Math.log10(.0625)
 for(const w of p.wells.filter(w=>w.group==='Sample_4X'))w.raw=String(a+(d-a)/(1+10**(3.2*(c-Math.log10(w.dose))))+.02)
 const nonparallel=run(p);assert.match(nonparallel.summary_rows.find(r=>r.Group==='Sample_4X').Warning,/nonparallel slopes/)
 assert.match(nonparallel.comparison.interpretation,/common potency.*not established/)
 const values=p.wells.filter(w=>w.group==='Sample_4X').map(w=>w.raw)
 for(const col of [3,4]){const ws=p.wells.filter(w=>w.group==='Sample_4X'&&w.id.endsWith(String(col)));for(let i=0;i<8;i++)ws[i].raw=values[7-i]}
 const opposite=run(p).summary_rows.find(r=>r.Group==='Sample_4X');assert.equal(opposite.Relative_stock_potency_X,null);assert.equal(opposite.EC50_ratio,null)
})

test('legal quoted group names survive actual TSV parse and retain reference normalization',()=>{
 const p=plateExample('comparative');for(const w of p.wells)if(w.group==='Reference')w.group='"Reference"'
 const c=compilePlate(p,{...options,reference_group:'"Reference"'});assert.equal(c.ok,true);assert.match(c.rawText,/""Reference""/)
 const report=run(p,{...options,reference_group:'"Reference"'})
 close(report.summary_rows.find(r=>r.Group==='"Reference"').Relative_stock_potency_X,10);close(report.summary_rows.find(r=>r.Group==='Sample_4X').Relative_stock_potency_X,40)
})
