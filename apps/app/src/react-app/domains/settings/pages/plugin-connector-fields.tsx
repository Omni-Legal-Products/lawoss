import type { PluginCreateConnector } from "@legalwork/types/plugin-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { HubTabs } from "../segmented-tabs";
import { normalizeCustomConnectorUrl, MCP_OAUTH_REDIRECT_URI } from "@/app/mcp-custom-connector";

export type PluginConnectorForm = {
  mode: "remote" | "local" | "existing";
  url: string;
  command: string;
  arguments: string;
  auth: "oauth" | "key" | "none";
  apiKey: string;
  clientId: string;
  clientSecret: string;
  headers: Array<{ name: string; value: string }>;
  environment: Array<{ name: string; value: string }>;
};
export const emptyPluginConnectorForm: PluginConnectorForm = { mode: "remote", url: "", command: "", arguments: "", auth: "oauth", apiKey: "", clientId: "", clientSecret: "", headers: [], environment: [] };

function values(rows: PluginConnectorForm["headers"], headers = false) {
  const names = new Set<string>();
  return Object.fromEntries(rows.map(row => {
    const name = row.name.trim();
    const key = headers ? name.toLowerCase() : name;
    if (!name || names.has(key) || !(headers ? /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/ : /^[A-Za-z_][A-Za-z0-9_]*$/).test(name)) throw new Error(t("plugin_create.invalid_variables"));
    if (headers && (["host", "content-length"].includes(key) || /[\r\n\0]/.test(row.value))) throw new Error(t("plugin_create.invalid_variables"));
    names.add(key);
    return [name, row.value];
  }));
}

/** No shell splitting: each argument is a separate line, preserving spaces and quotes. */
export function pluginConnectorConfig(form: PluginConnectorForm): PluginCreateConnector | undefined {
  if (form.mode === "existing") return undefined;
  if (form.mode === "local") {
    if (!form.command.trim()) throw new Error(t("mcp.url_or_command_required"));
    return { type: "local", command: [form.command.trim(), ...(form.arguments ? form.arguments.split("\n") : [])], environment: values(form.environment) };
  }
  const url = normalizeCustomConnectorUrl(form.url);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(t("plugin_create.invalid_url")); }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(t("plugin_create.invalid_url"));
  const headers = values(form.headers, true);
  if (form.auth === "key") {
    if (!form.apiKey.trim()) throw new Error(t("plugin_create.key_required"));
    if (Object.keys(headers).some(name => name.toLowerCase() === "authorization")) throw new Error(t("plugin_create.invalid_variables"));
    headers.Authorization = `Bearer ${form.apiKey.trim()}`;
  }
  return { type: "remote", url, headers, oauth: form.auth === "oauth" ? {
    ...(form.clientId.trim() ? { clientId: form.clientId.trim() } : {}),
    ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
  } : false };
}

function ConnectionValues(props: { label: string; rows: PluginConnectorForm["headers"]; disabled: boolean; onChange: (rows: PluginConnectorForm["headers"]) => void }) {
  return <div className="space-y-2">
    <div className="flex items-center justify-between"><span className="text-sm font-medium">{props.label}</span><Button type="button" variant="outline" size="sm" disabled={props.disabled || props.rows.length >= 20} onClick={() => props.onChange([...props.rows, { name: "", value: "" }])}>{t("common.add")}</Button></div>
    {props.rows.map((row, index) => <div key={index} className="flex gap-2">
      <Input aria-label={`${props.label}: ${t("plugin_create.variable_name")} ${index + 1}`} placeholder={t("plugin_create.variable_name")} value={row.name} disabled={props.disabled} onChange={event => props.onChange(props.rows.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
      <Input type="password" autoComplete="off" aria-label={`${props.label}: ${t("plugin_create.variable_value")} ${index + 1}`} placeholder={t("plugin_create.variable_value")} value={row.value} disabled={props.disabled} onChange={event => props.onChange(props.rows.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} />
      <Button type="button" variant="ghost" disabled={props.disabled} aria-label={`${t("common.remove")} ${props.label} ${index + 1}`} onClick={() => props.onChange(props.rows.filter((_, i) => i !== index))}>×</Button>
    </div>)}
  </div>;
}

export function PluginConnectorFields({ form, onChange, disabled }: { form: PluginConnectorForm; onChange: (form: PluginConnectorForm) => void; disabled: boolean }) {
  const patch = (value: Partial<PluginConnectorForm>) => onChange({ ...form, ...value });
  return <fieldset disabled={disabled} className="space-y-4">
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-medium">{t(form.mode === "existing" ? "plugin_create.existing" : form.mode === "local" ? "plugin_create.command" : "plugin_create.url")}</span>
      <button type="button" disabled={disabled} className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => patch({ mode: form.mode === "remote" ? "local" : "remote" })}>{t(form.mode === "remote" ? "plugin_create.use_command" : "plugin_create.use_url")}</button>
    </div>
    {form.mode === "remote" ? <>
      <label className="block"><span className="sr-only">{t("plugin_create.url")}</span><Input value={form.url} placeholder="https://example.com/mcp" onChange={event => patch({ url: event.target.value })} /></label>
      <details className="group text-sm">
        <summary className="cursor-pointer text-muted-foreground">{t("plugin_create.connection_options")}</summary>
        <div className="mt-4 space-y-4">
      <HubTabs value={form.auth} onChange={auth => patch({ auth })} label={t("plugin_create.auth")} items={[
        { id: "oauth", label: t("plugin_create.automatic") }, { id: "key", label: t("plugin_create.api_key") }, { id: "none", label: t("plugin_create.no_auth") },
      ]} />
      {form.auth === "oauth" ? <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("plugin_create.oauth_hint")}</p>
        <label className="block space-y-2 text-sm">{t("plugin_create.client_id")}<Input value={form.clientId} onChange={event => patch({ clientId: event.target.value })} /></label>
        <label className="block space-y-2 text-sm">{t("plugin_create.client_secret")}<Input type="password" autoComplete="off" value={form.clientSecret} onChange={event => patch({ clientSecret: event.target.value })} /></label>
        <p className="break-all text-xs text-muted-foreground">{t("plugin_create.redirect")}: {MCP_OAUTH_REDIRECT_URI}</p>
      </div> : form.auth === "key" ? <label className="block space-y-2 text-sm">{t("plugin_create.api_key")}<Input type="password" autoComplete="off" value={form.apiKey} onChange={event => patch({ apiKey: event.target.value })} /></label> : null}
      <ConnectionValues label={t("plugin_create.headers")} rows={form.headers} disabled={disabled} onChange={headers => patch({ headers })} />
        </div>
      </details>
    </> : form.mode === "local" ? <>
      <label className="block"><span className="sr-only">{t("plugin_create.command")}</span><Input value={form.command} placeholder="npx" onChange={event => patch({ command: event.target.value })} /></label>
      <p className="text-xs text-muted-foreground">{t("plugin_create.command_hint")}</p>
      <label className="block space-y-2 text-sm font-medium">{t("plugin_create.arguments")}<Textarea value={form.arguments} placeholder={'-y\n@your-org/mcp-server'} rows={3} onChange={event => patch({ arguments: event.target.value })} /></label>
      <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{t("plugin_create.connection_options")}</summary><div className="mt-4"><ConnectionValues label={t("plugin_create.environment")} rows={form.environment} disabled={disabled} onChange={environment => patch({ environment })} /></div></details>
    </> : null}
  </fieldset>;
}
