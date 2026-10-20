import { watch, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/** Coalesce filesystem events without retaining a compiler between builds. */
export async function startBuildWatch({ directories, run, debounceMs=100, onError=console.error, onFatal=onError }) {
  const lifetime=new AbortController();
  let dirty=false,active=false,timer,work=Promise.resolve(),closing;
  const watchers=[];
  const pump=()=>{
    if(active||lifetime.signal.aborted)return;
    active=true;
    work=(async()=>{
      while(dirty&&!lifetime.signal.aborted){
        dirty=false;
        try { await run(lifetime.signal); }
        catch(error){ if(!lifetime.signal.aborted)onError(error); }
      }
    })().finally(()=>{active=false;});
  };
  const changed=()=>{
    if(lifetime.signal.aborted)return;
    dirty=true;clearTimeout(timer);timer=setTimeout(pump,debounceMs);
  };
  const close=()=>closing??=(async()=>{
    clearTimeout(timer);lifetime.abort();for(const watcher of watchers)watcher.close();await work;
  })();
  try {
    for(const directory of directories){
      const watcher=watch(directory.path,{recursive:directory.recursive},(_event,name)=>{
        if(!name||!directory.accept||directory.accept(String(name)))changed();
      });
      watcher.on('error',error=>{try{onFatal(error);}finally{void close();}});watchers.push(watcher);
    }
    dirty=true;pump();return {close};
  } catch(error){await close();throw error;}
}

export function wordAddinWatchDirectories(app) {
  const repo=path.resolve(app,'../..');
  const roots=[path.join(app,'src'),path.join(app,'public'),path.join(repo,'lawoss'),
    ...['openui','ui','types'].map(name=>path.join(repo,'packages',name,'src'))];
  const directories=roots.filter(existsSync).map(root=>({path:root,recursive:true}));
  directories.push({path:app,recursive:false,accept:name=>/^(?:vite\.wordaddin\.config\.ts|tailwind\.config\.ts|taskpane\.html|package\.json|tsconfig.*\.json|\.env(?:\..+)?)$/.test(name)},
    {path:repo,recursive:false,accept:name=>['constants.json','pnpm-lock.yaml','package.json'].includes(name)},
    {path:path.join(app,'scripts'),recursive:false,accept:name=>name==='openui-license-notices.ts'},
    ...['apps/desktop','packages/openui','packages/ui','packages/types'].map(root=>({path:path.join(repo,root),recursive:false,accept:name=>name==='package.json'})));
  return directories.filter(directory=>existsSync(directory.path));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const app=fileURLToPath(new URL('../',import.meta.url));
  const require=createRequire(path.join(app,'package.json'));
  const vite=path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js');
  const watcher=await startBuildWatch({directories:wordAddinWatchDirectories(app),onFatal:error=>{console.error(error);process.exitCode=1;},run:signal=>new Promise((resolve,reject)=>{
    // The previous bundle stays available during compilation. Honor the user's
    // NODE_OPTIONS; no heap increase or compiler cache survives child exit.
    const child=spawn(process.execPath,[vite,'build','--config','vite.wordaddin.config.ts'],{
      cwd:app,env:{...process.env,LEGALWORK_PANE_KEEP_DIST:'1'},stdio:'inherit',signal,
    });
    let spawnError,killTimer;
    const abort=()=>{killTimer=setTimeout(()=>child.kill('SIGKILL'),3000);};
    signal.addEventListener('abort',abort,{once:true});
    child.on('error',error=>{spawnError=error;});
    child.once('close',(code,stopSignal)=>{
      signal.removeEventListener('abort',abort);clearTimeout(killTimer);
      if(signal.aborted)resolve();
      else if(spawnError)reject(spawnError);
      else if(code===0){console.log('WORD_ADDIN_BUILD_OK',child.pid);resolve();}
      else reject(new Error(`Office add-in build failed (${code??stopSignal}). Waiting for a source change.`));
    });
  })});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void watcher.close();});
}
