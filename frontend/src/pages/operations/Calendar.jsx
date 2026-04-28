import { useState, useMemo } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight,
  Loader2,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';

// ===========================================
// Constants
// ===========================================

const PROJECT_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#e11d48', '#0ea5e9', '#a855f7', '#22c55e',
];

const DAY_NAMES = ['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'];
const MONTH_NAMES = [
  'Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny',
  'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre',
];

const BAR_H = 18;  // px per barra
const BAR_GAP = 2; // px entre barres
const BAR_PAD = 2; // px padding superior

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateToDayNum(dateStr, year, month) {
  const d = new Date(dateStr);
  if (d.getFullYear() < year || (d.getFullYear() === year && d.getMonth() < month - 1)) return 0;
  if (d.getFullYear() > year || (d.getFullYear() === year && d.getMonth() > month - 1)) return 32;
  return d.getDate();
}

/**
 * Distribueix barres en lanes (files) per un rang de dies concret.
 * Retorna un Map<barId, laneIndex> i el nombre total de lanes.
 */
function assignLanesForRange(bars, rangeStart, rangeEnd) {
  // Filtrar barres que toquen aquest rang
  const relevant = bars
    .filter((b) => !(b.startDay > rangeEnd || b.endDay < rangeStart))
    .sort((a, b) => a.startDay - b.startDay || (b.endDay - b.startDay) - (a.endDay - a.startDay));

  const lanes = []; // Array d'arrays: cada lane conté barres sense solapament
  const barLane = new Map();

  relevant.forEach((bar) => {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      const overlaps = lanes[i].some((b) => {
        const bStart = Math.max(b.startDay, rangeStart);
        const bEnd = Math.min(b.endDay, rangeEnd);
        const barStart = Math.max(bar.startDay, rangeStart);
        const barEnd = Math.min(bar.endDay, rangeEnd);
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

  const firstDow = useMemo(() => {
    const dow = new Date(year, month - 1, 1).getDay();
    return dow === 0 ? 6 : dow - 1;
  }, [year, month]);

  const calendarDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < firstDow; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    return days;
  }, [firstDow, daysInMonth]);

  const totalRows = Math.ceil(calendarDays.length / 7);

  // Preparar barres i tasques
  const { projectBars, tasksByDay } = useMemo(() => {
    const bars = [];
    const tByDay = {};

    if (data?.projects) {
      data.projects.forEach((p, idx) => {
        const startDay = Math.max(1, dateToDayNum(p.checkDate || p.departureDate, year, month));
        const endDay = Math.min(daysInMonth, dateToDayNum(p.returnDate, year, month));
        if (startDay > daysInMonth || endDay < 1) return;

        bars.push({
          ...p,
          startDay: Math.max(startDay, 1),
          endDay: Math.min(endDay, daysInMonth),
          color: PROJECT_COLORS[idx % PROJECT_COLORS.length],
        });
      });
    }

    if (data?.tasks) {
      data.tasks.forEach((t) => {
        if (!t.dueAt) return;
        const td = new Date(t.dueAt);
        if (td.getMonth() !== month - 1 || td.getFullYear() !== year) return;
        const d = td.getDate();
        if (!tByDay[d]) tByDay[d] = [];
        tByDay[d].push(t);
      });
    }

    return { projectBars: bars, tasksByDay: tByDay };
  }, [data, year, month, daysInMonth]);

  // Calcular lanes per fila (independent per cada setmana)
  const rowLaneData = useMemo(() => {
    return Array.from({ length: totalRows }).map((_, rowIdx) => {
      const rowStart = rowIdx * 7;
      const rowDays = calendarDays.slice(rowStart, rowStart + 7);
      const rowFirstDay = rowDays.find((d) => d !== null) || 0;
      const rowLastDay = [...rowDays].reverse().find((d) => d !== null) || 0;

      if (rowFirstDay === 0) return { barLane: new Map(), totalLanes: 0, rowFirstDay, rowLastDay, rowDays };

      const { barLane, totalLanes } = assignLanesForRange(projectBars, rowFirstDay, rowLastDay);
      return { barLane, totalLanes, rowFirstDay, rowLastDay, rowDays };
    });
  }, [projectBars, calendarDays, totalRows]);

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
            {rowLaneData.map(({ barLane, totalLanes, rowFirstDay, rowLastDay, rowDays }, rowIdx) => {
              // Altura de la zona de barres: adaptada al nombre de lanes d'aquesta fila
              const barsHeight = totalLanes > 0
                ? totalLanes * (BAR_H + BAR_GAP) + BAR_PAD
                : 8; // mínim si no hi ha barres

              // Comprovar si hi ha tasques en aquesta fila
              const hasRowTasks = rowDays.some((d) => d && tasksByDay[d]);

              return (
                <div key={rowIdx}>
                  {/* Números de dia */}
                  <div className="grid grid-cols-7">
                    {rowDays.map((day, colIdx) => {
                      if (day === null) {
                        return <div key={`empty-${rowIdx}-${colIdx}`} className="h-6 border-r bg-muted/20" />;
                      }
                      const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const isToday = dayStr === todayStr;
                      return (
                        <div key={day} className={`h-6 border-r flex items-center px-1 ${isToday ? 'bg-blue-50' : ''}`}>
                          <span className={`text-xs font-medium ${isToday ? 'bg-primary text-primary-foreground w-5 h-5 rounded-full flex items-center justify-center text-[10px]' : 'text-muted-foreground'}`}>
                            {day}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Zona de barres — altura dinàmica per fila */}
                  <div className="relative" style={{ height: `${barsHeight}px` }}>
                    {/* Línies verticals */}
                    <div className="absolute inset-0 grid grid-cols-7 pointer-events-none">
                      {rowDays.map((day, colIdx) => (
                        <div key={colIdx} className={`border-r ${day === null ? 'bg-muted/20' : ''}`} />
                      ))}
                    </div>

                    {/* Barres dels projectes */}
                    {projectBars.map((bar) => {
                      const laneIdx = barLane.get(bar.id);
                      if (laneIdx === undefined) return null;

                      const barRowStart = Math.max(bar.startDay, rowFirstDay);
                      const barRowEnd = Math.min(bar.endDay, rowLastDay);
                      if (barRowStart > barRowEnd) return null;

                      const startColIdx = rowDays.indexOf(barRowStart);
                      const endColIdx = rowDays.indexOf(barRowEnd);
                      if (startColIdx === -1 || endColIdx === -1) return null;

                      const leftPct = (startColIdx / 7) * 100;
                      const widthPct = ((endColIdx - startColIdx + 1) / 7) * 100;

                      const isStart = bar.startDay >= rowFirstDay && bar.startDay <= rowLastDay;
                      const isEnd = bar.endDay >= rowFirstDay && bar.endDay <= rowLastDay;

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
                          title={`${bar.name}${bar.clientName ? ` — ${bar.clientName}` : ''}`}
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
                      {rowDays.map((day, colIdx) => {
                        if (!day || !tasksByDay[day]) {
                          return <div key={`t-${rowIdx}-${colIdx}`} className="border-r min-h-0" />;
                        }
                        return (
                          <div key={`t-${rowIdx}-${colIdx}`} className="border-r px-0.5 pb-0.5">
                            {tasksByDay[day].map((t) => (
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

                  {/* Separador de fila */}
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
          {projectBars.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              {projectBars.map((bar) => (
                <span key={bar.id} className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: bar.color }} />
                  {bar.name}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
