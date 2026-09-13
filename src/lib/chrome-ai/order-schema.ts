// responseConstraint へ渡す JSON Schema。parseOrderResponse（domain/order-extract.ts）が
// 受け取る形から起こしている。金額は値引行で負になるため、文字列のまま渡して解析器側で扱う。
export const ORDER_SCHEMA = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    vendor: { type: 'string' },
    orderNumber: { type: 'string' },
    totalAmount: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          amount: { type: 'string' },
        },
        required: ['description', 'amount'],
      },
    },
  },
  required: ['date', 'vendor', 'totalAmount', 'items'],
} as const;
