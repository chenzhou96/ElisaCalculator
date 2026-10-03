import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
const repo=fileURLToPath(new URL('../../', import.meta.url))
test('native close cannot overwrite prior session while startup recovery is still in flight', async () => {
const require=createRequire(`${repo}/desktop-ui/package.json`)
const {JSDOM}=require('jsdom'),React=require('react'),{createServer}=await import(require.resolve('vite'))
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://127.0.0.1:1420'})
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Element','Node','MutationObserver','Event','MouseEvent'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true,writable:true})
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.isTauri=true
const callbacks=new Map();let callbackId=0,closeHandler,destroyed=0,saves=0,persisted,releaseRead,reading=false
const readGate=new Promise(resolve=>{releaseRead=resolve})
window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(){}}
window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'}},transformCallback(fn){callbacks.set(++callbackId,fn);return callbackId},async invoke(cmd,args){if(cmd==='plugin:event|listen'){closeHandler=callbacks.get(args.handler);return 1}if(cmd==='read_last_session'){reading=true;await readGate;return persisted}if(cmd==='list_history_snapshots')return [];if(cmd==='save_last_session'){saves++;persisted=args.text;return}if(cmd==='plugin:window|destroy'){destroyed++;return}if(cmd==='plugin:event|unlisten')return;throw Error(cmd)}}
const {render,screen,waitFor,cleanup,act}=await import(require.resolve('@testing-library/react'))
const server=await createServer({root:`${repo}/desktop-ui`,server:{middlewareMode:true,hmr:false},appType:'custom'})
try{const {default:Workbench}=await server.ssrLoadModule('/src/workbench/Workbench.tsx'),{initialWorkspace}=await server.ssrLoadModule('/src/workbench/model.ts'),{serializeRecord}=await server.ssrLoadModule('/src/workbench/record.ts');persisted=serializeRecord({...structuredClone(initialWorkspace),rawText:'valuable prior draft'});const original=persisted;render(React.createElement(Workbench));await waitFor(()=>{if(!closeHandler||!reading)throw Error('waiting read')});await act(async()=>{await closeHandler({event:'tauri://close-requested',id:1,payload:null})});assert.equal(persisted,original);assert.equal(saves,0);assert.equal(destroyed,0);assert.match(screen.getByRole('alert').textContent,/仍在恢复/);await act(async()=>{releaseRead();await new Promise(resolve=>setTimeout(resolve,20))})}finally{cleanup();await server.close()}

})
