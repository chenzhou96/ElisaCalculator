import test from 'node:test'
import assert from 'node:assert/strict'
import {initialWorkspace} from '../src/workbench/model.ts'
import {plateExample} from '../src/workbench/plate.ts'
import {parseRecord, serializeRecord, RECORD_SCHEMA, LEGACY_RECORD_SCHEMA} from '../src/workbench/record.ts'
import {completeResult, workspaceWithResult} from './snapshot-fixture.mjs'

function record(patch = {}, schema = RECORD_SCHEMA) {
  return {schema, saved_at: '2026-10-03T09:00:00.000Z', inputs: {...structuredClone(initialWorkspace), rawText: 'X,Y\n1,2', ...patch}, result: null}
}

test('v2 snapshot retains full unrounded response, report, plots, inputs and references without recomputation', () => {
  const state = workspaceWithResult()
  state.plate = plateExample('comparative')
  state.options.reference_assigned_value = 10
  state.options.replicate_groups = {Reference: ['Reference_1', 'Reference_2']}
  state.options.unknown_samples = [{sample_id: 'retained', od: [0.12345678912345678], dilution_factor: 2}]
  const serialized = serializeRecord(state, '2026-10-03T09:00:00.000Z')
  const data = JSON.parse(serialized)
  assert.equal(data.schema, RECORD_SCHEMA)
  assert.equal(data.app_version, '0.3.1')
  assert.deepEqual(data.result, state.result)
  const restored = parseRecord(serialized)
  assert.equal(restored.rawText, state.rawText)
  assert.equal(restored.source, state.source)
  assert.deepEqual(restored.plate, state.plate)
  assert.deepEqual(restored.options, state.options)
  assert.deepEqual(restored.parsed, state.parsed)
  assert.deepEqual(restored.result, state.result)
  assert.equal(restored.resultOrigin, 'historical')
  assert.equal(restored.recordSavedAt, '2026-10-03T09:00:00.000Z')
  assert.equal(restored.compatibilityMessage, '')
  assert.equal(restored.result.report.summary_rows[0].EC50, 0.17677669529663692)
  assert.equal(restored.result.report.comparison.notes, 'preserve backend-only metadata')
})

test('v1 restores only legacy inputs and preserves standard and unknown data without inventing fits', () => {
  const old = record({inputView: 'table', options: {...initialWorkspace.options, workflow: 'standard_curve', standard_group: 'Std', reference_assigned_value: 12, replicate_groups: {Std: ['one', 'two']}, unknown_samples: [{sample_id: 'old sample', od: [0.1234], dilution_factor: 5}]}, unknowns: [{sample: 'Legacy', od: '0.1234; 0.1235', dilution: '5'}], plate: plateExample('standard_curve')}, LEGACY_RECORD_SCHEMA)
  // The old schema's result is not a trustworthy complete snapshot, even if populated.
  old.result = {ok: true, results: [{bogus: 'old rounded output'}]}
  const restored = parseRecord(JSON.stringify(old))
  assert.equal(restored.inputView, 'table')
  assert.equal(restored.options.workflow, 'standard_curve')
  assert.deepEqual(restored.options.replicate_groups, {Std: ['one', 'two']})
  assert.deepEqual(restored.options.unknown_samples, old.inputs.options.unknown_samples)
  assert.equal(restored.unknowns[0].od, '0.1234; 0.1235')
  assert.ok(restored.plate.wells.some(w => w.kind === 'unknown'))
  assert.ok(restored.plate.wells.some(w => w.kind === 'standard'))
  assert.equal(restored.result, null)
  assert.equal(restored.resultOrigin, null)
  assert.match(restored.compatibilityMessage, /v1/)
  assert.match(restored.compatibilityMessage, /表格/)
  assert.match(restored.compatibilityMessage, /未知样品/)
})

test('v2 legacy standard snapshots retain computed unknown results as historical while marking compatibility', () => {
  const state = workspaceWithResult()
  state.inputView = 'table'
  state.options.workflow = 'standard_curve'
  state.result.report.unknown_results = [{Sample:'Retained sample', Standard_group:'Std', OD_raw:[0.12345678912345678], OD_processed:0.12345678912345678, Dilution_factor:5, Log_concentration:null, Concentration:null, Corrected_concentration:null, Concentration_unit:'ng/mL', Status:'Suppressed', Warning:'out of range', warning_list:['out of range']}]
  const restored = parseRecord(serializeRecord(state))
  assert.deepEqual(restored.result.report.unknown_results, state.result.report.unknown_results)
  assert.match(restored.compatibilityMessage, /标准曲线/)
  assert.equal(restored.resultOrigin, 'historical')
})

test('records reject missing schema, missing raw text, timestamp and invalid option enums', () => {
  for (const invalid of [{}, {schema: RECORD_SCHEMA}, {...record(), schema: 'different/1'}, record({rawText: 123}), {...record(), saved_at: null}, {...record(), saved_at: 'yesterday'}]) assert.throws(() => parseRecord(JSON.stringify(invalid)))
  for (const key of ['workflow', 'input_mode', 'fit_mode', 'dilution_direction', 'blank_mode', 'replicate_mode']) assert.throws(() => parseRecord(JSON.stringify(record({options: {[key]: 'invalid'}}))), key)
  assert.throws(() => parseRecord('invalid JSON'))
})

