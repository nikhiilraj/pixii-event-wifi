declare module "*.svg" {
  const source: string;
  export default source;
}

declare module "*.webp" {
  const source: ArrayBuffer;
  export default source;
}
