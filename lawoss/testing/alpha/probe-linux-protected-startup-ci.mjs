#!/usr/bin/env node
// Guard before shared CLI imports, filesystem reads or privileged installation.
import {assertHostedLinuxContext} from './linux-protected-install.mjs';
try {assertHostedLinuxContext();}
catch {
  console.log(JSON.stringify({kind:'lawoss-ci-linux-protected-installation',status:'refused',reason:'native-hosted-nonroot-linux-required'}));
  process.exitCode=2;
}
if(!process.exitCode) {
  const {ciStartupOptions,runNativeStartupProbe,startupFailureProjection}=await import('./probe-startup-ci.mjs');
  const {withProtectedLinuxArtifact}=await import('./linux-protected-install.mjs');
  try {console.log(JSON.stringify(await runNativeStartupProbe(await ciStartupOptions(process.argv.slice(2)),{withArtifact:withProtectedLinuxArtifact})));}
  catch(error) {console.log(JSON.stringify(startupFailureProjection(error)));process.exitCode=1;}
}
