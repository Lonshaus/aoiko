// responseConstraint へ渡す JSON Schema。parseResponse（domain/llm-classify.ts）が受け取る形から
// 起こしている。status は端末内経路だけが送る欄なので、こちらには持たせない。
export const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    classifications: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          accountCode: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'low', 'none'] },
          reason: { type: 'string' },
        },
        required: ['ref', 'accountCode', 'confidence'],
      },
    },
  },
  required: ['classifications'],
} as const;
