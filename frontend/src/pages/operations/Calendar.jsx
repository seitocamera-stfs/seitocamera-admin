import { useState, useMemo } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Package, ListTodo,
  User, Loader2,
} from 'lucide-react';
import { useApiGet } from '../../hooks/useApi';

// ===========================================
// Constants
// ===========================================

const STATUS_COLORS = {
  PENDING_PREP: 'bg-gray-200',
  IN_PREPARATION: 'bg-blue-300',
  PENDING_TECH_REVIEW: 'bg-amber-300',
  PENDING_FINAL_CHECK: 'bg-orange-300',
  READY: 'bg-green-300',
  PENDING_LOAD: 'bg-teal-300',
  OUT: 'bg-indigo-400 text-white',
  RETURNED: 'bg-purple-300',
  RETURN_REVIEW: 'bg-yellow-300',
  WITH_INCIDENT: 'bg-red-300',
  EQUIPMENT_BLOCKED: 'bg-red-400 text-white',
  CLOSED: 'bg-gray-300',
};

const DAY_NAMES = ['Dl', 'Dt', 'Dc', 'Dj', 'Dv', 'Ds', 'Dg'];
const MONTH_NAMES = [
  'Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny',
  'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre',
];

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ===========================================
// Component principal
// ===========================================

export default function Calendar() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-based

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

  // Construir la graella del calendari
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysInMonth = lastDay.getDate();

    // Dia de la setmana del primer dia (0=diumenge, 1=dilluns...)
    let startDow = firstDay.getDay();
    // Convertir a dilluns=0
    startDow = startDow === 0 ? 6 : startDow - 1;

    const days = [];
    // Dies buits al principi
    for (let i = 0; i < startDow; i++) {
      days.push(null);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(d);
    }
    return days;
  }, [year, month]);

  // Indexar projectes i tasques per dia
  const { projectsByDay, tasksByDay } = useMemo(() => {
    const pByDay = {};
    const tByDay = {};

    if (data?.projects) {
      data.projects.forEach((p) => {
        // Rang complet: des de checkDate (o departureDate) fins returnDate
        const start = new Date(p.checkDate || p.departureDate);
        const end = new Date(p.returnDate);
        for (let d = 1; d <= 31; d++) {
          const dayDate = new Date(year, month - 1, d);
          if (dayDate.getMonth() !== month - 1) break;
          if (dayDate >= new Date(start.getFullYear(), start.getMonth(), start.getDate()) &&
              dayDate <= new Date(end.getFullYear(), end.getMonth(), end.getDate())) {
            if (!pByDay[d]) pByDay[d] = [];
            pByDay[d].push(p);
          }
        }
      });
    }

    if (data?.tasks) {
      data.tasks.forEach((t) => {
        if (!t.dueAt) return;
        const d = new Date(t.dueAt).getDate();
        if (!tByDay[d]) tByDay[d] = [];
        tByDay[d].push(t);
      });
    }

    return { projectsByDay: pByDay, tasksByDay: tByDay };
  }, [data, year, month]);

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
          {/* Graella del calendari */}
          <div className="bg-card border rounded-lg overflow-hidden">
            {/* Capçalera dies */}
            <div className="grid grid-cols-7 border-b">
              {DAY_NAMES.map((d) => (
                <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2 border-r last:border-r-0">
                  {d}
                </div>
              ))}
            </div>

            {/* Dies */}
            <div className="grid grid-cols-7">
              {calendarDays.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} className="min-h-[100px] border-r border-b bg-muted/20" />;
                }

                const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const isToday = dayStr === todayStr;
                const dayProjects = projectsByDay[day] || [];
                const dayTasks = tasksByDay[day] || [];

                return (
                  <div
                    key={day}
                    className={`min-h-[100px] border-r border-b p-1 ${isToday ? 'bg-blue-50/50' : ''}`}
                  >
                    <div className={`text-xs font-medium mb-1 ${isToday ? 'bg-primary text-primary-foreground w-6 h-6 rounded-full flex items-center justify-center' : 'text-muted-foreground px-1'}`}>
                      {day}
                    </div>

                    {/* Projectes del dia */}
                    <div className="space-y-0.5">
                      {dayProjects.slice(0, 3).map((p) => {
                        const checkDt = p.checkDate ? new Date(p.checkDate) : null;
                        const depDate = new Date(p.departureDate);
                        const shootEnd = p.shootEndDate ? new Date(p.shootEndDate) : null;
                        const retDate = new Date(p.returnDate);

                        const isCheck = checkDt && checkDt.getDate() === day && checkDt.getMonth() === month - 1;
                        const isDep = depDate.getDate() === day && depDate.getMonth() === month - 1;
                        const isRet = retDate.getDate() === day && retDate.getMonth() === month - 1;

                        let marker = '';
                        if (isCheck) marker = '🔧 ';
                        else if (isDep) marker = '→ ';
                        else if (isRet) marker = '← ';

                        return (
                          <div
                            key={p.id}
                            className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate ${STATUS_COLORS[p.status] || 'bg-gray-200'}`}
                            title={`${p.name}${p.clientName ? ` — ${p.clientName}` : ''}${isCheck ? ' (Check)' : isDep ? ' (Rodatge)' : isRet ? ' (Devolució)' : ''}`}
                          >
                            {marker}
                            {p.name}
                          </div>
                        );
                      })}
                      {dayProjects.length > 3 && (
                        <div className="text-[9px] text-muted-foreground px-1">+{dayProjects.length - 3} més</div>
                      )}
                    </div>

                    {/* Tasques del dia */}
                    {dayTasks.length > 0 && (
                      <div className="mt-0.5 space-y-0.5">
                        {dayTasks.slice(0, 2).map((t) => (
                          <div
                            key={t.id}
                            className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate border ${
                              t.status === 'OP_DONE'
                                ? 'bg-green-50 border-green-200 text-green-700 line-through'
                                : 'bg-amber-50 border-amber-200 text-amber-800'
                            }`}
                            title={`Tasca: ${t.title}${t.assignedTo ? ` — ${t.assignedTo.name}` : ''}`}
                          >
                            {t.title}
                          </div>
                        ))}
                        {dayTasks.length > 2 && (
                          <div className="text-[9px] text-muted-foreground px-1">+{dayTasks.length - 2} tasques</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Llegenda */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">🔧 Check</span>
            <span className="flex items-center gap-1"><Package size={12} /> → Rodatge</span>
            <span className="flex items-center gap-1"><Package size={12} /> ← Devolució</span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-blue-300" /> En preparació
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-green-300" /> Preparat
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-indigo-400" /> Sortit
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded border border-amber-200 bg-amber-50" /> Tasca
            </span>
          </div>
        </>
      )}
    </div>
  );
}
