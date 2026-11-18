import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientSettingsWarningView, clientSettingsDamaged } from "../src/lawoss/lite/client-settings-warning";

const noop = () => {};

test("only project details flagged by the server count as damaged client settings (#554)", () => {
  expect(clientSettingsDamaged({version: 1, revision: 1, fields: [], lawossClientSettingsUnreadable: true})).toBe(true);
  for (const details of [{version: 1, revision: 1, fields: []}, {lawossClientSettingsUnreadable: "yes"}, null, undefined])
    expect(clientSettingsDamaged(details)).toBe(false);
});

test("a damaged client shows a red warning with the cause and what to do (#554)", () => {
  const sk = renderToStaticMarkup(<ClientSettingsWarningView locale="sk" damaged canRepair={false} />);
  expect(sk).toContain('role="alert"');
  expect(sk).toContain("data-lawoss-client-settings-damaged");
  expect(sk).toContain("Nastavenia tohto klienta sú poškodené");
  expect(sk).toContain("Asistent preto u neho nemá žiadne oprávnenia");
  expect(sk).not.toContain("data-lawoss-client-settings-repair");
  expect(renderToStaticMarkup(<ClientSettingsWarningView locale="cs" damaged canRepair={false} />)).toContain("Nastavení tohoto klienta jsou poškozená");
  expect(renderToStaticMarkup(<ClientSettingsWarningView locale="en" damaged canRepair={false} />)).toContain("This client’s settings are damaged");
  expect(renderToStaticMarkup(<ClientSettingsWarningView locale="de" damaged canRepair={false} />)).toContain("Die Einstellungen dieses Mandanten sind beschädigt");
  expect(renderToStaticMarkup(<ClientSettingsWarningView locale="sk" damaged={false} canRepair />)).toBe("");
});

test("the repair asks for confirmation and reports a failure (#554)", () => {
  const offered = renderToStaticMarkup(<ClientSettingsWarningView locale="sk" damaged canRepair onRequest={noop} onConfirm={noop} onCancel={noop} />);
  expect(offered).toContain('data-lawoss-client-settings-repair="request"');
  expect(offered).toContain("Obnoviť predvolené nastavenia");
  const confirming = renderToStaticMarkup(<ClientSettingsWarningView locale="sk" damaged canRepair confirming onRequest={noop} onConfirm={noop} onCancel={noop} />);
  expect(confirming).toContain('data-lawoss-client-settings-repair="confirm"');
  expect(confirming).toContain("Poškodený originál ostane uložený ako záloha");
  expect(renderToStaticMarkup(<ClientSettingsWarningView locale="sk" damaged canRepair failed onRequest={noop} />)).toContain("Nastavenia klienta sa nepodarilo obnoviť");
});
