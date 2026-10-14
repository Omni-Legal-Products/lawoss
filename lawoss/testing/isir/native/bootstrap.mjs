import assert from 'node:assert/strict';

// Use the same persisted provider configuration and authenticated host lifecycle
// as native settings. The host owns directory normalization, readiness and MCPs.
export async function configureNativeProvider({request,serverInfo,serverAuth,liveEngine,apiAuth,workspace,providerConfig}) {
  const complete=async(url,options)=>{
    const response=await request(url,options);
    await response.arrayBuffer();
    assert.equal(response.status,200,'Native provider bootstrap HTTP status');
  };
  await complete(`${serverInfo.baseUrl}/workspace/${workspace.id}/config`,{method:'PATCH',headers:serverAuth,body:JSON.stringify({opencode:{provider:providerConfig}})});
  await complete(`${liveEngine.baseUrl}/auth/isir-native`,{method:'PUT',headers:apiAuth,body:JSON.stringify({type:'api',key:'synthetic-local-only'})});
  await complete(`${serverInfo.baseUrl}/workspace/${workspace.id}/engine/reload`,{method:'POST',headers:serverAuth});
  const response=await request(`${liveEngine.baseUrl}/provider?directory=${encodeURIComponent(workspace.path)}`,{headers:apiAuth});
  const body=await response.text();
  assert.equal(response.status,200,'Native provider catalogue HTTP status');
  const providers=JSON.parse(body);
  assert.ok(providers.connected?.includes('isir-native'),'Configured synthetic provider must be connected');
  return providers;
}
