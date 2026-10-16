/** @jsxImportSource react */
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";

import { desktopBridge } from "@/app/lib/desktop";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { registerExtensionConfig, type ExtensionConfigContext } from "./extension-registry";

type OpenComputerUseConfigProps = NonNullable<ExtensionConfigContext["openComputerUse"]>;

registerExtensionConfig("legalwork.openComputerUse.settings", (ctx) =>
  ctx.openComputerUse ? <OpenComputerUseConfig {...ctx.openComputerUse} /> : null,
);

export function OpenComputerUseConfig({ localDesktop, connected, connecting, onConnect, onRefresh }: OpenComputerUseConfigProps) {
  const available = localDesktop && typeof window !== "undefined" && Boolean(window.__LEGALWORK_ELECTRON__?.invokeDesktop);
  const { data: status, error: checkError, isFetching, refetch } = useQuery({
    queryKey: ["open-computer-use", "setup"],
    queryFn: () => desktopBridge.checkOpenComputerUse(),
    enabled: available,
    retry: false,
  });
  const { mutate: connect, isPending, error: setupError } = useMutation({
    mutationFn: async () => {
      await desktopBridge.getOpenComputerUseMcpConfig();
      const next = await desktopBridge.checkOpenComputerUse();
      if (next.platform === "darwin" && !next.ready) {
        if (next.error) throw new Error(next.error);
        await desktopBridge.openOpenComputerUsePermissionSetup();
      } else {
        if (!await onConnect()) throw new Error(t("open_computer_use.connection_failed"));
      }
    },
    onSettled: () => { void refetch(); },
  });

  const busy = connecting || isPending || isFetching;
  const error = setupError?.message ?? checkError?.message ?? status?.error;
  const needsPermissions = status?.installed && status.platform === "darwin" && !status.ready;
  const buttonLabel = needsPermissions
    ? t("open_computer_use.grant_permissions")
    : status?.installed ? t("mcp.connect") : t("open_computer_use.install_connect");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("open_computer_use.setup_title")}</CardTitle>
        <CardDescription>{t("open_computer_use.setup_description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!available ? (
          <Alert><AlertDescription>{t("open_computer_use.local_only")}</AlertDescription></Alert>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              {status?.installed ? <CheckCircle2 className="size-4 text-green-9" /> : <CircleAlert className="size-4 text-muted-foreground" />}
              <span>{status?.installed ? t("open_computer_use.installed", { version: status.version }) : t("open_computer_use.not_installed")}</span>
            </div>
            {status?.platform === "darwin" && status.installed ? (
              <div className="space-y-2 text-sm">
                <PermissionRow label={t("ext.cu_ax_permission")} granted={status.accessibility === true} />
                <PermissionRow label={t("ext.cu_screen_permission")} granted={status.screenRecording === true} />
                {needsPermissions ? <p className="text-muted-foreground">{t("open_computer_use.permissions_hint")}</p> : null}
              </div>
            ) : null}
            <p className="text-sm text-muted-foreground">{t("open_computer_use.desktop_hint")}</p>
            {connected ? <p className="text-sm text-green-9">{t("ext.cu_mcp_connected")}</p> : null}
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          </>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {(!connected || !status?.installed || needsPermissions) ? (
          <Button disabled={!available || busy} onClick={() => connect()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {isPending || connecting ? t("open_computer_use.setting_up") : buttonLabel}
          </Button>
        ) : null}
        <Button variant="outline" disabled={!available || busy} onClick={async () => { await refetch(); await onRefresh(); }}>
          {t("open_computer_use.check_setup")}
        </Button>
      </CardFooter>
    </Card>
  );
}

function PermissionRow({ label, granted }: { label: string; granted: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {granted ? <CheckCircle2 className="size-4 text-green-9" /> : <CircleAlert className="size-4 text-muted-foreground" />}
      <span>{label}</span>
    </div>
  );
}
