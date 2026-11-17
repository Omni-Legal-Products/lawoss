/**
 * LAWOSS #423: karta nástroja `lawoss_new_client`. Nový klient vznikne mimo klienta chatu (priečinok v `Klienti/`
 * kancelárie, registrácia klienta a prístup k pamäti kancelárie), preto karta varuje a pýta sa vždy, aj v YOLO
 * (povolenie `lawoss_client_create`, `newClientRules` na serveri); „povoliť pre chat“ nemá (`always: []`). Ukáže všetko,
 * čo sa zapíše, tak, ako to pripravil server v `metadata.lawossNewClient`: priečinok, meno, typ, IČO a poznámku.
 */
import { t } from "@/i18n";
import type { FileOperationDetails } from "./file-operation-card";

type ClientType = "po" | "fo" | "fo-podnikatel" | "iny";
type NewClient = { target: string; name: string; clientType: ClientType; ico: string | null; note: string | null };

/** Dlhá poznámka sa na karte skráti; do karty klienta sa zapíše celá (server ju pripravil ako jeden riadok). */
const NOTE_LIMIT = 280;

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const isClientType = (value: unknown): value is ClientType => value === "po" || value === "fo" || value === "fo-podnikatel" || value === "iny";
const TYPE_KEYS: Record<ClientType, string> = {
  po: "lawoss.new_client.type_po", fo: "lawoss.new_client.type_fo", "fo-podnikatel": "lawoss.new_client.type_sole_trader", iny: "lawoss.new_client.type_other",
};

function newClient(metadata: Record<string, unknown>): NewClient | null {
  const raw: unknown = metadata.lawossNewClient;
  if (!raw || typeof raw !== "object") return null;
  const target = text(Reflect.get(raw, "target")), name = text(Reflect.get(raw, "name")), clientType: unknown = Reflect.get(raw, "clientType");
  if (!target || !name || !isClientType(clientType)) return null;
  return { target, name, clientType, ico: text(Reflect.get(raw, "ico")), note: text(Reflect.get(raw, "note")) };
}

const shortened = (value: string) => value.length > NOTE_LIMIT ? `${value.slice(0, NOTE_LIMIT).trimEnd()}…` : value;

/** The card's readable content, or `null` when the request is not from `lawoss_new_client`. */
export function newClientCard(metadata: Record<string, unknown>): { title: string; message: string; permissionLabel: string; scopeLabel: string; scopeValue: string; details: FileOperationDetails } | null {
  const client = newClient(metadata);
  if (!client) return null;
  const lines = [
    t("lawoss.new_client.line_folder", undefined, { path: client.target }),
    t("lawoss.new_client.line_name", undefined, { name: client.name }),
    t("lawoss.new_client.line_type", undefined, { type: t(TYPE_KEYS[client.clientType]) }),
    ...(client.ico ? [t("lawoss.new_client.line_ico", undefined, { ico: client.ico })] : []),
    ...(client.note ? [t("lawoss.new_client.line_note", undefined, { text: shortened(client.note) })] : []),
  ];
  return {
    title: t("lawoss.new_client.title"),
    message: t("lawoss.new_client.message"),
    permissionLabel: t("lawoss.new_client.permission_label"),
    scopeLabel: t("lawoss.new_client.scope"),
    scopeValue: lines.join("\n"),
    details: { reason: null, lines },
  };
}
