import { Index } from "@upstash/vector";

// ponytail: lazy proxy defers instantiation to first method call.
// Guards against missing env vars at build time — returns undefined from get
// instead of throwing, so the module loads cleanly without credentials present.
let _index: Index | undefined;
let _emojiIndex: Index<{ emoji: string; label: string }> | undefined;

const getInstance = () => {
  if (!_index) {
    const url = process.env.UPSTASH_VECTOR_REST_URL;
    const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
    if (!url || !token) return undefined;
    _index = new Index({ url, token });
  }
  return _index;
};

const getEmojiInstance = () => {
  if (!_emojiIndex) {
    const url = process.env.UPSTASH_VECTOR_EMOJI_REST_URL;
    const token = process.env.UPSTASH_VECTOR_EMOJI_REST_TOKEN;
    if (!url || !token) return undefined;
    _emojiIndex = new Index<{ emoji: string; label: string }>({ url, token });
  }
  return _emojiIndex;
};

export const vectorIndex = new Proxy({} as Index, {
  get(_, prop) {
    const instance = getInstance();
    if (!instance) return undefined;
    return (instance as any)[prop];
  },
});

export const emojiVectorIndex = new Proxy(
  {} as Index<{ emoji: string; label: string }>,
  {
    get(_, prop) {
      const instance = getEmojiInstance();
      if (!instance) return undefined;
      return (instance as any)[prop];
    },
  },
);
