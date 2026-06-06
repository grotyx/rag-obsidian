import { OntologyPack } from "./pack";

/** Tiny built-in example pack (spine domain) so the ontology feature works with
 *  zero setup. Point `ontologyPackPath` at your own JSON (MeSH/MONDO/SNOMED export)
 *  to replace it. Format: { scheme, concepts: [{id, label, synonyms?, parents?}] }. */
export const SAMPLE_PACK: OntologyPack = {
  scheme: "sample-spine",
  concepts: [
    { id: "SPINE", label: "Spinal disorder" },
    { id: "STENOSIS", label: "Spinal stenosis", synonyms: ["canal stenosis"], parents: ["SPINE"] },
    { id: "LSS", label: "Lumbar spinal stenosis", synonyms: ["lumbar stenosis"], parents: ["STENOSIS"] },
    { id: "HNP", label: "Herniated disc", synonyms: ["disc herniation", "herniated nucleus pulposus"], parents: ["SPINE"] },
    { id: "FUSION", label: "Spinal fusion", synonyms: ["arthrodesis"], parents: ["SPINE"] },
    { id: "PLIF", label: "Posterior lumbar interbody fusion", parents: ["FUSION"] },
    { id: "TLIF", label: "Transforaminal lumbar interbody fusion", parents: ["FUSION"] },
    { id: "DECOMP", label: "Decompression", synonyms: ["laminectomy"], parents: ["SPINE"] },
  ],
};
