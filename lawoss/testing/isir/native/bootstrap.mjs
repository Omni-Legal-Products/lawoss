import assert from 'node:assert/strict';

// Use the same persisted provider configuration and authenticated host lifecycle
// as native settings. The host owns directory normalization, readiness and MCPs.
// LAWOSS v2: mirrors the app's custom-provider flow on engine 2.1.4
// (apps/app/.../provider-auth/store.ts): the native provider definition is saved
// through `PATCH /workspace/:id/config` as `opencode.providers`, the location's
// catalogue is activated, the key goes to the engine credential store through
// `integration.connect.key`, and the host reload refreshes the managed location.
// `providerConfig` must be a native V2 definition map (package/settings/models).
export async function configureNativeProvider({request,serverInfo,serverAuth,engineRequest,workspace,providerConfig}) {
  const providerID='isir-native';
  assert.ok(providerConfig&&typeof providerConfig==='object'&&Object.hasOwn(providerConfig,providerID),'Native provider bootstrap requires the synthetic provider definition');
  const location=`location[directory]=${encodeURIComponent(workspace.path)}`;
  const complete=async(response,status=200)=>{
    await response.arrayBuffer();
    assert.equal(response.status,status,'Native provider bootstrap HTTP status');
  };
  await complete(await request(`${serverInfo.baseUrl}/workspace/${workspace.id}/config`,{method:'PATCH',headers:serverAuth,body:JSON.stringify({opencode:{providers:providerConfig}})}));
  // LAWOSS v2: like the app, read the location's model catalogue right before connecting the key.
  await complete(await engineRequest(`/model?${location}`));
  // LAWOSS v2: `POST /api/integration/:id/connect/key` answers 204 (client contract successStatus).
  await complete(await engineRequest(`/integration/${encodeURIComponent(providerID)}/connect/key?${location}`,{method:'POST',body:JSON.stringify({key:'synthetic-local-only'})}),204);
  await complete(await engineRequest.reload());
  const response=await engineRequest(`/provider?${location}`);
  const body=await response.text();
  assert.equal(response.status,200,'Native provider catalogue HTTP status');
  const catalogue=JSON.parse(body);
  assert.ok(catalogue&&Array.isArray(catalogue.data),'Native provider catalogue must be a V2 provider list');
  // LAWOSS v2: the app treats every listed provider as connected (infra/provider-list-query.ts).
  const providers={all:catalogue.data,connected:catalogue.data.map(provider=>provider.id)};
  const configured=catalogue.data.find(provider=>provider.id===providerID);
  assert.ok(configured&&configured.activation!=='disabled','Configured synthetic provider must be connected');
  return providers;
}
