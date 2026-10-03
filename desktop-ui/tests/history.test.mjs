import test from 'node:test'
import assert from 'node:assert/strict'
import {createHistoryService, createNativeHistoryBackend, historyEntry, validateHistoryId} from '../src/workbench/history.ts'
import {serializeRecord} from '../src/workbench/record.ts'
import {workspaceWithResult} from './snapshot-fixture.mjs'
function memoryBackend(patch = {}) {
  const snapshots = new Map()
  let session = null
  return {kind:'test',description:'test transaction',save:async(id,text)=>{if(snapshots.has(id))throw new Error('duplicate');snapshots.set(id,text)},list:async()=>[...snapshots].map(([id,text])=>historyEntry(id,text)),read:async id=>{if(!snapshots.has(id))throw new Error('missing');return snapshots.get(id)},saveSession:async text=>{session=text},readSession:async()=>session,...patch}
}
function ids() {let n=0;return ()=>`analysis-${++n}`}

test('history roundtrips complete snapshots and restart recovery without running the engine', async()=>{
  const backend = memoryBackend(), first = createHistoryService(backend,ids()), state=workspaceWithResult()
  const entry=await first.save(state)
  assert.equal(entry.hasResult,true);assert.equal(entry.groupCount,1)
  state.options.reference_assigned_value=99
  const reopened=createHistoryService(backend,ids())
  const recalled=await reopened.recall(entry.id)
  assert.deepEqual(recalled.result,state.result)
  assert.equal(recalled.options.reference_assigned_value,1)
  assert.equal(recalled.resultOrigin,'historical')
  assert.equal((await reopened.restoreSession()).resultOrigin,'historical')
  await reopened.saveSession({...state,result:null})
  assert.equal((await first.restoreSession()).result,null)
  assert.equal((await first.list()).length,1,'draft autosave does not clutter analysis history')
})

test('queued writes capture immediately, execute in call order and survive a failed operation',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve});const written=[];let fail=true
  const backend=memoryBackend({saveSession:async text=>{await gate;if(fail){fail=false;throw new Error('disk full')}written.push(JSON.parse(text).inputs.source)}})
  const service=createHistoryService(backend,ids()),state=workspaceWithResult()
  const one=service.saveSession({...state,source:'first'}),two=service.saveSession({...state,source:'second'})
  state.source='later mutation';release()
  await assert.rejects(one,/disk full/);await two
  assert.deepEqual(written,['second'])
  await service.saveSession({...state,source:'retry'})
  assert.deepEqual(written,['second','retry'])
})

test('save resolves only after backend commit and rejected writes are not reported as saved',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve});let committed=false
  const backend=memoryBackend({save:async()=>{await gate;committed=true}})
  const service=createHistoryService(backend,ids());let resolved=false
  const saved=service.save(workspaceWithResult()).then(entry=>{resolved=true;return entry})
  await new Promise(resolve=>setImmediate(resolve));assert.equal(resolved,false)
  release();await saved;assert.equal(committed,true)
  const failed=createHistoryService(memoryBackend({save:async()=>{throw new Error('quota')}}),ids())
  await assert.rejects(failed.save(workspaceWithResult()),/quota/)
})

test('corrupt recovery and malformed history never silently fall back or call native calculation',async()=>{
  const backend=memoryBackend({readSession:async()=>'not JSON'})
  const service=createHistoryService(backend,ids());await service.save(workspaceWithResult())
  await assert.rejects(service.restoreSession())
  const damaged=createHistoryService(memoryBackend({read:async()=>'{"schema":"elisa-analysis/2","inputs":{}}'}),ids())
  await assert.rejects(damaged.recall('broken'))
  for(const id of ['../escape','a/b','a\\b','', '.hidden','x.json','汉字'])assert.throws(()=>validateHistoryId(id))
})

test('native backend uses only durable history command contracts and propagates failures',async()=>{
  const calls=[]
  const native=createNativeHistoryBackend(async(command,args)=>{calls.push([command,args]);if(command==='read_last_session')return null;if(command==='list_history_snapshots')return [];if(command==='read_history_snapshot')return serializeRecord(workspaceWithResult());if(command==='save_last_session')throw new Error('native write denied')})
  const service=createHistoryService(native,ids())
  const entry=await service.save(workspaceWithResult());await service.recall(entry.id);await service.list()
  await assert.rejects(service.saveSession(workspaceWithResult()),/native write denied/)
  assert.equal(await service.restoreSession(),null)
  assert.ok(calls.every(([command])=>!['run_bridge','read_file_base64'].includes(command)))
  assert.deepEqual(calls.map(([command])=>command),['save_history_snapshot','read_history_snapshot','list_history_snapshots','save_last_session','read_last_session','list_history_snapshots'])
  assert.match(native.description,/应用数据目录/)
})
