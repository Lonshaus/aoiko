// responseConstraint へ渡す JSON Schema。parseOcrResponse（domain/ocr.ts）が受け取る形から
// 起こしている。ここが狭いと、解析器なら拾えたはずの欄が返ってこなくなる。
export const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    vendorName: { type: 'string' },
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
    taxAmount: { type: 'string' },
    taxRate: { type: 'number' },
    invoiceNumber: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['date', 'vendorName', 'totalAmount', 'items'],
} as const;
