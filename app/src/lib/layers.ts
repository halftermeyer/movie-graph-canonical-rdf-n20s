// The three declarative layers, read as plain files from the repository root.
// The app shows them read-only and sends them to n20s as they are:
// swapping a layer means editing a file, not the code.

const files = import.meta.glob<string>(
  ["../../../ontology/*", "../../../bridge/**/*", "../../../rules/*"],
  { query: "?raw", import: "default", eager: true }
);

export interface LayerFile {
  path: string; // repository-relative, e.g. "bridge/schemaorg/axioms.ttl"
  name: string;
  kind: "turtle" | "rules" | "sparql";
  content: string;
}

const all: LayerFile[] = Object.entries(files)
  .map(([p, content]) => {
    const path = p.replace(/^(\.\.\/)+/, "");
    const name = path.split("/").pop()!;
    const kind: LayerFile["kind"] = name.endsWith(".rules")
      ? "rules"
      : name.endsWith(".rq")
        ? "sparql"
        : "turtle";
    return { path, name, kind, content };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

export function layerFiles(prefix: string): LayerFile[] {
  return all.filter((f) => f.path.startsWith(prefix));
}

export function layerFile(path: string): LayerFile {
  const f = all.find((x) => x.path === path);
  if (!f) throw new Error(`Layer file not found: ${path}`);
  return f;
}

export type BridgeTarget = "schemaorg" | "wikidata";

export interface Bridge {
  target: BridgeTarget;
  label: string;
  axioms: LayerFile;
  rules: LayerFile;
  constructs: LayerFile[];
}

export function bridge(target: BridgeTarget): Bridge {
  const dir = `bridge/${target}/`;
  return {
    target,
    label: target === "schemaorg" ? "schema.org" : "Wikidata",
    axioms: layerFile(dir + "axioms.ttl"),
    rules: layerFile(dir + "structure.rules"),
    constructs: layerFiles(dir).filter((f) => f.kind === "sparql"),
  };
}

export const ONTOLOGY = layerFiles("ontology/");
export const SHAPES = layerFile("rules/shapes.ttl");
export const RULES = {
  auteur: layerFile("rules/auteur.rules"),
  aggregateRating: layerFile("rules/aggregate-rating.rq"),
  coStar: layerFile("rules/costar.rules"),
  baconOwl: layerFile("rules/bacon-ladder.owl.ttl"),
  baconRules: layerFile("rules/bacon-ladder.rules"),
};
export const ALL_LAYER_FILES = all;
