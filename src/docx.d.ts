// esbuild's "binary" loader (esbuild.config.mjs) turns a .docx import into a Uint8Array.
declare module "*.docx" {
  const content: Uint8Array;
  export default content;
}
