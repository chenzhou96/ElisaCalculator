import test from 'node:test'
import assert from 'node:assert/strict'
import { initialWorkspace, defaultOptions, reducer, formatNumber, parseReplicateGroups, availableGroups, buildOptions, COMPARISON_EXAMPLE, STANDARD_EXAMPLE } from '../src/workbench/model.ts'

const parsed = { ok: true, meta: { columns: ['Step', 'Reference', 'Sample A', 'Sample B'] }, row_count: 8 }
const result = { ok: true, report: { fit_success: true, summary_rows: [], detailed_rows: [], global_params: {}, fit_error: '' } }
function state(patch = {}) {
  return { ...structuredClone(initialWorkspace), inputView: "table", parsed, xColumn: 'Step', options: { ...structuredClone(defaultOptions), reference_group: 'Reference' }, ...patch }
}
function standard(patch = {}) {
  return state({ ...patch, options: { ...structuredClone(defaultOptions), workflow: 'standard_curve', input_mode: 'raw_concentration', standard_group: 'Reference', ...patch.options }, unknowns: patch.unknowns ?? [{ id: 'one', sample: 'Unknown', od: '0.4; 0.5', dilution: '5' }] })
}

test('all input changes invalidate completed results, errors and request versions', async (t) => {
  for (const patch of [ {rawText: 'new'}, {source: 'file.csv'}, {headerMode: 'absent'}, {xColumn: 'Sample A'}, {replicateText: 'Pair = Reference, Sample A'}, {unknowns: []}, {saveOutputs: true} ]) {
    await t.test(Object.keys(patch)[0], () => {
      const before = state({ result, version: 10, error: 'old error' })
      const after = reducer(before, {type: 'input', patch})
      assert.equal(after.result, null)
      assert.equal(after.version, 11)
      assert.equal(after.error, '')
      assert.match(after.status, /重新计算/)
      assert.equal(after.parsed, ('rawText' in patch || 'headerMode' in patch) ? null : parsed)
      assert.equal(before.result, result, 'reducer must not mutate earlier state')
    })
  }
})

test('scientific option changes invalidate result and preserve parsed preview', () => {
  const before = state({ result, version: 2 })
  for (const patch of [{ reference_assigned_value: 10 }, { fit_mode: 'independent' }, { dilution_factor: 4 }, { blank_mode: 'constant' }, { allow_extrapolation: true }, { workflow: 'standard_curve' }]) {
    const after = reducer(before, { type: 'options', patch })
    assert.equal(after.result, null)
    assert.equal(after.parsed, parsed)
    assert.equal(after.version, 3)
    assert.deepEqual(after.options, {...before.options, ...patch})
  }
})

test('navigation preserves data, result and version', () => {
  const before = state({ result, version: 7 })
  const after = reducer(before, {type: 'page', page: 'plots'})
  assert.equal(after.page, 'plots')
  assert.equal(after.version, 7)
  assert.equal(after.result, result)
  assert.equal(after.options, before.options)
})

test('run and parse responses from an older input revision are ignored', async (t) => {
  for (const type of ['parsed', 'ran']) await t.test(type, () => {
    const pending = reducer(state({ version: 3 }), {type: 'begin', request: 12, busy: type === 'ran' ? 'run' : 'parse'})
    const edited = reducer(pending, {type: 'input', patch: {rawText: 'new user input'}})
    assert.equal(reducer(edited, {type, request: 12, version: 3, response: type === 'ran' ? result : parsed}), edited)
  })
})

test('superseded requests cannot replace data, errors, results or end a newer request', () => {
  const current = reducer(state({ version: 3 }), {type: 'begin', request: 13, busy: 'parse'})
  for (const action of [
    {type: 'loaded', request: 12, version: 3, text: 'old', source: 'old.csv'},
    {type: 'parsed', request: 12, version: 3, response: parsed},
    {type: 'ran', request: 12, version: 3, response: result},
    {type: 'error', request: 12, version: 3, error: 'late failure'},
    {type: 'end', request: 12},
  ]) assert.equal(reducer(current, action), current)
})

test('late file load never overwrites text typed after load began', () => {
  const pending = reducer(state({version: 4}), {type: 'begin', request: 4, busy: 'load'})
  const edited = reducer(pending, {type: 'input', patch: {rawText: 'newer pasted data'}})
  assert.equal(reducer(edited, {type: 'loaded', request: 4, version: 4, text: 'stale file', source: 'stale.csv'}), edited)
})

