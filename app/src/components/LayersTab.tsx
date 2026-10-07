import { layerFiles } from "../lib/layers";
import { LayerViewer } from "./ui";

const GROUPS = [
  {
    prefix: "ontology/",
    title: "ontology/",
    text: "A local slice of schema.org (namespace https://schema.org/) and a small extension: ex:coStar, ex:Auteur, the Bacon ladder classes.",
  },
  {
    prefix: "bridge/schemaorg/",
    title: "bridge/schemaorg/",
    text: "Snapshot records → schema.org. RDFS axioms for what axioms can say; Jena rules and SPARQL CONSTRUCTs for the rest (direction flips, PerformanceRole, Review, xsd:gYear, character names, ratings).",
  },
  {
    prefix: "bridge/wikidata/",
    title: "bridge/wikidata/",
    text: "The same snapshot → Wikidata properties: P31, P57, P58, P161 (with statement nodes and P4633 qualifiers), P162, P577, P569, P1476.",
  },
  {
    prefix: "rules/",
    title: "rules/",
    text: "Domain rules (auteur, aggregate rating, coStar, the Bacon ladder as OWL and as rules) and SHACL shapes for what a schema.org consumer expects.",
  },
];

export default function LayersTab() {
  return (
    <div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Three layers, plain files</h3>
        <p>
          Nothing below is code. These files are read from the repository as they are, shown here read-only, and sent to
          n20s unchanged. To change what the demo concludes, edit a file and re-run a scenario; to target another vocabulary,
          add a folder under <code>bridge/</code>.
        </p>
        <div className="layer-stack">
          <div className="layer-stack-item">snapshot (mechanical, from Cypher)</div>
          <div className="layer-stack-item">ontology/</div>
          <div className="layer-stack-item">bridge/&lt;target&gt;/</div>
          <div className="layer-stack-item">rules/</div>
        </div>
      </div>
      {GROUPS.map((g) => (
        <div className="card" key={g.prefix}>
          <h4 style={{ marginTop: 0 }}>
            <code>{g.title}</code>
          </h4>
          <p className="muted">{g.text}</p>
          <LayerViewer files={layerFiles(g.prefix)} />
        </div>
      ))}
    </div>
  );
}
