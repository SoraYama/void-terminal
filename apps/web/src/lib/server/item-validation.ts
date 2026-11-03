import { invalid } from "./validation";

const categories = ["weapon", "artifact", "material", "food", "quest", "gadget", "other"];
type ItemQueryMode = "list" | "detail" | "coverage";

/** Validate before contacting the private service; never forward arbitrary URLs or keys. */
export function itemQuery(request: Request, mode: ItemQueryMode = "list") {
  const query = new URL(request.url).searchParams;
  const keys = mode === "list"
    ? ["q", "category", "language", "rarity", "weaponType", "includeInternal", "sort", "page", "pageSize", "snapshotId"]
    : mode === "detail" ? ["language", "snapshotId"] : ["snapshotId"];
  for (const key of [...query.keys()]) {
    if (!keys.includes(key) || query.getAll(key).length !== 1) throw invalid();
    if (["q", "category", "rarity", "weaponType", "snapshotId"].includes(key)) {
      const value = query.get(key)!.trim();
      if (!value) query.delete(key);
      else query.set(key, value);
    }
  }
  for (const [key, limit] of [["q", 2000], ["weaponType", 100], ["snapshotId", 200]] as const)
    if (query.has(key) && (query.get(key)!.length > limit || /[\x00-\x1f\x7f]/.test(query.get(key)!))) throw invalid();
  for (const [key, allowed] of [
    ["category", categories], ["language", ["zh-CN", "en"]],
    ["sort", ["rarity", "name"]], ["includeInternal", ["true", "false"]],
  ] as const)
    if (query.has(key) && !(allowed as readonly string[]).includes(query.get(key)!)) throw invalid();
  for (const [key, max] of [["rarity", 5], ["page", 100000], ["pageSize", 100]] as const)
    if (query.has(key) && (!/^\d+$/.test(query.get(key)!) || Number(query.get(key)) < 1 || Number(query.get(key)) > max)) throw invalid();
  return query.toString();
}

export function itemIdentity(id: string) {
  if (!id || id.length > 512 || !/^[a-z]+:[A-Za-z0-9_:-]+$/.test(id)) throw invalid();
  return encodeURIComponent(id);
}
