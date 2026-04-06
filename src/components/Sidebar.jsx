import { useState, useEffect, useRef, useId } from "react";
import { BUILD_DATE, DATA_INTRO, DATA_ROWS } from "../dataSources.js";
import { SCORE_AREA_DIMS, SCORE_PROX_DIMS, CHOROPLETH_LAYERS, FILTER_CHOROPLETH_DIMS } from "../config.js";

// #3: keyboard handler for accessible interactive elements
function onKeyActivate(callback) {
  return (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      callback();
    }
  };
}

/** Hover shows tooltip on pointer devices; tap toggles + tap-outside dismiss for touch. Tooltip is right-anchored (see `.score-info--tooltip-end`) so it is not clipped by the sidebar. */
export function InfoTip({ tip }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!tip) return null;

  return (
    <span
      ref={ref}
      className={`score-info score-info--tooltip-end ${open ? "score-info--open" : ""}`}
      role="button"
      tabIndex={0}
      aria-label="About this layer"
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((o) => !o);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }
      }}
    >
      i
      <span className="score-tooltip">{tip}</span>
    </span>
  );
}

export function PostcodeSearch({ onResult }) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const search = async (e) => {
    e.preventDefault();
    setError("");
    const q = query.trim().toUpperCase();
    if (!q) return;
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`);
      if (!res.ok) { setError("Postcode not found"); return; }
      const data = await res.json();
      if (data.status === 200 && data.result) {
        onResult({
          lat: data.result.latitude,
          lng: data.result.longitude,
          postcode: data.result.postcode,
          ward: data.result.admin_ward,
          borough: data.result.admin_district,
        });
        setQuery("");
        setError("");
      } else {
        setError("Postcode not found");
      }
    } catch {
      setError("Search failed");
    }
  };

  return (
    <form className="search search-block" onSubmit={search}>
      <div className="search-input-wrap">
        <span className="search-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. SW1A 1AA, E2 8DY"
          className="search-input"
          autoComplete="postal-code"
          aria-label="UK postcode"
        />
      </div>
      <button type="submit" className="search-btn">Pin</button>
      {error && <div className="search-error">{error}</div>}
    </form>
  );
}

function ScoreBar({ score, label, detail, enabled, onToggle, tip }) {
  const color = score >= 70 ? "#4ade80" : score >= 40 ? "#fbbf24" : "#f87171";
  return (
    <div
      className={`score-row ${enabled === false ? "score-disabled" : ""}`}
      onClick={onToggle}
      onKeyDown={onToggle ? onKeyActivate(onToggle) : undefined}
      tabIndex={onToggle ? 0 : undefined}
      role={onToggle ? "button" : undefined}
      style={{ cursor: onToggle ? "pointer" : undefined }}
    >
      {onToggle && (
        <span className={`score-toggle ${enabled === false ? "" : "score-toggle-on"}`} />
      )}
      <span className="score-label">{label}</span>
      {tip && <InfoTip tip={tip} />}
      <div className="score-bar-track">
        <div className="score-bar-fill" style={{ width: `${score}%`, background: enabled === false ? "#555" : color }} />
      </div>
      <span className="score-value">{score}</span>
      {detail && <span className="score-detail">{detail}</span>}
    </div>
  );
}

export function PostcodeScoreCard({ postcode, scores, expanded, onToggle, onToggleDim, onSelectAll, onDeselectAll }) {
  const overallColor = scores.overall >= 70 ? "#4ade80" : scores.overall >= 40 ? "#fbbf24" : "#f87171";
  return (
    <div className="score-card">
      <div
        className="score-card-header"
        onClick={onToggle}
        onKeyDown={onKeyActivate(onToggle)}
        tabIndex={0}
        role="button"
        aria-expanded={expanded}
      >
        <div className="score-card-title">
          <strong>{postcode.postcode}</strong>
          <span>{postcode.ward}, {postcode.borough}</span>
        </div>
        <div className="score-overall" style={{ borderColor: overallColor, color: overallColor }}>
          {scores.overall}
        </div>
      </div>
      {expanded && (
        <div className="score-card-body">
          <div className="score-bulk-actions">
            <button className="score-bulk-btn" onClick={onSelectAll}>All</button>
            <button className="score-bulk-btn" onClick={onDeselectAll}>None</button>
          </div>
          <div className="score-section-title">Area Quality <span className="score-hint">(click row to toggle)</span></div>
          {Object.entries(scores.area).map(([dimId, s]) => (
            <ScoreBar
              key={dimId}
              score={s.score}
              label={s.label}
              enabled={s.enabled}
              onToggle={() => onToggleDim(dimId)}
              tip={s.tip}
            />
          ))}
          <div className="score-section-title">Proximity</div>
          {Object.entries(scores.proximity).map(([dimId, s]) => (
            <ScoreBar
              key={dimId}
              score={s.score}
              label={s.label}
              detail={`${s.nearby || 0}x ${s.dist < 1000 ? `${s.dist}m` : `${(s.dist / 1000).toFixed(1)}km`}`}
              enabled={s.enabled}
              onToggle={() => onToggleDim(dimId)}
              tip={s.tip}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ComparisonBar({ values, postcodes }) {
  const max = Math.max(...values.map((v) => v.score));
  return (
    <div className="cmp-bars">
      {postcodes.map((p, i) => {
        const v = values[i];
        if (!v) return null;
        const color = v.score >= 70 ? "#4ade80" : v.score >= 40 ? "#fbbf24" : "#f87171";
        const isBest = values.length > 1 && v.score === max && values.filter((x) => x.score === max).length === 1;
        return (
          <div key={p.postcode} className="cmp-bar-row">
            <span className="cmp-pc-label">{p.postcode}</span>
            <div className="cmp-bar-track">
              <div className="cmp-bar-fill" style={{ width: `${v.score}%`, background: color }} />
            </div>
            <span className={`cmp-bar-val ${isBest ? "cmp-best" : ""}`}>{v.score}</span>
            {v.detail && <span className="cmp-bar-detail">{v.detail}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function ComparisonTable({ postcodes, allScores }) {
  if (postcodes.length < 2) return null;
  const sample = allScores[postcodes[0].postcode];
  if (!sample) return null;

  const areaDims = Object.entries(sample.area).map(([id, s]) => ({ id, label: s.label, type: "area" }));
  const proxDims = Object.entries(sample.proximity).map(([id, s]) => ({ id, label: s.label, type: "prox" }));

  const getValues = (dimId, type) =>
    postcodes.map((p) => {
      const scores = allScores[p.postcode];
      if (!scores) return { score: 0 };
      const bucket = type === "area" ? scores.area : scores.proximity;
      const entry = bucket[dimId];
      if (!entry) return { score: 0 };
      const detail = entry.dist != null
        ? `${entry.nearby || ""}${entry.nearby ? "x " : ""}${entry.dist < 1000 ? `${entry.dist}m` : `${(entry.dist / 1000).toFixed(1)}km`}`
        : null;
      return { score: entry.score, detail };
    });

  return (
    <div className="comparison-panel">
      <div className="cmp-section">
        <div className="cmp-section-title">Overall</div>
        <div className="cmp-overall-row">
          {postcodes.map((p) => {
            const s = allScores[p.postcode]?.overall || 0;
            const color = s >= 70 ? "#4ade80" : s >= 40 ? "#fbbf24" : "#f87171";
            return (
              <div key={p.postcode} className="cmp-overall-card">
                <div className="cmp-overall-score" style={{ borderColor: color, color }}>{s}</div>
                <div className="cmp-overall-label">{p.postcode}</div>
                <div className="cmp-overall-sub">{p.ward}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="cmp-section">
        <div className="cmp-section-title">Area Quality</div>
        {areaDims.map((dim) => (
          <div key={dim.id} className="cmp-metric">
            <div className="cmp-metric-label">{dim.label}</div>
            <ComparisonBar values={getValues(dim.id, "area")} postcodes={postcodes} />
          </div>
        ))}
      </div>

      <div className="cmp-section">
        <div className="cmp-section-title">Proximity</div>
        {proxDims.map((dim) => (
          <div key={dim.id} className="cmp-metric">
            <div className="cmp-metric-label">{dim.label}</div>
            <ComparisonBar values={getValues(dim.id, "prox")} postcodes={postcodes} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, children, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  const descId = useId();
  return (
    <div className="modal-root" role="presentation">
      <div className="modal-backdrop" onClick={onCancel} aria-hidden="true" />
      <div
        className="modal-panel modal-panel--confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby={descId}
      >
        <div className="modal-header">
          <h2 id="confirm-modal-title">{title}</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body modal-body--confirm">
          <div id={descId} className="modal-intro confirm-modal-desc">
            {children}
          </div>
          <div className="confirm-modal-actions">
            <button type="button" className="confirm-modal-btn confirm-modal-btn--secondary" onClick={onCancel}>
              {cancelLabel}
            </button>
            <button type="button" className="confirm-modal-btn confirm-modal-btn--primary" onClick={onConfirm}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DataAboutModal({ onClose }) {
  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-labelledby="data-modal-title">
      <div className="modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal-panel">
        <div className="modal-header">
          <h2 id="data-modal-title">Data & freshness</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-intro">{DATA_INTRO}</p>
          <p className="modal-build">
            <strong>Site build date:</strong> {BUILD_DATE} (from when this version was built; redeploy updates it.)
          </p>
          <ul className="modal-data-list">
            {DATA_ROWS.map((row) => (
              <li key={row.id}>
                <div className="modal-data-title">{row.title}</div>
                <div className="modal-data-meta">{row.source}</div>
                <div className="modal-data-vintage">{row.vintage}</div>
              </li>
            ))}
          </ul>
          <p className="modal-foot">For exploration only — not planning, legal, or financial advice.</p>
        </div>
      </div>
    </div>
  );
}

export function FilterPanel({ filters, setFilters }) {
  return (
    <div className="filter-panel">
      {FILTER_CHOROPLETH_DIMS.map((dim) => (
        <div key={dim.id} className="filter-row">
          <label className="filter-label">
            {dim.label}
            <span className="filter-value">
              {filters[dim.id] != null
                ? dim.mode === "min"
                  ? `\u2265 ${filters[dim.id]}`
                  : `< ${filters[dim.id]}`
                : "off"}
            </span>
          </label>
          <input
            type="range"
            min={dim.min}
            max={dim.max}
            step={dim.step ?? 1}
            value={
              filters[dim.id] != null
                ? filters[dim.id]
                : dim.mode === "min"
                  ? dim.min
                  : dim.max
            }
            onChange={(e) => {
              const val = dim.step != null && dim.step < 1
                ? parseFloat(e.target.value)
                : parseInt(e.target.value, 10);
              setFilters((prev) => {
                const next = { ...prev };
                if (dim.mode === "min") {
                  if (val <= dim.min) delete next[dim.id];
                  else next[dim.id] = val;
                } else {
                  if (val >= dim.max) delete next[dim.id];
                  else next[dim.id] = val;
                }
                return next;
              });
            }}
            className="filter-slider"
          />
        </div>
      ))}
      {Object.keys(filters).length > 0 && (
        <button className="filter-clear" onClick={() => setFilters({})}>
          Reset filters
        </button>
      )}
    </div>
  );
}

export function SidebarFooter({ onCopyShare, onShowData, shareTip, githubUrl }) {
  return (
    <div className="sidebar-footer">
      <div className="sidebar-actions-row">
        <button type="button" className="sidebar-link-btn" onClick={onCopyShare}>
          Copy share link
        </button>
        <button type="button" className="sidebar-link-btn" onClick={onShowData}>
          Data & freshness
        </button>
      </div>
      <a className="sidebar-source-link" href={githubUrl} target="_blank" rel="noreferrer">
        Source code on GitHub
      </a>
      {shareTip ? <p className="sidebar-toast">{shareTip}</p> : null}
    </div>
  );
}
