import test from 'node:test'
import assert from 'node:assert/strict'
import {IDBFactory, IDBDatabase, IDBObjectStore} from 'fake-indexeddb'
import {createBrowserHistoryBackend, createHistoryService, defaultHistoryService} from '../src/workbench/history.ts'
import {serializeRecord} from '../src/workbench/record.ts'
import {workspaceWithResult} from './snapshot-fixture.mjs'
function service(factory=new IDBFactory()){let n=0;return createHistoryService(createBrowserHistoryBackend(factory),()=>`browser-${++n}`)}
async function edit(factory, store, key, value) {
  const db = await new Promise((resolve,reject)=>{const r=factory.open('elisa-analysis-history',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
  await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})
  db.close()
}

test('IndexedDB full snapshots survive service restart, with session and history separate',async()=>{
  const factory=new IDBFactory(),one=service(factory),state=workspaceWithResult()
  const entry=await one.save(state)
  await one.saveSession({...state,source:'unsaved edits',result:null})
  const two=service(factory),history=await two.list(),restored=await two.recall(entry.id),session=await two.restoreSession()
  assert.equal(history.length,1)
  assert.deepEqual(restored.result,state.result)
  assert.equal(restored.resultOrigin,'historical')
  assert.equal(session.source,'unsaved edits')
  assert.equal(session.result,null)
})

test('readwrite transactions request strict durability and return only after commit',async()=>{
  const transaction=IDBDatabase.prototype.transaction, options=[]
  IDBDatabase.prototype.transaction=function(stores,mode,opts){if(mode==='readwrite')options.push(opts);return transaction.call(this,stores,mode,opts)}
  try {
    const history=service();const entry=await history.save(workspaceWithResult());await history.saveSession(workspaceWithResult())
    assert.deepEqual((await history.recall(entry.id)).result,workspaceWithResult().result)
    assert.equal(options.length,2)
    assert.ok(options.every(option=>option?.durability==='strict'))
  } finally {IDBDatabase.prototype.transaction=transaction}
})

test('a browser that ignores strict durability is rejected rather than silently weakening persistence',async()=>{
  const transaction=IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction=function(stores,mode,opts){const tx=transaction.call(this,stores,mode,opts);if(mode==='readwrite')Object.defineProperty(tx,'durability',{value:'relaxed'});return tx}
  const factory=new IDBFactory(),history=service(factory)
  try {await assert.rejects(history.saveSession(workspaceWithResult()),/不支持严格持久化/)}
  finally {IDBDatabase.prototype.transaction=transaction}
  assert.equal(await history.restoreSession(),null)
  await history.saveSession(workspaceWithResult())
  assert.ok(await history.restoreSession())
})

test('aborted session overwrite rolls back to prior data and a retry remains possible',async()=>{
  const factory=new IDBFactory(),history=service(factory),old=workspaceWithResult()
  await history.saveSession({...old,source:'old durable session'})
  const put=IDBObjectStore.prototype.put
  let abort=true
  IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);if(abort&&this.name==='session'){abort=false;this.transaction.abort()}return request}
  try {await assert.rejects(history.saveSession({...old,source:'must roll back'}),/回滚|失败|abort/i)}
  finally {IDBObjectStore.prototype.put=put}
  assert.equal((await service(factory).restoreSession()).source,'old durable session')
  await history.saveSession({...old,source:'retried committed session'})
  assert.equal((await service(factory).restoreSession()).source,'retried committed session')
})

test('aborted snapshot transaction cannot publish a phantom saved history item',async()=>{
  const factory=new IDBFactory(),history=service(factory),add=IDBObjectStore.prototype.add
  IDBObjectStore.prototype.add=function(...args){const request=add.apply(this,args);this.transaction.abort();return request}
  try {await assert.rejects(history.save(workspaceWithResult()))}
  finally {IDBObjectStore.prototype.add=add}
  assert.deepEqual(await service(factory).list(),[])
  const entry=await history.save(workspaceWithResult())
  assert.equal((await history.list())[0].id,entry.id)
})

test('concurrent windows publish immutable IDs transactionally and equal retry is idempotent',async()=>{
  const factory=new IDBFactory(),a=createBrowserHistoryBackend(factory),b=createBrowserHistoryBackend(factory)
  const first=serializeRecord(workspaceWithResult(),'2026-10-03T01:00:00.000Z')
  const second=serializeRecord({...workspaceWithResult(),source:'different'},'2026-10-03T02:00:00.000Z')
  const responses=await Promise.allSettled([a.save('same-id',first),b.save('same-id',second)])
  assert.equal(responses.filter(r=>r.status==='fulfilled').length,1)
  assert.equal(responses.filter(r=>r.status==='rejected').length,1)
  const stored=await a.read('same-id')
  await b.save('same-id',stored)
  assert.equal((await a.list()).length,1)
  await assert.rejects(a.save('same-id',stored===first?second:first),/不能覆盖/)
})

test('missing or denied browser storage fails visibly without falling back to memory/localStorage',async()=>{
  const denied=createBrowserHistoryBackend({open(){throw new DOMException('quota denied','QuotaExceededError')}})
  const history=createHistoryService(denied)
  await assert.rejects(history.saveSession(workspaceWithResult()),/quota denied/)
  const previous=globalThis.indexedDB
  delete globalThis.indexedDB
  try {await assert.rejects(defaultHistoryService.restoreSession(),/IndexedDB/)}
  finally {if(previous!==undefined)globalThis.indexedDB=previous}
})

test('factory replacement gets a new database connection and does not leak prior test/site state',async()=>{
  const previous=globalThis.indexedDB
  try {
    globalThis.indexedDB=new IDBFactory()
    await defaultHistoryService.saveSession({...workspaceWithResult(),source:'first database'})
    assert.equal((await defaultHistoryService.restoreSession()).source,'first database')
    globalThis.indexedDB=new IDBFactory()
    assert.equal(await defaultHistoryService.restoreSession(),null)
  } finally {if(previous===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previous}
})

test('corrupt stored session is an error and never restores another valid history silently',async()=>{
  const factory=new IDBFactory(),history=service(factory)
  await history.save(workspaceWithResult())
  await edit(factory,'session','last','not a snapshot')
  await assert.rejects(history.restoreSession())
  await edit(factory,'session','last',{malformed:'data'})
  await assert.rejects(history.restoreSession(),/损坏/)
})

test('damaged snapshot metadata or text stays visible without hiding valid history', async () => {
  const factory=new IDBFactory(),history=service(factory),good=await history.save(workspaceWithResult())
  const db=await new Promise((resolve,reject)=>{const r=factory.open('elisa-analysis-history',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
  await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').add({id:'damaged',text:'not JSON'});tx.objectStore('snapshots').add({id:'stale-cache',text:serializeRecord(workspaceWithResult()),entry:{invalid:'cache'}});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})
  db.close()
  const list=await history.list()
  assert.equal(list.length,3)
  assert.ok(list.find(entry=>entry.id==='damaged').error)
  assert.equal(list.find(entry=>entry.id==='stale-cache').hasResult,true)
  assert.deepEqual((await history.recall(good.id)).result,workspaceWithResult().result)
  await assert.rejects(history.recall('damaged'))
})
