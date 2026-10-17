import assert from 'node:assert/strict';
import { stat, cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const execFile=promisify(execFileCallback);
import path from 'node:path';

export async function nativeRendererLaunch(appRoot, port, fixtureRoot) {
  // The acceptance app remains the existing build, never the dev compiler.
  const dist=path.join(appRoot,'dist');
  assert.ok((await stat(path.join(dist,'index.html'))).isFile(),'Built native renderer index must be a file');
  const args=['preview','--host','127.0.0.1','--port',String(port),'--strictPort'];
  if(fixtureRoot) {
    // Compile only explicitly owned regression entries, separately from the app.
    // Preview has no TSX transform. Keep dist immutable and serve an isolated copy.
    const previewRoot=path.join(fixtureRoot,'renderer-preview');
    await mkdir(previewRoot,{recursive:true});await cp(dist,previewRoot,{recursive:true});
    await compileNativeRendererFixtures(appRoot,previewRoot);
    args.push('--outDir',previewRoot);
  }
  return {cwd:appRoot,args};
}

export async function compileNativeRendererFixtures(appRoot,previewRoot) {
  // Match the packaging build's bounded heap only for this compiler child.
  // An explicit argv option also overrides a source-CI parent's smaller NODE_OPTIONS.
  await execFile(process.execPath,['--max-old-space-size=6144',fileURLToPath(import.meta.url),'--compile-fixtures',appRoot,previewRoot],{cwd:appRoot,maxBuffer:1024*1024});
}

// Keep compiler/plugin resolution rooted in the app in a separate build process;
// never change the acceptance runner's cwd or switch its app to development.
if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--compile-fixtures') {
  const [appRoot,previewRoot]=process.argv.slice(3);
    const require=createRequire(path.join(appRoot,'package.json'));
    const {build,loadConfigFromFile}=await import(pathToFileURL(path.join(path.dirname(require.resolve('vite/package.json')),'dist/node/index.js')).href);
    const {config}=await loadConfigFromFile({command:'build',mode:'production'},path.join(appRoot,'vite.config.ts'));
    await build({...config,configFile:false,root:appRoot,base:'/__isir-fixtures/',logLevel:'warn',
      build:{...config.build,outDir:path.join(previewRoot,'__isir-fixtures'),emptyOutDir:true,
        rollupOptions:{input:{'session-render-boundary':path.join(appRoot,'tests/session-render-boundary.test.tsx'),'workspace-endpoint-stability':path.join(appRoot,'tests/workspace-endpoint-stability.test.tsx'),'chooser-boundary':path.join(appRoot,'tests/chooser-boundary.fixture.tsx')},
          preserveEntrySignatures:'strict',output:{entryFileNames:'[name].js',chunkFileNames:'assets/[name]-[hash].js'}}}});
}
