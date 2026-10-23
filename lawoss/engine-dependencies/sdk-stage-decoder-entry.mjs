// No import-time IO. Only fixed trusted composition may supply this closure.
import { admitStageDecodeRequest, admitStageDecodeResult } from './sdk-stage-decoder-contract.mjs';
import { createStageWireDecoder, encodeStageWireFrame, projectStageError } from './sdk-stage-decoder-wire.mjs';

export async function runSdkStageDecoderEntry(decodeStage) {
  const input = process.stdin, output = process.stdout, controller = new AbortController();
  const decoder = createStageWireDecoder('request');
  let inputEnded = false, inputFailed = false, outputFailed = false, outputFinished = false, generation = null;
  let inputDone;
  const inputComplete = new Promise(resolve => { inputDone = resolve; });
  const outputError = () => { outputFailed = true; controller.abort(); };
  // Node's process stdout may reset writableFinished before its normal close.
  // Remember our observed finish event instead of rereading that mutable flag.
  const outputFinish = () => { outputFinished = true; };
  const outputClose = () => { if (!outputFinished) outputError(); };
  const inputError = () => { inputFailed = true; inputDone(); };
  const inputClose = () => { if (!inputEnded) inputError(); };
  const inputEnd = () => { inputEnded = true; inputDone(); };
  const inputData = chunk => { if (!inputFailed) try { decoder.push(chunk); } catch { inputFailed = true; } };
  // Keep the error listeners throughout owned work, including decoder cleanup.
  output.on('error', outputError); output.on('close', outputClose); output.on('finish', outputFinish);
  input.on('error', inputError); input.on('close', inputClose); input.on('end', inputEnd); input.on('data', inputData);
  try {
    await inputComplete;
    let terminal, status = 1;
    try {
      if (!inputEnded || inputFailed) throw Object.assign(new Error('STAGE_REQUEST_INVALID'), { code: 'STAGE_REQUEST_INVALID' });
      const request = admitStageDecodeRequest(decoder.finish());
      generation = request.generation;
      if (outputFailed) return 1;
      const result = await decodeStage(request, { signal: controller.signal });
      terminal = admitStageDecodeResult(result, request); status = 0;
    } catch (error) { terminal = projectStageError(error, generation); }
    if (outputFailed || !terminal) return 1;
    let frame;
    try { frame = encodeStageWireFrame(terminal, 'terminal'); } catch { return 1; }
    const written = await new Promise(resolve => {
      let finished = false, completed = false, settled = false;
      const settle = success => {
        if (settled) return;
        settled = true; output.removeListener('finish', finish); output.removeListener('error', error); output.removeListener('close', close); resolve(success);
      };
      const check = () => { if (finished && completed) settle(true); };
      const finish = () => { finished = true; check(); };
      const error = () => settle(false);
      const close = () => { if (!finished) settle(false); };
      output.once('close', close); output.once('finish', finish); output.once('error', error);
      try { output.end(frame, errorValue => { if (errorValue) { outputError(); settle(false); } else { completed = true; check(); } }); }
      catch { outputError(); settle(false); }
    });
    return written && !outputFailed ? status : 1;
  } finally {
    input.removeListener('data', inputData); input.removeListener('end', inputEnd); input.removeListener('close', inputClose);
    input.removeListener('error', inputError); output.removeListener('error', outputError); output.removeListener('close', outputClose); output.removeListener('finish', outputFinish);
  }
}
