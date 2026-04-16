/**
 * Shopify payout / transaction CSVs + optional show order list → revenue breakdown.
 * Headers are matched flexibly (case-insensitive, common aliases).
 */

const TYPE_KEYS = ['type', 'transaction type', 'transaction_type', 'kind']
const AMOUNT_KEYS = ['amount', 'gross', 'gross amount']
const FEE_KEYS = ['fee', 'fees', 'processing fee', 'shopify fee']
const NET_KEYS = ['net', 'net amount', 'net payout']
const ORDER_KEYS = [
  'order',
  'order name',
  'order id',
  'order number',
  'order #',
  'order_id',
]
const SOURCE_KEYS = [
  'source',
  'source name',
  'channel',
  'payment source',
  'sales channel',
]

function normHeader(h) {
  if (h == null || typeof h !== 'string') return ''
  return h.trim().toLowerCase()
}

function pickColumn(row, keys) {
  if (!row || typeof row !== 'object') return ''
  const map = new Map()
  for (const [k, v] of Object.entries(row)) {
    map.set(normHeader(k), v)
  }
  for (const key of keys) {
    if (map.has(key)) return map.get(key)
  }
  for (const key of keys) {
    for (const [hk, val] of map) {
      if (hk.includes(key) || key.includes(hk)) return val
    }
  }
  return ''
}

export function parseMoney(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  const s = String(value).trim()
  if (!s) return null

  const isParenNegative = /^\(.*\)$/u.test(s)
  const cleaned = s
    .replace(/[()]/g, '')
    .replace(/[$€£¥\s]/g, '')
    .replace(/,/g, '')

  const n = Number.parseFloat(cleaned)
  if (!Number.isFinite(n)) return null
  return isParenNegative ? -Math.abs(n) : n
}

/** Normalize order id for matching (#1001 → 1001). */
export function normalizeOrderId(raw) {
  if (raw == null) return ''
  const s = String(raw).trim()
  if (!s) return ''
  const digits = s.match(/\d+/)
  return digits ? digits[0] : s.replace(/^#/u, '').trim()
}

function buildOrderTokens(raw) {
  const tokens = new Set()
  if (raw == null) return tokens

  const text = String(raw).trim()
  if (!text) return tokens

  const lower = text.toLowerCase()
  const noHash = lower.replace(/^#/u, '').trim()
  const normalized = normalizeOrderId(text).toLowerCase()

  tokens.add(lower)
  if (noHash) tokens.add(noHash)
  if (normalized) tokens.add(normalized)
  return tokens
}

function isRefundType(type) {
  return /refund|chargeback|dispute/i.test(type || '')
}

function isBankMovementType(type) {
  return /^(payout|deposit|withdrawal|transfer|reserved|reserve|pending)/i.test(
    String(type || '').trim(),
  )
}

function isFeeOnlyType(type) {
  return /^fee|processing|adjustment.*fee/i.test(String(type || '').trim())
}

function sourceIsPos(source) {
  const s = String(source || '').toLowerCase()
  return (
    s.includes('point of sale') ||
    s.includes('pos') ||
    s.includes('retail') ||
    s.includes('shopify pos')
  )
}

/**
 * Build a Set of order ids from show list rows (flexible columns).
 */
export function extractShowOrderIds(rows) {
  const ids = new Set()
  if (!rows?.length) return ids

  const headers = Object.keys(rows[0]).map(normHeader)
  let orderCol = headers.find(
    (h) =>
      h.includes('order') ||
      h.includes('invoice') ||
      h.includes('receipt') ||
      h === 'name',
  )
  if (!orderCol) {
    orderCol = headers[0]
  }

  const key =
    Object.keys(rows[0]).find((k) => normHeader(k) === orderCol) || Object.keys(rows[0])[0]

  for (const row of rows) {
    const cell = row[key]
    if (cell == null || String(cell).trim() === '') continue
    for (const token of buildOrderTokens(cell)) {
      ids.add(token)
    }
  }
  return ids
}

/**
 * @param {Record<string, string>[]} payoutRows - Parsed CSV rows from one or more payout files
 * @param {Set<string>} showOrderIds - Normalized order ids counted as trade show
 */
export function aggregatePayoutRows(payoutRows, showOrderIds) {
  const showSet = showOrderIds instanceof Set ? showOrderIds : new Set(showOrderIds || [])

  let shopSales = 0
  let onlineSales = 0
  let tradeShowSales = 0
  let refunds = 0
  let fees = 0
  let orderedRowsTotal = 0
  let orderedRowsAccounted = 0

  for (const row of payoutRows) {
    const typeRaw = String(pickColumn(row, TYPE_KEYS) || '').trim()
    const orderRaw = pickColumn(row, ORDER_KEYS)
    const orderTokens = buildOrderTokens(orderRaw)
    const source = pickColumn(row, SOURCE_KEYS)

    const feeVal = parseMoney(pickColumn(row, FEE_KEYS))
    const amountVal = parseMoney(pickColumn(row, AMOUNT_KEYS))
    const netVal = parseMoney(pickColumn(row, NET_KEYS))

    const emptyOrder = orderRaw == null || String(orderRaw).trim() === ''
    if (!emptyOrder) orderedRowsTotal += 1

    if (isFeeOnlyType(typeRaw) && emptyOrder) {
      const standaloneFee =
        feeVal != null && feeVal !== 0
          ? Math.abs(feeVal)
          : Math.abs(netVal ?? amountVal ?? 0)
      if (standaloneFee) fees += standaloneFee
      continue
    }

    if (feeVal != null && feeVal !== 0) {
      fees += Math.abs(feeVal)
    }

    if (isBankMovementType(typeRaw) && !isRefundType(typeRaw)) {
      continue
    }

    if (isRefundType(typeRaw)) {
      const r = amountVal != null ? amountVal : netVal
      if (r != null && r !== 0) refunds += Math.abs(r)
      if (!emptyOrder) orderedRowsAccounted += 1
      continue
    }

    const valueBase = amountVal != null ? amountVal : netVal
    if (valueBase == null || valueBase === 0) continue

    // Sales channels are strictly order-based. Non-order rows can still affect
    // fees/refunds above, but must not inflate shop/online/trade sales totals.
    if (orderTokens.size === 0) {
      continue
    }

    if (valueBase < 0) {
      refunds += Math.abs(valueBase)
      if (!emptyOrder) orderedRowsAccounted += 1
      continue
    }

    const isTradeShowOrder = [...orderTokens].some((token) => showSet.has(token))
    if (isTradeShowOrder) {
      tradeShowSales += valueBase
    } else if (sourceIsPos(source)) {
      shopSales += valueBase
    } else {
      onlineSales += valueBase
    }
    if (!emptyOrder) orderedRowsAccounted += 1
  }

  return {
    shopSales,
    onlineSales,
    tradeShowSales,
    refunds,
    fees,
    netTotal: shopSales + onlineSales + tradeShowSales - refunds - fees,
    sumDisplayedFive: shopSales + onlineSales + tradeShowSales - refunds - fees,
    orderedRowsTotal,
    orderedRowsAccounted,
    orderedRowsUnaccounted: Math.max(orderedRowsTotal - orderedRowsAccounted, 0),
  }
}