test('records reject malformed unknown sample tables and issue fresh row IDs', () => {
  for (const unknowns of [{}, [null], [{sample: 'S', od: 0.3, dilution: '1'}], [{sample: 'S', od: '0.3', dilution: 1}]]) assert.throws(() => parseRecord(JSON.stringify(record({unknowns}))))
  const restored = parseRecord(JSON.stringify(record({unknowns: [{id: 'dup', sample: 'One', od: '0.3', dilution: '1'}, {id: 'dup', sample: 'Two', od: '0.4', dilution: '2'}]})))
  assert.deepEqual(restored.unknowns.map(sample => sample.id), ['restored-0', 'restored-1'])
})

test('records reject invalid scalar settings, malformed mappings and oversized editor fields', () => {
  for (const options of [{reference_group:{}}, {standard_group:[]}, {concentration_unit:{}}, {dilution_factor:'2'}, {first_step:null}, {reference_assigned_value:'10'}, {blank_value:{}}, {allow_extrapolation:'false'}, {replicate_groups:{bad:[{}]}}, {unknown_samples:[{}]}]) assert.throws(() => parseRecord(JSON.stringify(record({options}))), JSON.stringify(options))
  assert.throws(() => parseRecord(JSON.stringify(record({saveOutputs:'false'}))))
  assert.throws(() => parseRecord(JSON.stringify(record({source:'a'.repeat(16385)}))))
  assert.throws(() => parseRecord(JSON.stringify(record({unknowns:Array(4097).fill({sample:'a',od:'1',dilution:'1'})}))))
  assert.throws(() => parseRecord(JSON.stringify(record({rawText:'a'.repeat(4 * 1024 * 1024 + 1)}))))
})

test('malformed stored results and remote/SVG plot URLs are rejected before restoration', () => {
  const mutations = [
    r => {r.ok = 'true'},
    r => {r.report = null},
    r => {r.report.summary_rows = [{}]},
    r => {r.report.summary_rows[0].EC50 = '0.123'},
    r => {r.results[0].EC50 = 999},
    r => {r.previews[0].data_url = 'data:image/png;base64,AA=='},
    r => {r.report.detailed_rows[0].params.C = '0.2'},
    r => {r.report.detailed_rows[0].x = [1,2]},
    r => {r.report.detailed_rows[0].y_pred = [1,2]},
    r => {r.previews[0].data_url = 'https://remote.example/plot.png'},
    r => {r.previews[0].data_url = 'data:image/svg+xml;base64,PHN2Zz4='},
    r => {r.report.unknown_results = [{}]},
    r => {r.report.detailed_rows[0].processed_points[0].included = 'false'},
  ]
  for (const mutate of mutations) {
    const saved = record(); saved.result = completeResult(); mutate(saved.result)
    assert.throws(() => parseRecord(JSON.stringify(saved)))
  }
  const nonfinite = workspaceWithResult(); nonfinite.result.report.summary_rows[0].EC50 = Infinity
  assert.throws(() => serializeRecord(nonfinite), /有限/)
  assert.throws(() => parseRecord(JSON.stringify(record()).replace('"result":null', '"result":{"ok":false,"removed_count":1e999}')), /有限/)
})

test('raw audit strings, missing values and failed computations roundtrip without numerical coercion', () => {
  const state = workspaceWithResult()
  state.result.report.detailed_rows[0].raw_x = ['bad dose', null, 0]
  state.result.report.detailed_rows[0].raw_y = ['0.5000', '', null]
  state.result.report.detailed_rows[0].processed_points.push({source_row:2, source_column:'R', raw_x:'bad dose', raw_y:null, log_dose:null, processed_y:null, included:false, exclusion_reason:'not numeric'})
  const restored = parseRecord(serializeRecord(state))
  assert.deepEqual(restored.result.report.detailed_rows[0].raw_x, state.result.report.detailed_rows[0].raw_x)
  const failed = {...structuredClone(initialWorkspace), result:{ok:false,error:'fit failed',report:null,results:[],previews:[]}}
  assert.deepEqual(parseRecord(serializeRecord(failed)).result, failed.result)
})


test('legacy group names and backend-only object keys survive safely without prototype mutation', () => {
  const state = workspaceWithResult()
  state.options = JSON.parse(JSON.stringify(state.options).replace('"replicate_groups":{}', '"replicate_groups":{"constructor":["constructor_1"],"__proto__":["prototype_1"]}'))
  state.options = {...state.options, ...JSON.parse('{"__proto__":{"polluted":true}}')}
  state.result.report.metadata.groups = JSON.parse('{"constructor":{"value":1},"__proto__":{"value":2}}')
  const restored = parseRecord(serializeRecord(state))
  assert.deepEqual(restored.options.replicate_groups, state.options.replicate_groups)
  assert.deepEqual(restored.result.report.metadata.groups, state.result.report.metadata.groups)
  assert.equal(Object.getPrototypeOf(restored.options), Object.prototype)
  assert.equal({}.polluted, undefined)
})
