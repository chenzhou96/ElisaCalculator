import test from 'node:test'
import assert from 'node:assert/strict'
import {evaluateNumber,evaluateList} from '../src/workbench/arithmetic.ts'
import {numericOD,plateExample,compilePlate} from '../src/workbench/plate.ts'
import {defaultOptions} from '../src/workbench/model.ts'
test('four operators, parentheses, signs, decimals and scientific notation',()=>{
 for(const [input,expected] of [['=1/20',.05],['=(2+3)*4-6/2',17],['=-(1+2)/6',-.5],['1e-3+2E-3',.003],['01/20',.05],['=2×3÷4',1.5]])assert.equal(evaluateNumber(input),expected,input)
 assert.deepEqual(evaluateList('=1/20; =(2+3)/10'),[.05,.5])
 assert.deepEqual(evaluateList('0.1 0.2; 0.3'),[.1,.2,.3])
 assert.equal(numericOD('=1/20'),.05)
})
test('invalid, division by zero and executable expressions rejected',()=>{
 for(const text of ['=1/0','=1+','=2**3','1//2','NaN','Infinity','1e309','alert(1)','globalThis.x=1','((2)', '('.repeat(65)+'1'+')'.repeat(65)])assert.throws(()=>evaluateNumber(text),undefined,text)
})
test('plate expressions preserve raw identity and allow doses greater than one',()=>{
 const p=plateExample('comparative');p.wells.find(w=>w.id==='A1').raw='=1/20'
 for(const w of p.wells)if(w.kind==='comparison')w.dose*=20
 const c=compilePlate(p,{...defaultOptions,reference_group:'Reference'})
 assert.equal(c.ok,true,c.errors.join());assert.equal(c.mapping.rows.find(r=>r.well==='A1').raw,'=1/20')
 assert.ok(Math.abs(c.mapping.rows.find(r=>r.well==='A1').processedOD-.03)<1e-12)
 assert.equal(c.options.dose_basis,'dimensionless')
})
