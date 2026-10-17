import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';

export async function nativeRendererLaunch(appRoot, port) {
  // Desktop CI already builds this artifact. Missing output must fail before
  // launch rather than silently compile a different development renderer.
  assert.ok((await stat(path.join(appRoot,'dist/index.html'))).isFile(),'Built native renderer index must be a file');
  return {cwd:appRoot,args:['preview','--host','127.0.0.1','--port',String(port),'--strictPort']};
}
