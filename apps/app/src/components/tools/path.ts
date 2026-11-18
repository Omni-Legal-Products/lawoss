export function parseFilename(filePath: string | undefined) {
  if (!filePath) {
    return "file"
  }
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath
}

export function truncateText(value: string, max: number) {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value
}

export function toolDisplayTitle(
  title: string | null,
  detail?: string
): string | undefined {
  if (!title) {
    return undefined
  }
  if (!detail) {
    return title
  }
  return `${title} ${detail}`
}

/**
 * 🟡 LAWOSS #550: cesta súboru vo vstupe nástrojov read/edit/write. Engine v2 ju posiela ako `path`,
 * starší engine ako `filePath`; bez toho karta ukazovala „Zápis file“.
 */
export function toolInputPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  for (const key of ["filePath", "path"]) {
    const value: unknown = Reflect.get(input, key)
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}
