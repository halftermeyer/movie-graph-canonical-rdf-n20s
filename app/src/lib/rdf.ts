// RDF helpers: parse the TriG export and the n20s triple rows into RDF/JS
// terms, compare graphs, hash a snapshot. Pure functions, no database access.

import { DataFactory, Parser, Writer, type Quad, type Term } from "n3";
import { isomorphic } from "rdf-isomorphic";

const { namedNode, blankNode, literal, quad, defaultGraph } = DataFactory;

export const NS = {
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  owl: "http://www.w3.org/2002/07/owl#",
  prov: "http://www.w3.org/ns/prov#",
  lpg: "https://example.org/lpg#",
  schema: "https://schema.org/",
  ex: "http://neo4j.example/movie-ext#",
  wd: "http://www.wikidata.org/entity/",
  wdt: "http://www.wikidata.org/prop/direct/",
  wp: "http://www.wikidata.org/prop/",
  ps: "http://www.wikidata.org/prop/statement/",
  pq: "http://www.wikidata.org/prop/qualifier/",
};

export const GENERATED_AT = NS.prov + "generatedAtTime";

/** Parse a TriG document; every quad is moved to the default graph. */
export function parseTrig(trig: string): Quad[] {
  const quads = new Parser({ format: "application/trig" }).parse(trig);
  return quads.map((q) => quad(q.subject, q.predicate, q.object, defaultGraph()));
}

/** Parse one n20s term string: IRI, `_:id`, or `"lex"^^<dt>` / `"lex"@lang` / `"lex"`. */
export function parseN20sTerm(s: string): Term {
  if (s.startsWith("_:")) return blankNode(s.slice(2));
  if (s.startsWith('"')) {
    const typed = s.lastIndexOf('"^^<');
    if (typed > 0 && s.endsWith(">")) {
      return literal(s.slice(1, typed), namedNode(s.slice(typed + 4, -1)));
    }
    const lang = s.lastIndexOf('"@');
    if (lang > 0 && /^[a-zA-Z-]+$/.test(s.slice(lang + 2))) {
      return literal(s.slice(1, lang), s.slice(lang + 2));
    }
    return literal(s.slice(1, s.endsWith('"') ? -1 : undefined));
  }
  return namedNode(s);
}

export interface TripleRow {
  subject: string;
  predicate: string;
  object: string;
}

export function triplesToQuads(rows: TripleRow[]): Quad[] {
  return rows.map((r) =>
    quad(
      parseN20sTerm(r.subject) as never,
      namedNode(r.predicate),
      parseN20sTerm(r.object) as never,
      defaultGraph()
    )
  );
}

export function withoutGeneratedAt(quads: Quad[]): Quad[] {
  return quads.filter((q) => q.predicate.value !== GENERATED_AT);
}

export function isIsomorphic(a: Quad[], b: Quad[]): boolean {
  return isomorphic(a, b);
}

/** A symmetric difference by N-Triples text, for display when graphs differ. */
export function quadDiff(a: Quad[], b: Quad[], limit = 10): { onlyA: string[]; onlyB: string[] } {
  const key = (q: Quad) =>
    `${termText(q.subject)} ${termText(q.predicate)} ${termText(q.object)}`;
  const sa = new Set(a.map(key));
  const sb = new Set(b.map(key));
  return {
    onlyA: [...sa].filter((x) => !sb.has(x)).slice(0, limit),
    onlyB: [...sb].filter((x) => !sa.has(x)).slice(0, limit),
  };
}

function termText(t: Term): string {
  if (t.termType === "NamedNode") return `<${t.value}>`;
  if (t.termType === "BlankNode") return `_:b`; // labels are arbitrary
  if (t.termType === "Literal") return JSON.stringify(t.value) + "^^" + t.datatype.value;
  return t.value;
}

/** SHA-256 of the sorted N-Triples lines, blank node labels blanked. Display only. */
export async function snapshotFingerprint(quads: Quad[]): Promise<string> {
  const lines = quads.map((q) => termText(q.subject) + " " + termText(q.predicate) + " " + termText(q.object)).sort();
  const bytes = new TextEncoder().encode(lines.join("\n"));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Serialize quads as Turtle with the given prefixes. */
export function toTurtle(quads: Quad[], prefixes: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const writer = new Writer({ prefixes });
    writer.addQuads(quads);
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

/** Shorten an IRI with the known prefixes (and the snapshot base). */
export function shorten(iri: string, base: string): string {
  const prefixes: [string, string][] = [
    [base + "/e/", "e:"],
    [base + "/label/", "l:"],
    [base + "/type/", "t:"],
    [base + "/prop/", "p:"],
    [base + "/snapshot/", "s:"],
    ...Object.entries(NS).map(([k, v]) => [v, k + ":"] as [string, string]),
  ];
  for (const [ns, p] of prefixes) if (iri.startsWith(ns)) return p + iri.slice(ns.length);
  return iri;
}
