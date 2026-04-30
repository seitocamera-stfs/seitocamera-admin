import { useState, useMemo } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight,
  Loader2, Truck,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';

// ===========================================
// Constants
// ===========================================

const FALLBACK_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#22c55e',
];

const DAY_NAMES = ['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'];
const MONTH_NAMES = [
  'Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny',
  'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre',
];

const BAR_H = 18;
const BAR_GAP = 2;
const BAR_PAD = 2;

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateToDayIdx(dateStr, calendarDays) {
  const d = new Date(dateStr);
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  for (let i = 0; i < calendarDays.length; i++) {
    const cd = calendarDays[i];
    if (cd && cd.day === day && cd.month === month && cd.year === year) return i;
  }
  return -1;
}

/**
 * Distribueix barres en lanes (files) per un rang d'índexos concret.
 */
function assignLanesForRange(bars, rangeStartIdx, rangeEndIdx) {
  const relevant = bars
    .filter((b) => !(b.startIdx > rangeEndIdx || b.endIdx < rangeStartIdx))
    .sort((a, b) => a.startIdx - b.startIdx || (b.endIdx - b.startIdx) - (a.endIdx - a.startIdx));

  const lanes = [];
  const barLane = new Map();

  relevant.forEach((bar) => {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      const overlaps = lanes[i].some((b) => {
        const bStart = Math.max(b.startIdx, rangeStartIdx);
        const bEnd = Math.min(b.endIdx, rangeEndIdx);
        const barStart = Math.max(bar.startIdx, rangeStartIdx);
        const barEnd = Math.min(bar.endIdx, rangeEndIdx);
        return !(barStart > bEnd || barEnd < bStart);
      });
      if (!overlaps) {
        lanes[i].push(bar);
        barLane.set(bar.id, i);
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.push([bar]);
      barLane.set(bar.id, lanes.length - 1);
    }
  });

  return { barLane, totalLanes: lanes.length };
}

/**
 * Obté el color del projecte basat en el leadUser o primer assignat.
 */
function getProjectColor(project, fallbackIdx) {
  // Prioritat: leadUser.color → primer assignat amb color → fallback
  if (project.leadUser?.color) return project.leadUser.color;
  if (project.assignments?.length > 0) {
    const withColor = project.assignments.find(a => a.user?.color);
    if (withColor) return withColor.user.color;
  }
  return FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length];
}

// ===========================================
// Component principal
// ===========================================

