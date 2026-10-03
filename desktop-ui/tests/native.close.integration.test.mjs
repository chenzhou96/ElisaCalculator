import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
const repo=fileURLToPath(new URL('../../', import.meta.url))
test('native close locks writes, rejects duplicate close, retains window on disk failure, and persists before destroy', async () => {
const require=createRequire(`${repo}/desktop-ui/package.json`)
const {JSDOM}=require('jsdom'),React=require('react')
const {createServer}=await import(require.resolve('vite'))
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:1420'})
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Element','Node','MutationObserver','Event','MouseEvent'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true})
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.isTauri=true
const callbacks=new Map();let callbackId=0,closeHandler,gate=null,persisted=null,destroyed=0,saves=0
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}}
window.__TAURI_INTERNALS__={
 metadata:{currentWindow:{label:'main'}},
 transformCallback(fn){callbacks.set(++callbackId,fn);return callbackId},
 async invoke(cmd,args){
  if(cmd==='plugin:event|listen'){closeHandler=callbacks.get(args.handler);return 1}
  if(cmd==='read_last_session')return null
  if(cmd==='list_history_snapshots')return []
  if(cmd==='save_last_session'){saves++;if(gate)await gate;persisted=args.text;return}
  if(cmd==='plugin:window|destroy'){destroyed++;return}
  if(cmd==='plugin:event|unlisten')return
  throw Error('Unexpected native action '+cmd)
 }
}
const {render,screen,waitFor,fireEvent,cleanup,act}=await import(require.resolve('@testing-library/react'))
const server=await createServer({root:`${repo}/desktop-ui`,server:{middlewareMode:true,hmr:false},appType:'custom'})
const click=name=>fireEvent.click(screen.getByRole('button',{name,exact:true}))
const change=value=>fireEvent.change(screen.getByLabelText('A1 原始 OD'),{target:{value}})
const close=()=>closeHandler({event:'tauri://close-requested',id:1,payload:null})
try{
 const {default:Workbench}=await server.ssrLoadModule('/src/workbench/Workbench.tsx')
 render(React.createElement(Workbench))
 await waitFor(()=>assert.ok(persisted))
 click('载入板示例')
 await act(()=>new Promise(resolve=>setTimeout(resolve,400)))
 fireEvent.click(document.querySelector('[data-well="A1"]'))
 const original=document.querySelector('[data-well="A1"]').getAttribute('aria-label')
 let reject;gate=new Promise((resolve,no)=>{reject=no})
 let closingPromise
 const savesBefore=saves
 await act(async()=>{closingPromise=close();await new Promise(resolve=>setTimeout(resolve,40))})
 assert.ok(screen.getByRole('dialog',{name:'关闭前自动保存'}))
 await act(async()=>{await close()})
 assert.equal(saves,savesBefore+1,'Repeated close must not enqueue another write')
 change('999');click('应用到选中孔');const confirm=screen.queryByRole('button',{name:'确认覆盖孔位',exact:true});if(confirm)fireEvent.click(confirm)
 assert.equal(document.querySelector('[data-well="A1"]').getAttribute('aria-label'),original,'Even forced jsdom events must not mutate locked inputs')
 await act(async()=>{reject(new Error('simulated disk full'));await closingPromise})
 assert.equal(destroyed,0)
 assert.equal(screen.queryByRole('dialog',{name:'关闭前自动保存'}),null)
 assert.match(screen.getByRole('alert').textContent,/关闭前保存失败.*simulated disk full/)
 gate=null
 change('888');click('应用到选中孔');click('确认覆盖孔位')
 assert.match(document.querySelector('[data-well="A1"]').getAttribute('aria-label'),/OD 888 /,'Save failure must release editing lock')
 let release;gate=new Promise(resolve=>{release=resolve})
 await act(async()=>{closingPromise=close();await new Promise(resolve=>setTimeout(resolve,40))})
 assert.equal(destroyed,0)
 await act(async()=>{release();await closingPromise})
 assert.equal(destroyed,1)
 assert.equal(JSON.parse(persisted).inputs.plate.wells[0].raw,'888')
 console.log('PASS: native close lock, repeated-close guard, write-failure window retention/edit unlock, successful saved snapshot before single destroy')
}finally{cleanup();await server.close()}

})
