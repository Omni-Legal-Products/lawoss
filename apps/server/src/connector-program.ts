import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

/** Check availability without starting an imported program. */
export async function connectorProgramAvailable(program: string): Promise<boolean> {
  const paths = isAbsolute(program) ? [program] : (process.env.PATH ?? "").split(delimiter).filter(Boolean).flatMap(path => process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map(extension => join(path, `${program}${extension}`)) : [join(path, program)]);
  for (const path of paths) {
    if (await stat(path).then(info => info.isFile() ? access(path, constants.X_OK).then(() => true, () => false) : false, () => false)) return true;
  }
  return false;
}