export default function Calendar() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const { data, loading } = useApiGet(`/operations/calendar/${year}/${month}`);

  const changeMonth = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setMonth(m);
    setYear(y);
  };

  const goToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
  };

  const daysInMonth = new Date(year, month, 0).getDate();

  // Primer dia de la setmana (dl=0)
  const firstDow = useMemo(() => {
    const dow = new Date(year, month - 1, 1).getDay();
    return dow === 0 ? 6 : dow - 1;
  }, [year, month]);

  // Construir calendarDays: dies del mes anterior (padding) + mes actual + dies del mes següent (padding)
  const calendarDays = useMemo(() => {
    const days = [];

    // Padding inici: dies del mes anterior
    if (firstDow > 0) {
      const prevMonthDays = new Date(year, month - 1, 0).getDate();
      const prevMonth = month - 2; // 0-based
      const prevYear = prevMonth < 0 ? year - 1 : year;
      const actualPrevMonth = prevMonth < 0 ? 11 : prevMonth;
      for (let i = firstDow - 1; i >= 0; i--) {
        days.push({ day: prevMonthDays - i, month: actualPrevMonth, year: prevYear, isCurrentMonth: false });
      }
    }

    // Dies del mes actual
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, month: month - 1, year, isCurrentMonth: true });
    }

    // Padding final: dies del mes següent fins completar files de 7
    const remaining = days.length % 7;
    if (remaining > 0) {
      const nextMonth = month; // 0-based
      const nextYear = nextMonth > 11 ? year + 1 : year;
      const actualNextMonth = nextMonth > 11 ? 0 : nextMonth;
      const toFill = 7 - remaining;
      for (let d = 1; d <= toFill; d++) {
        days.push({ day: d, month: actualNextMonth, year: nextYear, isCurrentMonth: false });
      }
    }

    return days;
  }, [firstDow, daysInMonth, year, month]);

  const totalRows = Math.ceil(calendarDays.length / 7);

  // Preparar barres, tasques i transports
  const { projectBars, tasksByIdx, transportsByIdx } = useMemo(() => {
    const bars = [];
    const tByIdx = {};
    const trByIdx = {};

    if (data?.projects) {
      data.projects.forEach((p, idx) => {
        const startIdx = dateToDayIdx(p.checkDate || p.departureDate, calendarDays);
        const endIdx = dateToDayIdx(p.returnDate, calendarDays);
        if (startIdx === -1 || endIdx === -1 || startIdx > endIdx) return;

        bars.push({
          ...p,
          startIdx,
          endIdx,
          color: getProjectColor(p, idx),
        });
      });
    }

    if (data?.tasks) {
      data.tasks.forEach((t) => {
        if (!t.dueAt) return;
        const idx = dateToDayIdx(t.dueAt, calendarDays);
        if (idx === -1) return;
        if (!tByIdx[idx]) tByIdx[idx] = [];
        tByIdx[idx].push(t);
      });
    }

    if (data?.transports) {
      data.transports.forEach((tr) => {
        // Mostrar al dia de càrrega
        if (tr.dataCarrega) {
          const idx = dateToDayIdx(tr.dataCarrega, calendarDays);
          if (idx !== -1) {
            if (!trByIdx[idx]) trByIdx[idx] = [];
            trByIdx[idx].push({ ...tr, displayType: 'carrega' });
          }
        }
        // Si data entrega diferent, mostrar també
        if (tr.dataEntrega && tr.dataEntrega !== tr.dataCarrega) {
          const idx = dateToDayIdx(tr.dataEntrega, calendarDays);
          if (idx !== -1) {
            if (!trByIdx[idx]) trByIdx[idx] = [];
            trByIdx[idx].push({ ...tr, displayType: 'entrega' });
          }
        }
      });
    }

    return { projectBars: bars, tasksByIdx: tByIdx, transportsByIdx: trByIdx };
  }, [data, calendarDays]);

  // Calcular lanes per fila
  const rowLaneData = useMemo(() => {
    return Array.from({ length: totalRows }).map((_, rowIdx) => {
      const rowStart = rowIdx * 7;
      const rowEnd = rowStart + 6;

      const { barLane, totalLanes } = assignLanesForRange(projectBars, rowStart, rowEnd);
      return { barLane, totalLanes, rowStart, rowEnd };
    });
  }, [projectBars, totalRows]);

  const todayStr = toDateStr(today);

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      {/* Capçalera */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarDays size={28} className="text-primary" />
          <h1 className="text-2xl font-bold">Calendari</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => changeMonth(-1)} className="p-2 rounded-md hover:bg-accent">
            <ChevronLeft size={20} />
          </button>
          <button onClick={goToday} className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
            Avui
          </button>
          <button onClick={() => changeMonth(1)} className="p-2 rounded-md hover:bg-accent">
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-center capitalize">
        {MONTH_NAMES[month - 1]} {year}
      </h2>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-primary" size={32} />
        </div>
      ) : (
        <>
          <div className="bg-card border rounded-lg overflow-hidden">
            {/* Capçalera dies */}
            <div className="grid grid-cols-7 border-b">
              {DAY_NAMES.map((d) => (
                <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2 border-r last:border-r-0">
                  {d}
                </div>
              ))}
            </div>

            {/* Files del calendari */}
            {rowLaneData.map(({ barLane, totalLanes, rowStart, rowEnd }, rowIdx) => {
              const barsHeight = totalLanes > 0
                ? totalLanes * (BAR_H + BAR_GAP) + BAR_PAD
                : 8;

              const rowDays = calendarDays.slice(rowStart, rowStart + 7);
              const hasRowTasks = rowDays.some((_, colIdx) => tasksByIdx[rowStart + colIdx]);
              const hasRowTransports = rowDays.some((_, colIdx) => transportsByIdx[rowStart + colIdx]);

              return (
                <div key={rowIdx}>
                  {/* Números de dia */}
                  <div className="grid grid-cols-7">
                    {rowDays.map((cd, colIdx) => {
                      const globalIdx = rowStart + colIdx;
                      const dayStr = cd ? `${cd.year}-${String(cd.month + 1).padStart(2, '0')}-${String(cd.day).padStart(2, '0')}` : '';
                      const isToday = dayStr === todayStr;
                      return (
                        <div key={globalIdx} className={`h-6 border-r flex items-center px-1 ${!cd?.isCurrentMonth ? 'bg-muted/30' : ''} ${isToday ? 'bg-blue-50' : ''}`}>
                          <span className={`text-xs font-medium ${
                            isToday
                              ? 'bg-primary text-primary-foreground w-5 h-5 rounded-full flex items-center justify-center text-[10px]'
                              : cd?.isCurrentMonth
                                ? 'text-muted-foreground'
                                : 'text-muted-foreground/40'
                          }`}>
                            {cd?.day}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Zona de barres */}
                  <div className="relative" style={{ height: `${barsHeight}px` }}>
                    <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
                      {rowDays.map((cd, colIdx) => (
                        <div key={colIdx} className={`border-r ${!cd?.isCurrentMonth ? 'bg-muted/30' : ''}`} />
                      ))}
                    </div>

                    {projectBars.map((bar) => {
                      const laneIdx = barLane.get(bar.id);
                      if (laneIdx === undefined) return null;

                      const barRowStart = Math.max(bar.startIdx, rowStart);
                      const barRowEnd = Math.min(bar.endIdx, rowEnd);
                      if (barRowStart > barRowEnd) return null;

                      const startColIdx = barRowStart - rowStart;
                      const endColIdx = barRowEnd - rowStart;

                      const leftPct = (startColIdx / 7) * 100;
                      const widthPct = ((endColIdx - startColIdx + 1) / 7) * 100;

                      const isStart = bar.startIdx >= rowStart && bar.startIdx <= rowEnd;
                      const isEnd = bar.endIdx >= rowStart && bar.endIdx <= rowEnd;

                      return (
                        <div
                          key={`${bar.id}-${rowIdx}`}
                          className="absolute overflow-hidden cursor-default"
                          style={{
                            left: `calc(${leftPct}% + 2px)`,
                            width: `calc(${widthPct}% - 4px)`,
                            top: `${laneIdx * (BAR_H + BAR_GAP) + BAR_PAD}px`,
                            height: `${BAR_H}px`,
                            backgroundColor: bar.color,
                            borderRadius: isStart && isEnd ? '4px'
                              : isStart ? '4px 0 0 4px'
                              : isEnd ? '0 4px 4px 0'
                              : '0',
                            opacity: 0.9,
                          }}
                          title={`${bar.name}${bar.clientName ? ` — ${bar.clientName}` : ''}${bar.leadUser?.name ? ` (${bar.leadUser.name})` : ''}`}
                        >
                          <span
                            className="text-[9px] text-white font-medium px-1.5 whitespace-nowrap block truncate drop-shadow-sm"
                            style={{ lineHeight: `${BAR_H}px` }}
                          >
                            {isStart ? bar.name : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Tasques */}
                  {hasRowTasks && (
                    <div className="grid grid-cols-7">
                      {rowDays.map((cd, colIdx) => {
                        const globalIdx = rowStart + colIdx;
                        const tasks = tasksByIdx[globalIdx];
                        if (!tasks) {
                          return <div key={`t-${globalIdx}`} className={`border-r min-h-0 ${!cd?.isCurrentMonth ? 'bg-muted/30' : ''}`} />;
                        }
                        return (
                          <div key={`t-${globalIdx}`} className={`border-r px-0.5 pb-0.5 ${!cd?.isCurrentMonth ? 'bg-muted/30' : ''}`}>
                            {tasks.map((t) => (
                              <div
                                key={t.id}
                                className={`text-[8px] leading-tight px-1 py-0.5 rounded truncate border mb-0.5 ${
                                  t.status === 'OP_DONE'
                                    ? 'bg-green-50 border-green-200 text-green-700 line-through'
                                    : 'bg-amber-50 border-amber-200 text-amber-800'
                                }`}
                                title={`Tasca: ${t.title}${t.assignedTo ? ` — ${t.assignedTo.name}` : ''}`}
                              >
                                {t.title}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Transports */}
                  {hasRowTransports && (
                    <div className="grid grid-cols-7">
                      {rowDays.map((cd, colIdx) => {
                        const globalIdx = rowStart + colIdx;
                        const transports = transportsByIdx[globalIdx];
                        if (!transports) {
                          return <div key={`tr-${globalIdx}`} className={`border-r min-h-0 ${!cd?.isCurrentMonth ? 'bg-muted/30' : ''}`} />;
                        }
                        return (
                          <div key={`tr-${globalIdx}`} className={`border-r px-0.5 pb-0.5 ${!cd?.isCurrentMonth ? 'bg-muted/30' : ''}`}>
                            {transports.map((tr, i) => (
                              <div
                                key={`${tr.id}-${tr.displayType}-${i}`}
                                className="text-[8px] leading-tight px-1 py-0.5 rounded truncate border mb-0.5 bg-sky-50 border-sky-200 text-sky-800 flex items-center gap-0.5"
                                title={`${tr.displayType === 'entrega' ? 'Entrega' : 'Càrrega'}: ${tr.projecte || 'Transport'}${tr.origen ? ` — ${tr.origen}` : ''}${tr.desti ? ` → ${tr.desti}` : ''}${tr.horaRecollida ? ` (${tr.horaRecollida})` : ''}`}
                              >
                                <Truck size={7} className="shrink-0" />
                                <span className="truncate">
                                  {tr.horaRecollida ? `${tr.horaRecollida} ` : ''}{tr.conductor?.nom ? `${tr.conductor.nom} — ` : ''}{tr.projecte || tr.desti || 'Transport'}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Separador */}
                  <div className="grid grid-cols-7">
                    {rowDays.map((_, colIdx) => (
                      <div key={`sep-${colIdx}`} className="border-r border-b h-0" />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Llegenda */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            {projectBars.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap">
                {projectBars.map((bar) => (
                  <span key={bar.id} className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded" style={{ backgroundColor: bar.color }} />
                    {bar.name}
                    {bar.leadUser?.name && <span className="text-muted-foreground/60">({bar.leadUser.name})</span>}
                  </span>
                ))}
              </div>
            )}
            {data?.transports?.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-sky-200 border border-sky-300" />
                Transports
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
