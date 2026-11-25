// Each catalog ID resolves to a compact same-origin WebP shared by both play modes.
export const catalog = await (await fetch("./components.json")).json();
const normalize = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\s*\((?:ll|sot|co-op|competitive)\).*$/i, "")
    .replace(/[^a-z0-9]/g, "");
const byName = new Map();
for (const [id, p] of Object.entries(catalog.items)) {
  const key = normalize(p.name);
  if (!byName.has(key) || !catalog.items[byName.get(key)].url)
    byName.set(key, id);
}
const heroes = /^(arythea|tovak|goldyx|norowas|wolfhawk|krang|braevalar)_/;
export function pieceId(name) {
  if (!name) return "";
  if (catalog.items[name]) return name;
  const tile = /^(countryside|core)_(\d+)/.exec(name);
  if (tile)
    name = (name.includes("city") ? "city" : tile[1]) + " tile " + tile[2];
  if (name === "starting_a" || name === "starting_b")
    name = "starting tile " + name.slice(-1);
  return (
    byName.get(normalize(name)) ||
    byName.get(normalize(name.replace(heroes, ""))) ||
    ""
  );
}
export function picture(name, size = "thumb") {
  const id = pieceId(name);
  return id
    ? '<mk-picture class="' +
        size +
        '" piece="' +
        id +
        '" aria-hidden="true"></mk-picture>'
    : "";
}
export const faces=await (await fetch("./faces.json")).json();
export function faceURL(id){return faces[id]||""}
class PiecePicture extends HTMLElement {
  connectedCallback() {
    const url=faceURL(this.getAttribute("piece"));
    if(url)this.style.backgroundImage='url("'+url+'")';
  }
}
customElements.define("mk-picture",PiecePicture);
