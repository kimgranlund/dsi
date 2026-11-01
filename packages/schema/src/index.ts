export { loadOntology, expand, inScheme, DSI, type Issue, type Ontology } from './ontology.ts';
export { validateRepo, createAjv, SCHEMA_DIR, facetOfConcept, TERM_FACETS, type ValidateOptions } from './validate.ts';
export { parseConcept, normalizeConcept, canonicalNameOf, conceptName, conceptDefinition, readLexicon, isRegistered, registerConcepts, gateUnregistered, applyDefinitions, CONCEPT_FACETS, type ParsedConcept, type Word } from './concepts.ts';
