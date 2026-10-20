import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { Button } from "@/components/ui/button";
import { desktopBridge } from "@/app/lib/desktop";

const menus: ("File" | "Edit" | "View" | "Help")[] = ["File", "Edit", "View", "Help"];
const menuLabelKeys: Record<(typeof menus)[number], string> = {
  File: "lawoss.shell.menu.file",
  Edit: "lawoss.shell.menu.edit",
  View: "lawoss.shell.menu.view",
  Help: "lawoss.shell.menu.help",
};

// Use the installed native menus, including their roles and accelerators.
export function WindowMenubar() {
  const locale = useLocale();
  return (
    <nav aria-label={t("lawoss.shell.menu.label", locale)} className="hidden h-full items-center titlebar-no-drag windows:flex">
      {menus.map((menu) => (
        <Button
          key={menu}
          variant="ghost"
          size="sm"
          className="px-2 text-muted-foreground"
          aria-haspopup="menu"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            void desktopBridge.__showApplicationMenu(menu, { x: rect.left, y: rect.bottom });
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            event.currentTarget.click();
          }}
        >
          {t(menuLabelKeys[menu], locale)}
        </Button>
      ))}
    </nav>
  );
}
