export { classify, conceptOf, scopeOf, words, facetValue, FACETS, type Classification, type Term, type TermsFile, type Facet } from './classify.ts';
export { deriveTerms, mergeTerms, conceptFacets, type ApprovedMapping } from './derive.ts';
export { vocabulary, readTermProposals, mergeTermProposals, termId, packetPath, type TermProposal, type TermProposalFile } from './vocab.ts';
export { buildStructure, pairingPrefixes, humanize, type Structure, type Group, type ShippedStructure } from './structure.ts';
