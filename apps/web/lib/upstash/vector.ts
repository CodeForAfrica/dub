import { Index } from "@upstash/vector";

// Lazy proxy defers instantiation to first property access, and returns
// undefined when env vars are missing, so the module loads cleanly at build time.
let _index: Index | undefined;

const getInstance = () => {
  if (!_index) {
    const url = process.env.UPSTASH_VECTOR_REST_URL;
    const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
    if (!url || !token) return undefined;
    _index = new Index({ url, token });
  }
  return _index;
};

export const vectorIndex = new Proxy({} as Index, {
  get(_, prop) {
    const instance = getInstance();
    if (!instance) return undefined;
    return (instance as any)[prop];
  },
});
