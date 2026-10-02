import test from 'node:test'
import assert from 'node:assert/strict'
import {initialWorkspace} from '../src/workbench/model.ts'
import {parseRecord, serializeRecord, RECORD_SCHEMA} from '../src/workbench/record.ts'

function record(patch = {}) {
  return {schema: RECORD_SCHEMA, inputs: {...structuredClone(initialWorkspace), rawText: 'X,Y\n1,2', ...patch}}
}

test('portable analysis record roundtrip preserves input options and stores the computed response', () => {
  const state = {...structuredClone(initialWorkspace), rawText: 'X,Y\n1,2', source: '实验数据.csv', options: {...initialWorkspace.options, reference_assigned_value: 10}, result: {ok: true, results: []}}
  const serialized = serializeRecord(state)
  const data = JSON.parse(serialized)
  assert.equal(data.schema, RECORD_SCHEMA)
  assert.equal(data.app_version, '0.2.0')
  assert.deepEqual(data.result, state.result)
  const restored = parseRecord(serialized)
  assert.equal(restored.rawText, state.rawText)
  assert.equal(restored.source, state.source)
  assert.equal(restored.options.reference_assigned_value, 10)
  assert.equal(restored.result, undefined, 'serialized old results are deliberately not imported as current')
})

test('portable records reject missing schema, missing raw text and invalid option enums', () => {
  for (const invalid of [{}, {schema: RECORD_SCHEMA}, {...record(), schema: 'different/1'}, record({rawText: 123})]) {
    assert.throws(() => parseRecord(JSON.stringify(invalid)))
  }
  for (const key of ['workflow', 'input_mode', 'fit_mode', 'dilution_direction', 'blank_mode', 'replicate_mode']) {
    assert.throws(() => parseRecord(JSON.stringify(record({options: {[key]: 'invalid'}}))), key)
  }
  assert.throws(() => parseRecord('invalid JSON'))
})

test('portable records reject malformed unknown sample tables and issue fresh row IDs', () => {
  for (const unknowns of [{}, [null], [{sample: 'S', od: 0.3, dilution: '1'}], [{sample: 'S', od: '0.3', dilution: 1}]]) {
    assert.throws(() => parseRecord(JSON.stringify(record({unknowns}))))
  }
  const restored = parseRecord(JSON.stringify(record({unknowns: [{id: 'dup', sample: 'One', od: '0.3', dilution: '1'}, {id: 'dup', sample: 'Two', od: '0.4', dilution: '2'}]})))
  assert.deepEqual(restored.unknowns.map(sample => sample.id), ['restored-0', 'restored-1'])
})

test('portable records reject invalid scalar option types instead of accepting unsafe coercion', () => {
  for (const options of [{reference_group:{}}, {standard_group:[]}, {concentration_unit:{}}, {dilution_factor:'2'}, {first_step:null}, {reference_assigned_value:'10'}, {blank_value:{}}, {allow_extrapolation:'false'}]) {
    assert.throws(() => parseRecord(JSON.stringify(record({options}))), JSON.stringify(options))
  }
})
