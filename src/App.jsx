import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const PAYOUT_STORAGE_KEY = 'rev-ripper:payout-files'
const SHOW_STORAGE_KEY = 'rev-ripper:show-file'

export default function App() {
  const [payoutEntries, setPayoutEntries] = useState([])
  const [showListFile, setShowListFile] = useState(null)
  const [showRows, setShowRows] = useState([])
  const [error, setError] = useState(null)
  const [isPayoutDragActive, setIsPayoutDragActive] = useState(false)
  const [isShowDragActive, setIsShowDragActive] = useState(false)
  const [copiedMetric, setCopiedMetric] = useState(null)
  const payoutInputRef = useRef(null)
  const showInputRef = useRef(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PAYOUT_STORAGE_KEY)
      if (!saved) return
      const parsed = JSON.parse(saved)
      if (!Array.isArray(parsed)) return
      const validEntries = parsed.filter(
        (entry) =>
          entry &&
          typeof entry.id === 'string' &&
          typeof entry.name === 'string' &&
          Array.isArray(entry.rows),
      )
      setPayoutEntries(validEntries)
    } catch {
      // Ignore bad data and start fresh.
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(PAYOUT_STORAGE_KEY, JSON.stringify(payoutEntries))
  }, [payoutEntries])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SHOW_STORAGE_KEY)
      if (!saved) return
      const parsed = JSON.parse(saved)
      if (
        !parsed ||
        typeof parsed.id !== 'string' ||
        typeof parsed.name !== 'string' ||
        !Array.isArray(parsed.rows)
      ) {
        return
      }
      setShowListFile({ name: parsed.name })
      setShowRows(parsed.rows)
    } catch {
      // Ignore bad data and start fresh.
    }
  }, [])

  useEffect(() => {
    if (!showRows.length || !showListFile?.name) {
      localStorage.removeItem(SHOW_STORAGE_KEY)
      return
    }
    localStorage.setItem(
      SHOW_STORAGE_KEY,
      JSON.stringify({
        id: showListFile.id ?? showListFile.name,
        name: showListFile.name,
        rows: showRows,
      }),
    )
  }, [showRows, showListFile])

  const loadPayouts = useCallback(async (fileList) => {
    const files = Array.from(fileList || [])
    setError(null)
    if (files.length === 0) {
      return
    }
    try {
      const parsedFiles = []
      for (const f of files) {
        const data = await parseCsvFile(f)
        parsedFiles.push({
          id: `${f.name}:${f.size}:${f.lastModified}`,
          name: f.name,
          rows: data,
        })
      }
      setPayoutEntries((prev) => {
        const existingIds = new Set(prev.map((entry) => entry.id))
        const uniqueIncoming = parsedFiles.filter((entry) => !existingIds.has(entry.id))
        return [...prev, ...uniqueIncoming]
      })
    } catch (e) {
      setError(e?.message || 'Could not read payout CSV.')
    }
  }, [])

  const removePayoutFile = useCallback((id) => {
    setPayoutEntries((prev) => prev.filter((entry) => entry.id !== id))
  }, [])

  const onDragOverPayouts = useCallback((event) => {
    event.preventDefault()
    if (!isPayoutDragActive) {
      setIsPayoutDragActive(true)
    }
  }, [isPayoutDragActive])

  const onDragLeavePayouts = useCallback((event) => {
    event.preventDefault()
    setIsPayoutDragActive(false)
  }, [])

  const onDropPayouts = useCallback(
    (event) => {
      event.preventDefault()
      setIsPayoutDragActive(false)
      loadPayouts(event.dataTransfer?.files)
    },
    [loadPayouts],
  )

  const loadShowList = useCallback(async (fileList) => {
    const f = fileList?.[0] ?? null
    setError(null)
    if (!f) {
      setShowListFile(null)
      setShowRows([])
      return
    }
    try {
      const data = await parseCsvFile(f)
      setShowListFile({
        id: `${f.name}:${f.size}:${f.lastModified}`,
        name: f.name,
      })
      setShowRows(data)
    } catch (e) {
      setError(e?.message || 'Could not read show order list.')
      setShowListFile(null)
      setShowRows([])
    }
  }, [])

  const removeShowListFile = useCallback(() => {
    setShowListFile(null)
    setShowRows([])
    setError(null)
  }, [])

  const onDragOverShow = useCallback((event) => {
    event.preventDefault()
    if (!isShowDragActive) {
      setIsShowDragActive(true)
    }
  }, [isShowDragActive])

  const onDragLeaveShow = useCallback((event) => {
    event.preventDefault()
    setIsShowDragActive(false)
  }, [])

  const onDropShow = useCallback(
    (event) => {
      event.preventDefault()
      setIsShowDragActive(false)
      loadShowList(event.dataTransfer?.files)
    },
    [loadShowList],
  )

  const showIds = useMemo(() => extractShowOrderIds(showRows), [showRows])
  const rows = useMemo(
    () => payoutEntries.flatMap((entry) => entry.rows),
    [payoutEntries],
  )

  const result = useMemo(() => {
    if (!rows.length) return null
    return aggregatePayoutRows(rows, showIds)
  }, [rows, showIds])

  const copyAmount = useCallback(async (key, amount) => {
    try {
      await navigator.clipboard.writeText(formatMoney(amount))
      setCopiedMetric(key)
      window.setTimeout(() => setCopiedMetric(null), 1200)
    } catch {
      setError('Could not copy to clipboard.')
    }
  }, [])

  return (
    <div className="layout">
      <header className="hero">
        <h1 className="title">Shopify Reconcile Tool</h1>
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
          <div
            className={`dropzone${isPayoutDragActive ? ' dropzone--active' : ''}`}
            onDragOver={onDragOverPayouts}
            onDragLeave={onDragLeavePayouts}
            onDrop={onDropPayouts}
            onClick={() => payoutInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                payoutInputRef.current?.click()
              }
            }}
            aria-label="Drag and drop payout CSVs or click to select"
          >
            Drag and drop CSV files here, or click to browse.
          </div>
          <input
            id="payout-input"
            className="input"
            type="file"
            accept=".csv,text/csv"
            multiple
            ref={payoutInputRef}
            onChange={(e) => loadPayouts(e.target.files)}
          />
          {payoutEntries.length > 0 && (
            <p className="hint">
              {payoutEntries.length} file{payoutEntries.length === 1 ? '' : 's'} added
            </p>
          )}
          {payoutEntries.length > 0 && (
            <ul className="file-list" aria-label="Added payout files">
              {payoutEntries.map((entry) => (
                <li key={entry.id} className="file-list__item">
                  <span>{entry.name}</span>
                  <button
                    type="button"
                    className="file-list__remove"
                    onClick={() => removePayoutFile(entry.id)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="field">
          <label className="label" htmlFor="show-input">
            Show Order List (CSV)
          </label>
          <div
            className={`dropzone${isShowDragActive ? ' dropzone--active' : ''}`}
            onDragOver={onDragOverShow}
            onDragLeave={onDragLeaveShow}
            onDrop={onDropShow}
            onClick={() => showInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                showInputRef.current?.click()
              }
            }}
            aria-label="Drag and drop show order CSV or click to select"
          >
            Drag and drop show order CSV here, or click to browse.
          </div>
          <input
            id="show-input"
            className="input"
            type="file"
            accept=".csv,text/csv"
            ref={showInputRef}
            onChange={(e) => loadShowList(e.target.files)}
          />
          {showListFile && (
            <div className="file-list__item">
              <span className="hint">{showListFile.name}</span>
              <button
                type="button"
                className="file-list__remove"
                onClick={removeShowListFile}
              >
                Delete
              </button>
            </div>
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
              <dd className="metric__value-wrap">
                <span className="metric__value">{formatMoney(result.shopSales)}</span>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => copyAmount('shopSales', result.shopSales)}
                >
                  {copiedMetric === 'shopSales' ? 'Copied' : 'Copy'}
                </button>
              </dd>
            </div>
            <div className="metric">
              <dt className="metric__label">Online sales</dt>
              <dd className="metric__value-wrap">
                <span className="metric__value">{formatMoney(result.onlineSales)}</span>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => copyAmount('onlineSales', result.onlineSales)}
                >
                  {copiedMetric === 'onlineSales' ? 'Copied' : 'Copy'}
                </button>
              </dd>
            </div>
            <div className="metric">
              <dt className="metric__label">Trade show sales</dt>
              <dd className="metric__value-wrap">
                <span className="metric__value">{formatMoney(result.tradeShowSales)}</span>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => copyAmount('tradeShowSales', result.tradeShowSales)}
                >
                  {copiedMetric === 'tradeShowSales' ? 'Copied' : 'Copy'}
                </button>
              </dd>
            </div>
            <div className="metric metric--out">
              <dt className="metric__label">Refunds (total)</dt>
              <dd className="metric__value-wrap">
                <span className="metric__value">{formatMoney(result.refunds)}</span>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => copyAmount('refunds', result.refunds)}
                >
                  {copiedMetric === 'refunds' ? 'Copied' : 'Copy'}
                </button>
              </dd>
            </div>
            <div className="metric metric--out">
              <dt className="metric__label">Fees (total)</dt>
              <dd className="metric__value-wrap">
                <span className="metric__value">{formatMoney(result.fees)}</span>
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => copyAmount('fees', result.fees)}
                >
                  {copiedMetric === 'fees' ? 'Copied' : 'Copy'}
                </button>
              </dd>
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

      {!result && payoutEntries.length === 0 && !error && (
        <p className="empty">Add at least one payout CSV to see numbers.</p>
      )}
    </div>
  )
}