test('current file load clears preview, result and selected X axis', () => {
  const before = reducer(state({result, version: 4}), {type: 'begin', request: 4, busy: 'load'})
  const after = reducer(before, {type: 'loaded', request: 4, version: 4, text: 'latest', source: 'latest.csv'})
  assert.equal(after.rawText, 'latest')
  assert.equal(after.source, 'latest.csv')
  assert.equal(after.xColumn, '')
  assert.equal(after.parsed, null)
  assert.equal(after.result, null)
  assert.equal(after.version, 5)
})

test('reset and examples reject any formerly active response', () => {
  const before = state({request: 7, version: 4, result})
  for (const action of [{type: 'reset'}, {type: 'example', workflow: 'comparative'}, {type: 'example', workflow: 'standard_curve'}]) {
    const after = reducer(before, action)
    assert.equal(after.request, null)
    assert.equal(after.busy, null)
    assert.equal(after.result, null)
    assert.equal(after.parsed, null)
    assert.equal(after.version, 5)
    assert.equal(reducer(after, {type: 'ran', request: 7, version: 4, response: result}), after)
  }
})

test('current parsing preserves a valid X selection and falls back only if necessary', () => {
  const before = state({request: 8, version: 2})
  assert.equal(reducer(before, {type: 'parsed', request: 8, version: 2, response: parsed}).xColumn, 'Step')
  const changed = {ok: true, meta: {columns: ['Dose', 'Response']}}
  assert.equal(reducer(before, {type: 'parsed', request: 8, version: 2, response: changed}).xColumn, 'Dose')
})

test('run success navigates to results while run failure cannot leave a stale result', () => {
  const before = reducer(state({result, version: 2}), {type: 'begin', request: 10, busy: 'run'})
  assert.equal(before.result, null)
  const success = reducer(before, {type: 'ran', request: 10, version: 2, response: result})
  assert.equal(success.page, 'results')
  assert.equal(success.result, result)
  const failure = reducer(before, {type: 'ran', request: 10, version: 2, response: {ok: false, error: 'invalid'}})
  assert.deepEqual(failure.result, {ok: false, error: 'invalid'})
  assert.notEqual(failure.result, result)
  assert.equal(failure.result.report, undefined)
  assert.equal(failure.error, 'invalid')
})

test('export failure is distinct from computation failure', () => {
  const before = state({request: 10, version: 2})
  const response = {...result, export_error: 'read-only directory'}
  const after = reducer(before, {type: 'ran', request: 10, version: 2, response})
  assert.equal(after.result, response)
  assert.equal(after.error, '')
  assert.match(after.status, /导出失败/)
})

test('example datasets and options select consistent workflows', () => {
  const comparative = reducer(state(), {type: 'example', workflow: 'comparative'})
  assert.equal(comparative.rawText, COMPARISON_EXAMPLE)
  assert.equal(comparative.options.reference_group, 'Reference')
  assert.equal(comparative.options.input_mode, 'dilution_step')
  const calibration = reducer(state(), {type: 'example', workflow: 'standard_curve'})
  assert.equal(calibration.rawText, STANDARD_EXAMPLE)
  assert.equal(calibration.options.standard_group, 'Standard')
  assert.equal(calibration.options.input_mode, 'raw_concentration')
  assert.equal(calibration.options.fit_mode, 'independent')
})

test('scientific number formatting preserves small finite values and distinguishes missing values', () => {
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) assert.equal(formatNumber(value), '—')
  assert.equal(formatNumber(0), '0')
  assert.equal(formatNumber(-0), '0')
  assert.equal(formatNumber(1.2345678), '1.2346')
  assert.equal(formatNumber(0.00000012345678), '1.2346e-7')
  assert.equal(formatNumber(1.2345678e25), '1.2346e+25')
  assert.equal(formatNumber(-0.000012345678), '-0.000012346')
  assert.equal(formatNumber(1.2345678, 3), '1.23')
})

test('replicate mappings accept whitespace and Chinese separators without mutating column names', () => {
  assert.deepEqual(parseReplicateGroups(' Pair = Reference， Sample A\n\n Other = Sample B '), {Pair: ['Reference', 'Sample A'], Other: ['Sample B']})
  assert.deepEqual(parseReplicateGroups(' \n '), {})
  for (const invalid of ['missing equals', '= Reference', '  = Reference', 'A = ', 'A = Reference\nA = Sample A']) assert.throws(() => parseReplicateGroups(invalid))
})

