import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Moon,
  Plus,
  CalendarDays,
  Activity,
  BookOpen,
  Settings2,
  X,
  Check,
  PartyPopper,
  Sparkles,
  Info,
  Sun,
  Leaf,
  CloudMoon,
  Droplets,
  HelpCircle,
  Download,
  Printer,
} from "lucide-react";

/* ---------------------------------------------------------------
   CycleCare — a menstrual cycle tracking & awareness web app
   Signature element: the "Moon Dial" — a radial cycle wheel that
   maps the cycle onto a lunar-style ring, with a confidence band
   for the predicted next period sitting where the ring renews.
--------------------------------------------------------------- */

const STORAGE_KEY = "cyclecare:data";

const SYMPTOM_TAGS = [
  { id: "cramps", label: "Cramps", icon: "〰" },
  { id: "headache", label: "Headache", icon: "☍" },
  { id: "bloating", label: "Bloating", icon: "◍" },
  { id: "fatigue", label: "Fatigue", icon: "☾" },
  { id: "mood", label: "Mood swings", icon: "≈" },
  { id: "acne", label: "Acne", icon: "•" },
  { id: "backache", label: "Backache", icon: "⌒" },
  { id: "nausea", label: "Nausea", icon: "∿" },
  { id: "cravings", label: "Cravings", icon: "◆" },
  { id: "tender", label: "Tender breasts", icon: "△" },
];

// Sample offline festival dataset (illustrative dates — a real build
// would ship an updated local file, as noted in the project synopsis).
const FESTIVALS = [
  { id: "f-holi", name: "Holi", date: "2026-03-04", category: "festival" },
  { id: "f-navratri", name: "Navratri begins", date: "2026-03-19", category: "festival" },
  { id: "f-eid", name: "Eid al-Fitr", date: "2026-03-20", category: "festival" },
  { id: "f-rakhi", name: "Raksha Bandhan", date: "2026-08-28", category: "festival" },
  { id: "f-ganesh", name: "Ganesh Chaturthi", date: "2026-09-14", category: "festival" },
  { id: "f-navratri2", name: "Navratri (autumn)", date: "2026-10-11", category: "festival" },
  { id: "f-diwali", name: "Diwali", date: "2026-11-08", category: "festival" },
  { id: "f-christmas", name: "Christmas", date: "2026-12-25", category: "festival" },
];

const PALETTE = {
  bandLight: "#F3C9D3",
  bandMid: "#E88CA6",
  bandDark: "#C23A63",
  menstrual: "#C23A63",
  follicular: "#E8CE96",
  ovulation: "#D9A94E",
  luteal: "#6B3E56",
};

