import { useCallback, useMemo, useState } from 'react'
import Papa from 'papaparse'
import {
  aggregatePayoutRows,
  extractShowOrderIds,
} from './lib/aggregateRevenue.js'
import './App.css'

function formatMoney(n) {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: (err) => reject(err),
    })
  })
}

export default function App() {
  const [payoutFiles, setPayoutFiles] = useState([])
  const [showListFile, setShowListFile] = useState(null)
  const [rows, setRows] = useState([])
  const [showRows, setShowRows] = useState([])
  const [error, setError] = useState(null)

  const loadPayouts = useCallback(async (fileList) => {
    const files = Array.from(fileList || [])
    setPayoutFiles(files)
    setError(null)
    if (files.length === 0) {
      setRows([])
      return
    }
    try {
      const all = []
      for (const f of files) {
        const data = await parseCsvFile(f)
        all.push(...data)
      }
      setRows(all)
    } catch (e) {
      setError(e?.message || 'Could not read payout CSV.')
      setRows([])
    }
  }, [])

  const loadShowList = useCallback(async (fileList) => {
    const f = fileList?.[0] ?? null
    setShowListFile(f)
    setError(null)
    if (!f) {
      setShowRows([])
      return
    }
    try {
      const data = await parseCsvFile(f)
      setShowRows(data)
    } catch (e) {
      setError(e?.message || 'Could not read show order list.')
      setShowRows([])
    }
  }, [])

  const showIds = useMemo(() => extractShowOrderIds(showRows), [showRows])

  const result = useMemo(() => {
    if (!rows.length) return null
    return aggregatePayoutRows(rows, showIds)
  }, [rows, showIds])

  return (
    <div className="layout">
      <header className="hero">
        <h1 className="title">Rev Ripper</h1>
        <p className="lede">
          Upload Shopify Payments payout CSVs and your Show Order List. We split
          revenue into shop (POS), online, and trade show (matched orders), and
          total refunds and fees.
        </p>
      </header>

      <section className="panel" aria-label="Upload files">
        <div className="field">
          <label className="label" htmlFor="payout-input">
            Shopify payout CSVs
          </label>
          <input
            id="payout-input"
            className="input"
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={(e) => loadPayouts(e.target.files)}
          />
          {payoutFiles.length > 0 && (
            <p className="hint">
              {payoutFiles.length} file{payoutFiles.length === 1 ? '' : 's'} selected
            </p>
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="show-input">
            Show Order List (CSV)
          </label>
          <input
            id="show-input"
            className="input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => loadShowList(e.target.files)}
          />
          {showListFile && (
            <p className="hint">{showListFile.name}</p>
          )}
        </div>
        {showIds.size > 0 && (
          <p className="hint">
            Matched {showIds.size} show order{showIds.size === 1 ? '' : 's'} from your list.
          </p>
        )}
      </section>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      {result && (
        <section className="results" aria-live="polite">
          <h2 className="results__title">Breakdown</h2>
          <dl className="grid">
            <div className="metric">
              <dt className="metric__label">Shop sales (POS / in-store)</dt>
              <dd className="metric__value">{formatMoney(result.shopSales)}</dd>
            </div>
            <div className="metric">
              <dt className="metric__label">Online sales</dt>
              <dd className="metric__value">{formatMoney(result.onlineSales)}</dd>
            </div>
            <div className="metric">
              <dt className="metric__label">Trade show sales</dt>
              <dd className="metric__value">{formatMoney(result.tradeShowSales)}</dd>
            </div>
            <div className="metric metric--out">
              <dt className="metric__label">Refunds (total)</dt>
              <dd className="metric__value">{formatMoney(result.refunds)}</dd>
            </div>
            <div className="metric metric--out">
              <dt className="metric__label">Fees (total)</dt>
              <dd className="metric__value">{formatMoney(result.fees)}</dd>
            </div>
          </dl>
          <p className="hint">
            Accounted order rows: {result.orderedRowsAccounted} / {result.orderedRowsTotal}
            {result.orderedRowsUnaccounted > 0
              ? ` (${result.orderedRowsUnaccounted} still unaccounted)`
              : ' (all order rows accounted)'}
          </p>

          <div className="totals">
            <div className="total total--gross">
              <span className="total__label">Gross sales (three channels)</span>
              <span className="total__value">
                {formatMoney(
                  result.shopSales + result.onlineSales + result.tradeShowSales,
                )}
              </span>
            </div>
            <div className="total total--net">
              <span className="total__label">
                Net payout total (sales − refunds)
              </span>
              <span className="total__value">{formatMoney(result.netTotal)}</span>
            </div>
            <div className="total total--sum5">
              <span className="total__label">
                Sum of all five figures (shop + online + trade + refunds + fees)
              </span>
              <span className="total__value">{formatMoney(result.sumDisplayedFive)}</span>
            </div>
            <p className="total-note">
              Gross sales is only the three channels. Net total is what remains
              after subtracting refunds only (sales are already net values). The
              bottom line is the simple arithmetic sum of the five displayed
              amounts (useful if you track refunds and fees as positive line
              items elsewhere).
            </p>
          </div>
        </section>
      )}

      {!result && rows.length === 0 && !error && (
        <p className="empty">Add at least one payout CSV to see numbers.</p>
      )}
    </div>
  )
}