test('group choices suppress member columns and retain ungrouped responses', () => {
  assert.deepEqual(availableGroups(state({replicateText: 'Pair = Reference, Sample A'})), ['Pair', 'Sample B'])
  assert.deepEqual(availableGroups(state({replicateText: 'malformed'})), ['Reference', 'Sample A', 'Sample B'])
})

test('comparison validates reference selection, finite positive assignment and dilution settings', () => {
  const input = state()
  assert.equal(buildOptions(input).reference_assigned_value, 1)
  for (const patch of [ {reference_group: null}, {reference_group: 'missing'}, {reference_assigned_value: 0}, {reference_assigned_value: -1}, {reference_assigned_value: NaN}, {dilution_factor: 1}, {dilution_factor: 11}, {dilution_factor: Infinity}, {first_step: NaN}, {start_concentration: 0}, {start_concentration: Infinity}, {blank_value: NaN} ]) {
    assert.throws(() => buildOptions({...input, options: {...input.options, ...patch}}), JSON.stringify(patch))
  }
  assert.equal(buildOptions({...input, options: {...input.options, reference_assigned_value: 10}}).reference_assigned_value, 10)
  assert.equal(buildOptions({...input, options: {...input.options, dilution_factor: 10}}).dilution_factor, 10)
})

test('replicate options reject X axis, absent columns and duplicated membership', () => {
  for (const replicateText of ['G = Step', 'G = absent', 'G = Reference, Reference', 'G = Reference\nH = Reference']) {
    assert.throws(() => buildOptions(state({replicateText})))
  }
  const input = state({replicateText: 'Pair = Reference, Sample A'})
  input.options.reference_group = 'Pair'
  assert.deepEqual(buildOptions(input).replicate_groups, {Pair: ['Reference', 'Sample A']})
})

test('standard workflow requires identified curve, absolute doses and a unit', () => {
  assert.equal(buildOptions(standard()).standard_group, 'Reference')
  for (const options of [ {standard_group: null}, {standard_group: 'missing'}, {concentration_unit: ' '}, {input_mode: 'dilution_step', start_concentration: null} ]) {
    assert.throws(() => buildOptions(standard({options})))
  }
  assert.equal(buildOptions(standard({options: {input_mode: 'dilution_step', start_concentration: 100}})).start_concentration, 100)
})

test('unknown OD replicates parse valid separators and preserve dilution correction', () => {
  const options = buildOptions(standard({unknowns: [{id: 'a', sample: ' Unknown A ', od: '0.1; 0.2，0.3；0.4\n0.5', dilution: '5'}]}))
  assert.deepEqual(options.unknown_samples, [{sample_id: 'Unknown A', od: [0.1, 0.2, 0.3, 0.4, 0.5], dilution_factor: 5}])
})

test('unknown inputs reject missing/duplicate names, missing/nonfinite OD and nonpositive dilution', () => {
  const good = {id: 'a', sample: 'Sample', od: '0.5', dilution: '1'}
  assert.throws(() => buildOptions(standard({unknowns: []})))
  assert.throws(() => buildOptions(standard({unknowns: [good, {...good, id: 'b', sample: ' Sample '}]})))
  for (const patch of [{sample: ''}, {sample: ' '}, {od: ''}, {od: '; ;'}, {od: 'NaN'}, {od: '0.2;Infinity'}, {od: 'word'}, {dilution: '0'}, {dilution: '0.5'}, {dilution: '-1'}, {dilution: ''}, {dilution: 'Infinity'}, {dilution: 'word'}]) {
    assert.throws(() => buildOptions(standard({unknowns: [{...good, ...patch}]})), JSON.stringify(patch))
  }
})

test('restoring a current portable record clears old results and requires revalidation', () => {
  const before = state({request: 18, version: 6, result})
  const workspace = {rawText: 'Restored input', source: 'record.json', headerMode: 'present', xColumn: 'Step', options: {...defaultOptions, reference_group: 'Reference'}, replicateText: '', unknowns: [], saveOutputs: false}
  const after = reducer(before, {type: 'restore', request: 18, version: 6, workspace})
  assert.equal(after.rawText, 'Restored input')
  assert.equal(after.result, null)
  assert.equal(after.parsed, null)
  assert.equal(after.version, 7)
})

test('late portable record restore cannot replace newer edited inputs', () => {
  const pending = reducer(state({version: 6}), {type: 'begin', request: 18, busy: 'load'})
  const edited = reducer(pending, {type: 'input', patch: {rawText: 'User edit while JSON file reads'}})
  const workspace = {...state(), rawText: 'Stale record'}
  assert.equal(reducer(edited, {type: 'restore', request: 18, version: 6, workspace}), edited)
})
