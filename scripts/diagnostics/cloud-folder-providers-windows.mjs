import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCloudFolder } from '../../apps/server/dist/cloud-folder.js';

// Run as administrator only on an isolated Windows test machine, after the
// server build. The guards refuse existing client settings; finally removes
// only this test's registry entries and temporary folder. No cloud login needed.
if (process.platform !== 'win32') throw new Error('Windows test machine required');
const powershell=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
const mutation=String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=[Text.Encoding]::UTF8
$data=ConvertFrom-Json([Console]::In.ReadToEnd())
if($data.action -eq 'set') {
 New-Item -Path $data.key -Force | Out-Null
 New-ItemProperty -LiteralPath $data.key -Name $data.name -Value $data.value -PropertyType String -Force | Out-Null
} elseif($data.action -eq 'remove') {
 if(Test-Path -LiteralPath $data.key) { Remove-Item -LiteralPath $data.key -Recurse -Force }
} elseif($data.action -eq 'check') {
 if(Test-Path -LiteralPath $data.key) {throw 'Test requires an isolated Windows profile without existing client settings'}
}
`;
function registry(action,key,name='',value='') {
 execFileSync(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(mutation,'utf16le').toString('base64')],{input:JSON.stringify({action,key,name,value}),encoding:'utf8',timeout:15000,stdio:['pipe','pipe','pipe']});
}
const keys=['HKCU:\\Software\\Google\\DriveFS','HKLM:\\Software\\Policies\\Google\\DriveFS','HKLM:\\Software\\Google\\DriveFS','HKLM:\\Software\\Box\\Box'];
for(const key of keys)registry('check',key);
const root=await mkdtemp(join(tmpdir(),'legalwork-cloud-folders-'));
const sid=execFileSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8'}).match(/S-1-[0-9-]+/)[0];
keys.push('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\SyncRootManager\\LegalWorkCloudFixture!'+sid+'!test');
registry('check',keys[4]);
const original={APPDATA:process.env.APPDATA,LOCALAPPDATA:process.env.LOCALAPPDATA};
process.env.LEGALWORK_PROVIDER_TEST_ROOT=root;
process.env.APPDATA=join(root,'Roaming');process.env.LOCALAPPDATA=join(root,'Local');
const cases=[];
async function check(name,path,expected){
 let result;try { result=await isCloudFolder(path); } catch(error) { console.log(JSON.stringify({failedCase:name,path,code:error.code,stderr:error.stderr,message:String(error.message).slice(0,200)}));throw new Error(name); } assert.equal(result,expected,name);cases.push({name,result,expected});
}
const native=join(root,'Ordinary');
await mkdir(native,{recursive:true});
try {
 await check('ordinary local project',native,false);
 await check('ordinary folder named Google Drive',join(native,'Google Drive'),false);
 await check('ordinary folder named Dropbox',join(native,'Dropbox'),false);
 await check('ordinary Box without installation metadata',join(process.env.USERPROFILE,'Box'),false);
 registry('set',keys[4]+'\\UserSyncRoots',sid,join(root,'Generic cloud'));
 await check('generic registered provider without running client',join(root,'Generic cloud','Cases'),true);
 await check('generic registered provider sibling prefix',join(root,'Generic cloud-backup'),false);
 await mkdir(join(process.env.APPDATA,'Dropbox'),{recursive:true});
 await writeFile(join(process.env.APPDATA,'Dropbox','info.json'),'{broken before any successful read');
 await check('cold corrupt config does not block local folders',native,false);
 await check('cold corrupt config does not bypass a registered cloud root',join(root,'Generic cloud','Cases'),true);
 await rm(join(process.env.APPDATA,'Dropbox','info.json'));
 await mkdir(join(process.env.APPDATA,'Dropbox','info.json'));
 await check('optional config read error does not block local folders',native,false);
 await rm(join(process.env.APPDATA,'Dropbox'),{recursive:true});
 registry('set',keys[0]+'\\Share','MountPoint','X');
 await check('Google Drive live drive-letter mount','X:\\Matters',true);
 await check('Google Drive live drive root','X:\\',true);
 registry('set',keys[0]+'\\Share\\account2','MountPoint',join(root,'Custom streamed drive'));
 await check('Google Drive second account with custom folder',join(root,'Custom streamed drive','Matters'),true);
 await check('Google Drive sibling prefix is local',join(root,'Custom streamed drive-backup'),false);
 registry('remove',keys[0]);
 registry('set',keys[2],'DefaultMountPoint','R');
 await check('Google Drive machine default','R:\\Cases',true);
 registry('set',keys[0],'DefaultMountPoint','S:');
 await check('Google Drive per-user default','S:\\Cases',true);
 await check('Google Drive superseded machine mount','R:\\Cases',false);
 registry('set',keys[1],'DefaultMountPoint','%LEGALWORK_PROVIDER_TEST_ROOT%\\Policy drive');
 await check('Google Drive policy override expands environment',join(root,'Policy drive','Cases'),true);
 await check('Google Drive superseded user mount','S:\\Cases',false);
 registry('set',keys[3],'CustomBoxLocation',join(root,'Firm storage'));
 await check('Box custom parent plus Box root',join(root,'Firm storage','Box','Cases'),true);
 await check('Box default fallback with installed client',join(process.env.USERPROFILE,'Box','Cases'),true);
 await check('Box sibling prefix remains local',join(root,'Firm storage','Box-backup'),false);
 await mkdir(join(process.env.APPDATA,'Dropbox'),{recursive:true});
 await writeFile(join(process.env.APPDATA,'Dropbox','info.json'),JSON.stringify({personal:{path:join(root,'Personal files')},business:{path:join(root,'Firm files')}}));
 await check('Dropbox renamed personal root',join(root,'Personal files','Cases'),true);
 await check('Dropbox second account',join(root,'Firm files','Cases'),true);
 await rm(join(process.env.APPDATA,'Dropbox'),{recursive:true});
 await mkdir(join(process.env.LOCALAPPDATA,'Dropbox'),{recursive:true});
 await writeFile(join(process.env.LOCALAPPDATA,'Dropbox','info.json'),JSON.stringify({personal:{path:join(root,'Local config Dropbox')}}));
 await check('Dropbox local appdata config location',join(root,'Local config Dropbox','Cases'),true);
 await mkdir(join(process.env.APPDATA,'Nextcloud'),{recursive:true});
 await writeFile(join(process.env.APPDATA,'Nextcloud','nextcloud.cfg'),`[Accounts]\n0\\FoldersWithPlaceholders\\1\\localPath=${join(root,'Nextcloud custom').replaceAll('\\','/')}\n`);
 await check('Nextcloud placeholder roots',join(root,'Nextcloud custom','Cases'),true);
 await mkdir(join(process.env.APPDATA,'ownCloud'),{recursive:true});
 await writeFile(join(process.env.APPDATA,'ownCloud','owncloud.cfg'),`[Accounts]\n0\\Folders\\1\\localPath=${join(root,'ownCloud custom').replaceAll('\\','/')}\n`);
 await check('ownCloud configured roots',join(root,'ownCloud custom','Cases'),true);
 const odd=join(native,"literal'; $(throw 'must not run'); $path");
 await check('literal PowerShell characters cannot execute',odd,false);
 await writeFile(join(process.env.LOCALAPPDATA,'Dropbox','info.json'),'{broken');
 await check('corrupt optional config leaves ordinary folder detection working',native,false);
 await check('corrupt optional config retains learned Dropbox root',join(root,'Local config Dropbox','Cases'),true);
 await check('corrupt Dropbox config does not hide Nextcloud root',join(root,'Nextcloud custom','Cases'),true);
 await check('corrupt Dropbox config does not bypass registered cloud root',join(root,'Generic cloud','Cases'),true);
 await assert.rejects(isCloudFolder(native+'\u0000invalid'));
 cases.push({name:'native target lookup failures still report an error',result:true,expected:true});
 console.log(JSON.stringify({platform:process.platform,node:process.version,kind:'native Windows calls with synthetic client configuration; no signed-in provider clients',cases}));
} finally {
 for(const key of keys)registry('remove',key);
 process.env.APPDATA=original.APPDATA;process.env.LOCALAPPDATA=original.LOCALAPPDATA;
 delete process.env.LEGALWORK_PROVIDER_TEST_ROOT;
 await rm(root,{recursive:true,force:true});
}
