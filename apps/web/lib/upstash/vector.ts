import { Index } from "@upstash/vector";

// ponytail: proxy defers instantiation to first method call — avoids build-time throw when env vars aren't available during Next.js page data collection
let _index: Index | undefined;
let _emojiIndex: Index<{ emoji: string; label: string }> | undefined;

const getInstance = () => {
  if (!_index) {
    _index = new Index({
      url: process.env.UPSTASH_VECTOR_REST_URL ?? "",
      token: process.env.UPSTASH_VECTOR_REST_TOKEN ?? "",
    });
  }
  return _index;
};

const getEmojiInstance = () => {
  if (!_emojiIndex) {
    _emojiIndex = new Index<{ emoji: string; label: string }>({
      url: process.env.UPSTASH_VECTOR_EMOJI_REST_URL ?? "",
      token: process.env.UPSTASH_VECTOR_EMOJI_REST_TOKEN ?? "",
    });
  }
  return _emojiIndex;
};

export const vectorIndex = new Proxy({} as Index, {
  get(_, prop) {
    return (getInstance() as any)[prop];
  },
});

export const emojiVectorIndex = new Proxy(
  {} as Index<{ emoji: string; label: string }>,
  {
    get(_, prop) {
      return (getEmojiInstance() as any)[prop];
    },
  },
);
