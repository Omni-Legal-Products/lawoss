import assert from 'node:assert/strict';

// Use the same persisted provider configuration and authenticated host lifecycle
// as native settings. The host owns directory normalization, readiness and MCPs.
export async function configureNativeProvider({request,serverInfo,serverAuth,engineRequest,workspace,providerConfig}) {
  const complete=async(url,options)=>{
    const response=await request(url,options);
    await response.arrayBuffer();
    assert.equal(response.status,200,'Native provider bootstrap HTTP status');
  };
  await complete(`${serverInfo.baseUrl}/workspace/${workspace.id}/config`,{method:'PATCH',headers:serverAuth,body:JSON.stringify({opencode:{provider:providerConfig}})});
  const auth=await engineRequest('/auth/isir-native',{method:'PUT',body:JSON.stringify({type:'api',key:'synthetic-local-only'})});
  await auth.arrayBuffer();assert.equal(auth.status,200,'Native provider bootstrap HTTP status');
  const reload=await engineRequest.reload();
  await reload.arrayBuffer();assert.equal(reload.status,200,'Native provider bootstrap HTTP status');
  const response=await engineRequest(`/provider?directory=${encodeURIComponent(workspace.path)}`);
  const body=await response.text();
  assert.equal(response.status,200,'Native provider catalogue HTTP status');
  const providers=JSON.parse(body);
  assert.ok(providers.connected?.includes('isir-native'),'Configured synthetic provider must be connected');
  return providers;
}