/* ---------------- date helpers ---------------- */
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}
function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}
function fmtShort(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtLong(d) {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function todayMidnight() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/* ---------------- polar math for the Moon Dial ---------------- */
function polarToCartesian(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function describeArc(cx, cy, r, startAngle, endAngle) {
  if (endAngle - startAngle >= 359.9) endAngle = startAngle + 359.9;
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

/* ---------------- cycle statistics ---------------- */
function useCycleStats(periods, profile) {
  return useMemo(() => {
    const sorted = [...periods].sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
    const lengths = [];
    for (let i = 1; i < sorted.length; i++) {
      lengths.push(daysBetween(parseISO(sorted[i - 1].startDate), parseISO(sorted[i].startDate)));
    }
    const avgCycle = lengths.length ? Math.round(mean(lengths)) : profile.avgCycleLength || 28;
    const periodLens = sorted
      .filter((p) => p.endDate)
      .map((p) => daysBetween(parseISO(p.startDate), parseISO(p.endDate)) + 1);
    const avgPeriod = periodLens.length ? Math.round(mean(periodLens)) : profile.avgPeriodLength || 5;
    const stdev =
      lengths.length >= 2
        ? Math.sqrt(mean(lengths.map((l) => (l - avgCycle) ** 2)))
        : 3;
    const hasEstimated = sorted.some((p) => !p.exact);
    const widen = hasEstimated ? 1.5 : 1;
    const lastPeriod = sorted.length ? sorted[sorted.length - 1] : null;

    const b1 = Math.max(1, Math.round(0.5 * stdev * widen));
    const b2 = Math.max(b1 + 1, Math.round(1 * stdev * widen));
    const b3 = Math.max(b2 + 1, Math.round(1.5 * stdev * widen));

    const predictedStart = lastPeriod ? addDays(parseISO(lastPeriod.startDate), avgCycle) : null;

    const today = todayMidnight();
    let cycleDayRaw = null;
    let cycleDayMod = null;
    if (lastPeriod) {
      cycleDayRaw = daysBetween(parseISO(lastPeriod.startDate), today) + 1;
      cycleDayMod = ((cycleDayRaw - 1) % avgCycle) + 1;
      if (cycleDayMod <= 0) cycleDayMod += avgCycle;
    }

    const ovulationDay = Math.max(avgPeriod + 2, avgCycle - 14);
    let phase = null;
    if (cycleDayMod != null) {
      if (cycleDayMod <= avgPeriod) phase = "Menstrual";
      else if (cycleDayMod >= ovulationDay - 1 && cycleDayMod <= ovulationDay + 1) phase = "Ovulation";
      else if (cycleDayMod < ovulationDay - 1) phase = "Follicular";
      else phase = "Luteal";
    }

    return {
      sorted,
      avgCycle,
      avgPeriod,
      stdev,
      widen,
      lastPeriod,
      predictedStart,
      bands: { b1, b2, b3 },
      cycleDayRaw,
      cycleDayMod,
      ovulationDay,
      phase,
    };
  }, [periods, profile]);
}

/* ---------------- Moon Dial (signature visual) ---------------- */
function MoonDial({ stats }) {
  const size = 300;
  const cx = size / 2;
  const cy = size / 2;
  const phaseR = 108;
  const phaseW = 22;
  const bandR = 138;
  const bandW = 13;

  const { avgCycle, avgPeriod, ovulationDay, cycleDayMod, bands, phase } = stats;
  const angPerDay = 360 / avgCycle;

  const segments = [
    { name: "Menstrual", from: 0, to: avgPeriod, color: PALETTE.menstrual },
    { name: "Follicular", from: avgPeriod, to: Math.max(avgPeriod, ovulationDay - 1), color: PALETTE.follicular },
    {
      name: "Ovulation",
      from: Math.max(avgPeriod, ovulationDay - 1),
      to: Math.min(avgCycle, ovulationDay + 1),
      color: PALETTE.ovulation,
    },
    { name: "Luteal", from: Math.min(avgCycle, ovulationDay + 1), to: avgCycle, color: PALETTE.luteal },
  ].filter((s) => s.to > s.from);

  const markerAngle = cycleDayMod != null ? (cycleDayMod - 0.5) * angPerDay : null;
  const markerPos = markerAngle != null ? polarToCartesian(cx, cy, phaseR, markerAngle) : null;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="dial-svg" role="img" aria-label="Cycle dial">
      <circle cx={cx} cy={cy} r={phaseR} fill="none" stroke="var(--border)" strokeWidth={phaseW + 2} opacity="0.25" />

      {/* confidence bands, widest drawn first so the darkest sits centered on top */}
      <path
        d={describeArc(cx, cy, bandR, -bands.b3 * angPerDay, bands.b3 * angPerDay)}
        stroke={PALETTE.bandLight}
        strokeWidth={bandW}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={describeArc(cx, cy, bandR, -bands.b2 * angPerDay, bands.b2 * angPerDay)}
        stroke={PALETTE.bandMid}
        strokeWidth={bandW}
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={describeArc(cx, cy, bandR, -bands.b1 * angPerDay, bands.b1 * angPerDay)}
        stroke={PALETTE.bandDark}
        strokeWidth={bandW}
        fill="none"
        strokeLinecap="round"
      />

      {segments.map((s) => (
        <path
          key={s.name}
          d={describeArc(cx, cy, phaseR, s.from * angPerDay, s.to * angPerDay)}
          stroke={s.color}
          strokeWidth={phaseW}
          fill="none"
        />
      ))}

      {markerPos && (
        <g>
          <circle cx={markerPos.x} cy={markerPos.y} r={7} fill="var(--text)" stroke={PALETTE.bandDark} strokeWidth="2" />
        </g>
      )}

      <text x={cx} y={cy - 10} textAnchor="middle" className="dial-daylabel">
        {stats.cycleDayRaw != null ? `Day ${stats.cycleDayRaw}` : "—"}
      </text>
      <text x={cx} y={cy + 16} textAnchor="middle" className="dial-phaselabel">
        {phase || "Log a period to begin"}
      </text>
    </svg>
  );
}

/* ---------------- small UI atoms ---------------- */
function Card({ children, className = "" }) {
  return <div className={`cc-card ${className}`}>{children}</div>;
}
function SectionTitle({ children, sub }) {
  return (
    <div className="cc-section-title">
      <h2>{children}</h2>
      {sub && <p>{sub}</p>}
    </div>
  );
}
function Chip({ active, onClick, children }) {
  return (
    <button type="button" className={`cc-chip ${active ? "active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

/* ---------------- Dashboard ---------------- */
function Dashboard({ stats, alerts, clearWindow, onStartedToday, onEndToday, ongoingPeriod, onOpenEvents }) {
  const predicted = stats.predictedStart;
  return (
    <div className="cc-view">
      <Card className="dial-card">
        <MoonDial stats={stats} />
        <div className="dial-legend">
          <span><i style={{ background: PALETTE.menstrual }} /> Menstrual</span>
          <span><i style={{ background: PALETTE.follicular }} /> Follicular</span>
          <span><i style={{ background: PALETTE.ovulation }} /> Ovulation</span>
          <span><i style={{ background: PALETTE.luteal }} /> Luteal</span>
        </div>
      </Card>

      <Card>
        <SectionTitle sub={predicted ? "Confidence-based, not a fixed date" : "Add your first period to see this"}>
          Predicted next period
        </SectionTitle>
        {predicted ? (
          <div className="predict-range">
            <div className="predict-band">
              <span className="swatch" style={{ background: PALETTE.bandLight }} />
              {fmtShort(addDays(predicted, -stats.bands.b3))} – {fmtShort(addDays(predicted, stats.bands.b3))}
              <em>possible window</em>
            </div>
            <div className="predict-band">
              <span className="swatch" style={{ background: PALETTE.bandDark }} />
              {fmtShort(addDays(predicted, -stats.bands.b1))} – {fmtShort(addDays(predicted, stats.bands.b1))}
              <em>most likely</em>
            </div>
          </div>
        ) : (
          <p className="muted">No cycle history yet — log a period to get an estimate.</p>
        )}
      </Card>

      <Card>
        <div className="quicklog-row">
          {ongoingPeriod ? (
            <button className="cc-btn primary" onClick={onEndToday}>
              <Check size={16} /> End period today
            </button>
          ) : (
            <button className="cc-btn primary" onClick={onStartedToday}>
              <Droplets size={16} /> Started today
            </button>
          )}
        </div>
      </Card>

      <Card>
        <div className="alert-header">
          <SectionTitle>Festival &amp; event window</SectionTitle>
          <button className="cc-iconbtn" onClick={onOpenEvents} aria-label="Manage events">
            <Settings2 size={17} />
          </button>
        </div>
        {clearWindow && (
          <div className="clear-badge">
            <Sparkles size={15} /> Clear window ahead — nothing on your list overlaps the predicted range
          </div>
        )}
        {!clearWindow && alerts.length === 0 && (
          <p className="muted">Add festivals or personal dates to see overlap alerts here.</p>
        )}
        {alerts.map((a) => (
          <div key={a.id} className={`alert-row tier-${a.tier}`}>
            <PartyPopper size={16} />
            <div>
              <strong>{a.name}</strong> overlaps your predicted window
              <span className="muted"> · {fmtLong(parseISO(a.date))}</span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ---------------- Log period ---------------- */
function LogView({ events, onAddPeriod }) {
  const [mode, setMode] = useState("exact");
  const [start, setStart] = useState(toISO(todayMidnight()));
  const [end, setEnd] = useState("");
  const [anchorEvent, setAnchorEvent] = useState("");

  useEffect(() => {
    if (mode === "approximate" && anchorEvent) {
      const ev = events.find((e) => e.id === anchorEvent);
      if (ev) setStart(ev.date);
    }
  }, [anchorEvent, mode, events]);

  const submit = (e) => {
    e.preventDefault();
    onAddPeriod({
      id: uid(),
      startDate: start,
      endDate: end || null,
      exact: mode === "exact",
      note: mode === "approximate" && anchorEvent ? `Anchored to ${events.find((ev) => ev.id === anchorEvent)?.name || ""}` : "",
    });
    setEnd("");
    setAnchorEvent("");
  };

  return (
    <div className="cc-view">
      <Card>
        <SectionTitle sub="Exact dates sharpen predictions; approximate ones still count.">Log a period</SectionTitle>
        <div className="mode-toggle">
          <button type="button" className={mode === "exact" ? "active" : ""} onClick={() => setMode("exact")}>
            Exact date
          </button>
          <button type="button" className={mode === "approximate" ? "active" : ""} onClick={() => setMode("approximate")}>
            Approximate
          </button>
        </div>

        <form onSubmit={submit} className="cc-form">
          {mode === "approximate" && (
            <label className="cc-field">
              <span>Anchor to an event (optional)</span>
              <select value={anchorEvent} onChange={(e) => setAnchorEvent(e.target.value)}>
                <option value="">— pick a date manually instead —</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} ({fmtShort(parseISO(ev.date))})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="cc-field">
            <span>Start date{mode === "approximate" ? " (best guess)" : ""}</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label className="cc-field">
            <span>End date (optional)</span>
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </label>
          <button type="submit" className="cc-btn primary full">
            <Plus size={16} /> Save entry
          </button>
        </form>
      </Card>
    </div>
  );
}

/* ---------------- History ---------------- */
function HistoryView({ stats, data, onPrint }) {
  const { sorted } = stats;
  const lengths = [];
  for (let i = 1; i < sorted.length; i++) {
    lengths.push(daysBetween(parseISO(sorted[i - 1].startDate), parseISO(sorted[i].startDate)));
  }
  const maxLen = Math.max(28, ...lengths, 1);

  return (
    <div className="cc-view">
      <Card>
        <SectionTitle sub="Save your records to look at or share with a doctor">Export report</SectionTitle>
        <div className="export-row">
          <button
            className="cc-btn primary"
            onClick={() => downloadText("cyclecare-report.txt", buildReportText(data, stats))}
          >
            <Download size={16} /> Download report
          </button>
          <button className="cc-btn secondary" onClick={onPrint}>
            <Printer size={16} /> Print / Save as PDF
          </button>
        </div>
      </Card>

      <Card>
        <SectionTitle sub="Length between the start of each logged period">Cycle length trend</SectionTitle>
        {lengths.length === 0 ? (
          <p className="muted">Log at least two periods to see a trend chart.</p>
        ) : (
          <div className="bar-chart">
            {lengths.map((l, i) => (
              <div className="bar-col" key={i}>
                <div className="bar" style={{ height: `${(l / maxLen) * 100}%` }} />
                <span>{l}d</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>Past entries</SectionTitle>
        {sorted.length === 0 && <p className="muted">Nothing logged yet.</p>}
        <ul className="history-list">
          {[...sorted].reverse().map((p) => (
            <li key={p.id}>
              <span className={`tag ${p.exact ? "exact" : "estimated"}`}>{p.exact ? "Exact" : "Estimated"}</span>
              <div>
                <strong>
                  {fmtShort(parseISO(p.startDate))}
                  {p.endDate ? ` – ${fmtShort(parseISO(p.endDate))}` : ""}
                </strong>
                {p.note && <p className="muted small">{p.note}</p>}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ---------------- Symptoms & notes ---------------- */
function CareView({ symptoms, onAddSymptom }) {
  const [date, setDate] = useState(toISO(todayMidnight()));
  const [tags, setTags] = useState([]);
  const [note, setNote] = useState("");

  const toggleTag = (id) => {
    setTags((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  };

  const submit = (e) => {
    e.preventDefault();
    if (tags.length === 0 && !note.trim()) return;
    onAddSymptom({ id: uid(), date, tags, note: note.trim() });
    setTags([]);
    setNote("");
  };

  return (
    <div className="cc-view">
      <Card>
        <SectionTitle sub="Tap what applies, add a note if you want to remember more.">Symptoms &amp; notes</SectionTitle>
        <form onSubmit={submit} className="cc-form">
          <label className="cc-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="tag-grid">
            {SYMPTOM_TAGS.map((t) => (
              <Chip key={t.id} active={tags.includes(t.id)} onClick={() => toggleTag(t.id)}>
                <span className="tag-icon" aria-hidden="true">{t.icon}</span> {t.label}
              </Chip>
            ))}
          </div>
          <label className="cc-field">
            <span>Note</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Anything worth remembering…" />
          </label>
          <button type="submit" className="cc-btn primary full">
            <Plus size={16} /> Save
          </button>
        </form>
      </Card>

      <Card>
        <SectionTitle>Recent entries</SectionTitle>
        {symptoms.length === 0 && <p className="muted">No entries yet.</p>}
        <ul className="history-list">
          {[...symptoms]
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .map((s) => (
              <li key={s.id}>
                <span className="tag exact">{fmtShort(parseISO(s.date))}</span>
                <div>
                  {s.tags.length > 0 && (
                    <p className="tag-line">
                      {s.tags.map((tid) => SYMPTOM_TAGS.find((t) => t.id === tid)?.label).filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {s.note && <p className="muted small">{s.note}</p>}
                </div>
              </li>
            ))}
        </ul>
      </Card>
    </div>
  );
}

/* ---------------- Learn / Awareness ---------------- */
function LearnView() {
  return (
    <div className="cc-view">
      <Card>
        <SectionTitle>PCOD &amp; PCOS awareness</SectionTitle>
        <p>
          PCOD (Polycystic Ovarian Disease) and PCOS (Polycystic Ovary Syndrome) are related hormonal
          conditions that can affect ovulation and menstrual regularity. They're common, and manageable
          with the right guidance — this section is here to help you recognise patterns worth discussing
          with a professional, not to replace one.
        </p>
      </Card>
      <Card>
        <h3 className="cc-subhead"><Leaf size={16} /> Signs some people notice</h3>
        <ul className="plain-list">
          <li>Irregular, infrequent, or unpredictable periods</li>
          <li>Heavier or lighter bleeding than usual</li>
          <li>Acne, excess hair growth, or hair thinning</li>
          <li>Weight changes that feel hard to explain</li>
          <li>Persistent fatigue or mood changes around the cycle</li>
        </ul>
      </Card>
      <Card>
        <h3 className="cc-subhead"><Sun size={16} /> When to talk to a doctor</h3>
        <p>
          If your cycles are consistently irregular, painful, or paired with several of the signs above,
          it's worth bringing your logged history to a gynaecologist or GP — the patterns you've tracked
          here can make that conversation easier.
        </p>
      </Card>
      <Card className="disclaimer-card">
        <Info size={16} />
        <p>
          CycleCare is intended for tracking and educational purposes only. Nothing in this app is a
          medical diagnosis or a substitute for professional medical advice.
        </p>
      </Card>
    </div>
  );
}

/* ---------------- report text ---------------- */
function buildReportText(data, stats) {
  const lines = [];
  lines.push("CycleCare — Cycle Report");
  lines.push(`Generated ${fmtLong(todayMidnight())}`);
  lines.push("");
  lines.push("SUMMARY");
  lines.push(`Average cycle length: ${stats.avgCycle} days`);
  lines.push(`Average period length: ${stats.avgPeriod} days`);
  if (stats.phase) lines.push(`Current phase: ${stats.phase} (day ${stats.cycleDayRaw})`);
  if (stats.predictedStart) {
    lines.push(
      `Predicted next period: ${fmtLong(addDays(stats.predictedStart, -stats.bands.b1))} – ${fmtLong(
        addDays(stats.predictedStart, stats.bands.b1)
      )} (most likely), widening to ${fmtLong(addDays(stats.predictedStart, -stats.bands.b3))} – ${fmtLong(
        addDays(stats.predictedStart, stats.bands.b3)
      )} (possible)`
    );
  }
  lines.push("");
  lines.push("PERIOD HISTORY");
  if (data.periods.length === 0) {
    lines.push("No periods logged yet.");
  } else {
    [...data.periods]
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))
      .forEach((p) => {
        const range = p.endDate ? `${p.startDate} to ${p.endDate}` : `${p.startDate} (ongoing/no end logged)`;
        lines.push(`- ${range} — ${p.exact ? "exact" : "estimated"}${p.note ? ` — ${p.note}` : ""}`);
      });
  }
  lines.push("");
  lines.push("SYMPTOMS & NOTES");
  if (data.symptoms.length === 0) {
    lines.push("No symptom entries logged yet.");
  } else {
    [...data.symptoms]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .forEach((s) => {
        const tagNames = s.tags.map((tid) => SYMPTOM_TAGS.find((t) => t.id === tid)?.label).filter(Boolean).join(", ");
        lines.push(`- ${s.date}${tagNames ? ` — ${tagNames}` : ""}${s.note ? ` — ${s.note}` : ""}`);
      });
  }
  lines.push("");
  lines.push(
    "This report is for personal tracking and educational purposes only. It is not a medical diagnosis and does not replace professional medical advice."
  );
  return lines.join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------- Help / guide modal ---------------- */
const GUIDE_STEPS = [
  {
    title: "Dashboard",
    body: "The Moon Dial shows where you are in your cycle right now, and the pink bands mark your predicted next period — darker means more likely, lighter means still possible.",
  },
  {
    title: "Log",
    body: "Add a period here. Use \"Exact date\" if you know it, or \"Approximate\" if you're going off memory — you can even anchor it to a festival or event.",
  },
  {
    title: "History",
    body: "See how your cycle length has trended over time, review past entries, and export or print a report of your data.",
  },
  {
    title: "Care",
    body: "Log symptoms with quick tags and jot down notes tied to a date.",
  },
  {
    title: "Learn",
    body: "Basic PCOD/PCOS awareness information — not a diagnosis, just a starting point for a conversation with a doctor if something feels off.",
  },
];

function HelpModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="cc-modal-backdrop" onClick={onClose}>
      <div className="cc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cc-modal-head">
          <h2>How CycleCare works</h2>
          <button className="cc-iconbtn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="guide-list">
          {GUIDE_STEPS.map((s) => (
            <div key={s.title} className="guide-step">
              <h3 className="cc-subhead">{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
        <button className="cc-btn primary full" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}

/* ---------------- Manage events modal ---------------- */
function EventsModal({ open, onClose, customEvents, onAdd, onRemove, hiddenFestivals, onToggleFestival }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(toISO(todayMidnight()));

  if (!open) return null;

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ id: uid(), name: name.trim(), date, category: "personal" });
    setName("");
  };

  return (
    <div className="cc-modal-backdrop" onClick={onClose}>
      <div className="cc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cc-modal-head">
          <h2>Manage events</h2>
          <button className="cc-iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <h3 className="cc-subhead">Add a personal date</h3>
        <form onSubmit={submit} className="cc-form">
          <label className="cc-field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Exam, trip, wedding…" />
          </label>
          <label className="cc-field">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button type="submit" className="cc-btn primary full"><Plus size={16} /> Add</button>
        </form>

        {customEvents.length > 0 && (
          <>
            <h3 className="cc-subhead">Your personal dates</h3>
            <ul className="history-list">
              {customEvents.map((ev) => (
                <li key={ev.id}>
                  <span className="tag exact">{fmtShort(parseISO(ev.date))}</span>
                  <div className="event-row"><span>{ev.name}</span>
                    <button className="cc-iconbtn small" onClick={() => onRemove(ev.id)} aria-label="Remove"><X size={14} /></button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 className="cc-subhead">Festivals (offline sample data)</h3>
        <ul className="history-list">
          {FESTIVALS.map((f) => (
            <li key={f.id}>
              <span className="tag">{fmtShort(parseISO(f.date))}</span>
              <div className="event-row">
                <span className={hiddenFestivals.includes(f.id) ? "muted" : ""}>{f.name}</span>
                <button className="cc-chip small" onClick={() => onToggleFestival(f.id)}>
                  {hiddenFestivals.includes(f.id) ? "Hidden" : "Included"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------------- App shell ---------------- */
const TABS = [
  { id: "dashboard", label: "Dashboard", icon: Moon },
  { id: "log", label: "Log", icon: CalendarDays },
  { id: "history", label: "History", icon: Activity },
  { id: "care", label: "Care", icon: CloudMoon },
  { id: "learn", label: "Learn", icon: BookOpen },
];

const DEFAULT_DATA = {
  profile: { avgCycleLength: 28, avgPeriodLength: 5 },
  periods: [],
  symptoms: [],
  customEvents: [],
  hiddenFestivals: [],
  guideSeen: false,
};

export default function App() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [eventsOpen, setEventsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      setData(raw ? JSON.parse(raw) : DEFAULT_DATA);
    } catch {
      setData(DEFAULT_DATA);
    } finally {
      setLoaded(true);
    }
  }, []);

  const persist = useCallback((next) => {
    setData(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* best-effort */
    }
  }, []);

  if (!loaded || !data) {
    return (
      <div className="cc-root loading">
        <Moon size={28} className="spin" />
        <span>Loading CycleCare…</span>
        <Styles />
      </div>
    );
  }

  return (
    <Loaded
      data={data}
      persist={persist}
      tab={tab}
      setTab={setTab}
      eventsOpen={eventsOpen}
      setEventsOpen={setEventsOpen}
      helpOpen={helpOpen}
      setHelpOpen={setHelpOpen}
    />
  );
}

function Loaded({ data, persist, tab, setTab, eventsOpen, setEventsOpen, helpOpen, setHelpOpen }) {
  const stats = useCycleStats(data.periods, data.profile);

  useEffect(() => {
    if (!data.guideSeen) setHelpOpen(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const closeHelp = () => {
    setHelpOpen(false);
    if (!data.guideSeen) persist({ ...data, guideSeen: true });
  };

  const handlePrint = () => window.print();

  const allEvents = useMemo(() => {
    const fests = FESTIVALS.filter((f) => !data.hiddenFestivals.includes(f.id));
    return [...fests, ...data.customEvents].sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [data.hiddenFestivals, data.customEvents]);

  const alerts = useMemo(() => {
    if (!stats.predictedStart) return [];
    const lo = addDays(stats.predictedStart, -stats.bands.b3);
    const hi = addDays(stats.predictedStart, stats.bands.b3);
    return allEvents
      .filter((ev) => {
        const d = parseISO(ev.date);
        return d >= lo && d <= hi;
      })
      .map((ev) => {
        const d = parseISO(ev.date);
        const dist = Math.abs(daysBetween(stats.predictedStart, d));
        const tier = dist <= stats.bands.b1 ? "high" : dist <= stats.bands.b2 ? "medium" : "low";
        return { ...ev, tier };
      });
  }, [allEvents, stats]);

  const clearWindow = !!stats.predictedStart && alerts.length === 0;
  const ongoingPeriod = stats.lastPeriod && !stats.lastPeriod.endDate ? stats.lastPeriod : null;

  const addPeriod = (entry) => {
    persist({ ...data, periods: [...data.periods, entry] });
    setTab("dashboard");
  };
  const startedToday = () => {
    addPeriod({ id: uid(), startDate: toISO(todayMidnight()), endDate: null, exact: true, note: "" });
  };
  const endToday = () => {
    if (!ongoingPeriod) return;
    const periods = data.periods.map((p) =>
      p.id === ongoingPeriod.id ? { ...p, endDate: toISO(todayMidnight()) } : p
    );
    persist({ ...data, periods });
  };
  const addSymptom = (entry) => persist({ ...data, symptoms: [...data.symptoms, entry] });
  const addEvent = (ev) => persist({ ...data, customEvents: [...data.customEvents, ev] });
  const removeEvent = (id) => persist({ ...data, customEvents: data.customEvents.filter((e) => e.id !== id) });
  const toggleFestival = (id) =>
    persist({
      ...data,
      hiddenFestivals: data.hiddenFestivals.includes(id)
        ? data.hiddenFestivals.filter((x) => x !== id)
        : [...data.hiddenFestivals, id],
    });

  return (
    <div className="cc-root">
      <Styles />
      <header className="cc-header no-print">
        <div className="brand">
          <Moon size={20} />
          <span>CycleCare</span>
        </div>
        <button className="cc-iconbtn" onClick={() => setHelpOpen(true)} aria-label="How to use CycleCare">
          <HelpCircle size={18} />
        </button>
      </header>

      <main className="cc-main">
        {tab === "dashboard" && (
          <Dashboard
            stats={stats}
            alerts={alerts}
            clearWindow={clearWindow}
            onStartedToday={startedToday}
            onEndToday={endToday}
            ongoingPeriod={ongoingPeriod}
            onOpenEvents={() => setEventsOpen(true)}
          />
        )}
        {tab === "log" && <LogView events={allEvents} onAddPeriod={addPeriod} />}
        {tab === "history" && <HistoryView stats={stats} data={data} onPrint={handlePrint} />}
        {tab === "care" && <CareView symptoms={data.symptoms} onAddSymptom={addSymptom} />}
        {tab === "learn" && <LearnView />}
      </main>

      <nav className="cc-nav no-print">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              <Icon size={19} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      <pre className="print-only">{buildReportText(data, stats)}</pre>

      <HelpModal open={helpOpen} onClose={closeHelp} />

      <EventsModal
        open={eventsOpen}
        onClose={() => setEventsOpen(false)}
        customEvents={data.customEvents}
        onAdd={addEvent}
        onRemove={removeEvent}
        hiddenFestivals={data.hiddenFestivals}
        onToggleFestival={toggleFestival}
      />
    </div>
  );
}

/* ---------------- styles ---------------- */
function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=Sora:wght@400;500;600;700&display=swap');

      :root {
        --bg: #241420;
        --surface: #331E2C;
        --surface-2: #3F2536;
        --border: #4A2E3F;
        --text: #F6ECEF;
        --text-muted: #C7A8B7;
        --rose-light: ${PALETTE.bandLight};
        --rose-mid: ${PALETTE.bandMid};
        --rose-dark: ${PALETTE.bandDark};
        --gold: ${PALETTE.ovulation};
        --success: #7FB88F;
      }
      * { box-sizing: border-box; }
      .cc-root {
        font-family: 'Sora', sans-serif;
        background: var(--bg);
        color: var(--text);
        min-height: 100vh;
        max-width: 480px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        position: relative;
      }
      .cc-root.loading {
        align-items: center;
        justify-content: center;
        gap: 10px;
        min-height: 400px;
        color: var(--text-muted);
      }
      .spin { animation: spin 1.8s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }

      .cc-header {
        padding: 18px 20px 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: 'Fraunces', serif;
        font-style: italic;
        font-weight: 600;
        font-size: 22px;
        letter-spacing: 0.2px;
      }

      .cc-main {
        flex: 1;
        padding: 4px 16px 90px;
        overflow-y: auto;
      }
      .cc-view { display: flex; flex-direction: column; gap: 14px; }

      .cc-card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 18px;
      }
      .disclaimer-card {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        color: var(--text-muted);
        font-size: 13px;
        background: var(--surface-2);
      }
      .disclaimer-card p { margin: 0; }

      .dial-card { display: flex; flex-direction: column; align-items: center; gap: 10px; }
      .dial-svg { width: 100%; max-width: 260px; }
      .dial-daylabel { font-family: 'Fraunces', serif; font-size: 30px; fill: var(--text); }
      .dial-phaselabel { font-size: 12px; fill: var(--text-muted); letter-spacing: 0.5px; text-transform: uppercase; }
      .dial-legend { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; font-size: 12px; color: var(--text-muted); }
      .dial-legend span { display: flex; align-items: center; gap: 5px; }
      .dial-legend i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }

      .cc-section-title h2 {
        font-family: 'Fraunces', serif;
        font-weight: 600;
        font-size: 17px;
        margin: 0 0 2px;
      }
      .cc-section-title p { margin: 0 0 10px; font-size: 12.5px; color: var(--text-muted); }

      .predict-range { display: flex; flex-direction: column; gap: 8px; }
      .predict-band { display: flex; align-items: center; gap: 8px; font-size: 14px; }
      .predict-band em { color: var(--text-muted); font-style: normal; font-size: 12px; margin-left: auto; }
      .swatch { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }

      .quicklog-row { display: flex; }
      .cc-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 7px;
        border: none; border-radius: 999px; padding: 12px 18px;
        font-family: 'Sora', sans-serif; font-weight: 600; font-size: 14px;
        cursor: pointer;
      }
      .cc-btn.primary { background: var(--rose-dark); color: #fff; }
      .cc-btn.secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
      .cc-btn.full { width: 100%; }
      .export-row { display: flex; flex-wrap: wrap; gap: 10px; }
      .export-row .cc-btn { flex: 1; min-width: 140px; }

      .guide-list { display: flex; flex-direction: column; gap: 14px; margin-bottom: 16px; }
      .guide-step p { margin: 0; font-size: 13.5px; color: var(--text-muted); }

      .print-only { display: none; }
      @media print {
        .no-print, .cc-main { display: none !important; }
        .print-only {
          display: block;
          white-space: pre-wrap;
          font-family: 'Sora', sans-serif;
          color: #000;
          padding: 20px;
        }
        .cc-root { background: #fff; color: #000; max-width: none; }
      }

      .alert-header { display: flex; align-items: flex-start; justify-content: space-between; }
      .cc-iconbtn {
        background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
        border-radius: 10px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
        cursor: pointer;
      }
      .cc-iconbtn.small { width: 24px; height: 24px; }

      .clear-badge {
        display: flex; align-items: center; gap: 8px;
        background: rgba(127,184,143,0.15); color: var(--success);
        border-radius: 12px; padding: 10px 12px; font-size: 13px;
      }
      .alert-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; font-size: 13.5px; border-top: 1px solid var(--border); }
      .alert-row:first-of-type { border-top: none; }
      .alert-row.tier-high { color: var(--rose-dark); }
      .alert-row.tier-medium { color: var(--rose-mid); }
      .alert-row.tier-low { color: var(--text-muted); }
      .muted { color: var(--text-muted); }
      .muted.small { font-size: 12px; margin: 2px 0 0; }

      .mode-toggle { display: flex; background: var(--surface-2); border-radius: 999px; padding: 4px; margin-bottom: 14px; }
      .mode-toggle button {
        flex: 1; background: none; border: none; color: var(--text-muted); padding: 9px; border-radius: 999px;
        font-family: 'Sora', sans-serif; font-weight: 600; font-size: 13px; cursor: pointer;
      }
      .mode-toggle button.active { background: var(--rose-dark); color: #fff; }

      .cc-form { display: flex; flex-direction: column; gap: 12px; }
      .cc-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-muted); }
      .cc-field input, .cc-field select, .cc-field textarea {
        background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
        border-radius: 10px; padding: 10px 12px; font-family: 'Sora', sans-serif; font-size: 14px;
      }
      .cc-field textarea { resize: vertical; }

      .tag-grid { display: flex; flex-wrap: wrap; gap: 8px; }
      .cc-chip {
        background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted);
        border-radius: 999px; padding: 8px 12px; font-size: 12.5px; cursor: pointer;
        display: inline-flex; align-items: center; gap: 5px; font-family: 'Sora', sans-serif;
      }
      .cc-chip.active { background: var(--rose-dark); border-color: var(--rose-dark); color: #fff; }
      .cc-chip.small { padding: 5px 9px; font-size: 11px; }
      .tag-icon { font-size: 13px; }

      .bar-chart { display: flex; align-items: flex-end; gap: 8px; height: 120px; padding-top: 8px; }
      .bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 4px; }
      .bar { width: 100%; max-width: 26px; background: linear-gradient(180deg, var(--rose-mid), var(--rose-dark)); border-radius: 6px 6px 2px 2px; min-height: 4px; }
      .bar-col span { font-size: 10.5px; color: var(--text-muted); }

      .history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
      .history-list li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--border); font-size: 13.5px; }
      .history-list li:first-child { border-top: none; }
      .event-row { display: flex; align-items: center; justify-content: space-between; flex: 1; gap: 8px; }
      .tag { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--surface-2); color: var(--text-muted); flex-shrink: 0; }
      .tag.exact { background: rgba(194,58,99,0.25); color: var(--rose-dark); }
      .tag.estimated { background: rgba(217,169,78,0.2); color: var(--gold); }
      .tag-line { margin: 0; font-size: 12.5px; color: var(--text); }

      .cc-subhead { display: flex; align-items: center; gap: 7px; font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; margin: 4px 0 8px; }
      .plain-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; }

      .cc-nav {
        position: sticky; bottom: 0; left: 0; right: 0;
        display: flex; background: var(--surface); border-top: 1px solid var(--border);
        padding: 8px 4px calc(8px + env(safe-area-inset-bottom, 0px));
      }
      .cc-nav button {
        flex: 1; background: none; border: none; color: var(--text-muted);
        display: flex; flex-direction: column; align-items: center; gap: 3px;
        font-family: 'Sora', sans-serif; font-size: 10.5px; padding: 5px 0; cursor: pointer;
      }
      .cc-nav button.active { color: var(--rose-dark); }

      .cc-modal-backdrop {
        position: fixed; inset: 0; background: rgba(0,0,0,0.55);
        display: flex; align-items: flex-end; justify-content: center; z-index: 20;
      }
      .cc-modal {
        background: var(--bg); border: 1px solid var(--border); border-radius: 20px 20px 0 0;
        width: 100%; max-width: 480px; max-height: 85vh; overflow-y: auto; padding: 20px;
      }
      .cc-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .cc-modal-head h2 { font-family: 'Fraunces', serif; font-size: 19px; margin: 0; }

      @media (prefers-reduced-motion: reduce) {
        .spin { animation: none; }
      }
    `}</style>
  );
}
