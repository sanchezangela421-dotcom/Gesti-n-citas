import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
    Clock, CalendarCheck, CheckCircle2, Users, FileText, Megaphone,
    CalendarDays, Info, RefreshCw, Pencil, Trash2, Calendar,
    Video, Plus, MapPin,
    ClipboardList, ArrowRight, Lock, History, XCircle,
} from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useStore } from "../../../context/StoreContext";
import { AppShell } from "../../components/layout/AppShell";
import { Btn, StatCard, Modal, MiniCalendar, StatusBadge, inputCls, EmptyState, Reveal } from "../../components/ui";
import { DAYS_FULL } from "../../../constants";
import { useReschedule, useActionModal } from "../../hooks";
import { localISODate } from "../../../utils/date";
import { API, authHeaders } from "../../../lib/api";
import { PatientRecords } from "./PatientRecords";
import { ContentTab } from "./ContentTab";
import { EventTab } from "./EventTab";
import type { Appointment, OrgLocation } from "../../../types";

// Referencia estable para el fallback de schedule (evita un array nuevo por render)
const EMPTY_SCHEDULE: never[] = [];

// ─── Schedule slot management hook ───────────────────────
function useScheduleSlots(specId: string | undefined, schedule: any[]) {
    const { addScheduleSlot, removeScheduleSlot } = useStore();

    const [show, setShow] = useState(false);
    const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
    const [newDay, setNewDay] = useState<number | string>(1);
    const [newWeek, setNewWeek] = useState<number | string>("date");
    const [newStart, setNewStart] = useState("09:00");
    const [newEnd, setNewEnd] = useState("13:00");
    const [selectedBaseDate, setSelectedBaseDate] = useState<string | undefined>(undefined);

    const openEditSlot = (slot: any) => {
        setEditingSlotId(slot.id);
        setNewDay(slot.dayOfWeek);
        setNewWeek(slot.specificDate ? "date" : "0");
        setNewStart(slot.startTime);
        setNewEnd(slot.endTime);
        setSelectedBaseDate(slot.specificDate || undefined);
        setShow(true);
    };

    const openAddSlot = (day: number, week: number, dateStr: string) => {
        setEditingSlotId(null);
        setNewDay(day);
        setNewWeek("date");
        setNewStart("09:00");
        setNewEnd("13:00");
        setSelectedBaseDate(dateStr);
        setShow(true);
    };

    const save = () => {
        if (!specId) return;

        // ── "Esta semana": reparte el horario a los días hábiles (Lun-Vie) de la
        //    semana del día seleccionado, creando slots de FECHA ESPECÍFICA.
        //    (Antes se guardaban con week=0, marca relativa a "hoy" que hacía que
        //    reaparecieran todas las semanas para siempre.) ──
        if (newWeek === "0") {
            const todayM = new Date(); todayM.setHours(0, 0, 0, 0);
            // Semana ancla: la del día clickeado en el calendario (actual o próxima)
            const base = selectedBaseDate ? new Date(selectedBaseDate + "T12:00:00") : new Date(todayM);
            base.setHours(0, 0, 0, 0);
            const dayShift = base.getDay() === 0 ? 1 : 1 - base.getDay();
            const mondayOfWeek = new Date(base);
            mondayOfWeek.setDate(base.getDate() + dayShift);

            const daysToCreate: { dow: number; iso: string }[] = [];
            for (let i = 0; i < 5; i++) {
                const dayDate = new Date(mondayOfWeek);
                dayDate.setDate(mondayOfWeek.getDate() + i);
                if (dayDate < todayM) continue; // saltar días ya pasados de la semana
                const dow = i + 1; // 1=Lun … 5=Vie
                const isoForDay = localISODate(dayDate);
                const hasOverlap = schedule.some(s => {
                    if (editingSlotId && s.id === editingSlotId) return false; // ignorar el que se edita
                    return (
                        s.dayOfWeek === dow &&
                        (s.specificDate === isoForDay ||
                         (s.specificDate === null && s.week === null)) &&
                        newStart < s.endTime && newEnd > s.startTime
                    );
                });
                if (!hasOverlap) daysToCreate.push({ dow, iso: isoForDay });
            }

            if (daysToCreate.length === 0) {
                toast.error("Ya existe un horario solapado en todos los días disponibles de esta semana.");
                return;
            }

            if (editingSlotId) removeScheduleSlot(specId, editingSlotId);
            daysToCreate.forEach(({ dow, iso }) =>
                addScheduleSlot(specId, {
                    dayOfWeek: dow,
                    startTime: newStart,
                    endTime: newEnd,
                    available: true,
                    week: undefined,
                    specificDate: iso, // anclado a fecha: no "renace" en semanas futuras
                })
            );

            setShow(false); setEditingSlotId(null);
            toast.success(`${daysToCreate.length} horario${daysToCreate.length === 1 ? "" : "s"} para esta semana`);
            return;
        }

        // ── "Solo este día": un único slot de fecha específica ──
        const dayInt = parseInt(String(newDay));
        if (!selectedBaseDate) { toast.error("Selecciona primero el día en el calendario."); return; }

        // Solapes: contra slots de la misma fecha o recurrentes semanales (week null)
        const hasOverlap = schedule.some(s => {
            if (editingSlotId && s.id === editingSlotId) return false;
            return (
                s.dayOfWeek === dayInt &&
                (s.specificDate === selectedBaseDate ||
                 (s.specificDate === null && s.week === null)) &&
                newStart < s.endTime && newEnd > s.startTime
            );
        });

        if (hasOverlap) { toast.error("Ya existe un horario solapado para este rango."); return; }

        const wasEditing = !!editingSlotId;
        if (editingSlotId) removeScheduleSlot(specId, editingSlotId);

        addScheduleSlot(specId, {
            dayOfWeek: dayInt,
            startTime: newStart,
            endTime: newEnd,
            available: true,
            week: undefined,
            specificDate: selectedBaseDate,
        });
        setShow(false); setEditingSlotId(null);
        toast.success(wasEditing ? "Horario actualizado" : "Horario agregado");
    };

    return {
        show, setShow, editingSlotId, newDay, setNewDay,
        newWeek, setNewWeek, newStart, setNewStart, newEnd, setNewEnd,
        selectedBaseDate, openEditSlot, openAddSlot, save,
        removeSlot: (id: string) => { if (specId) { removeScheduleSlot(specId, id); toast.success("Horario eliminado"); } },
    };
}

// ─── Component ───────────────────────────────────────────
export function SpecialistDashboard() {
    const { user } = useAuth();
    const { specialists, specialistsLoaded, getAppointments, getAvailableDays, getAvailableSlots, createAppointment, addNotification, updateMeetingUrl, updateSpecialistLocation, activePeriod } = useStore();

    const [orgLocations, setOrgLocations] = useState<OrgLocation[]>([]);
    useEffect(() => {
        fetch(`${API}/locations`, { headers: authHeaders() })
            .then(r => (r.ok ? r.json() : []))
            .then(setOrgLocations)
            .catch(() => { });
    }, []);

    const spec = useMemo(() => specialists.find(s => s.userId === user?.id), [specialists, user?.id]);
    const dept = user?.department || "Psicología";

    const [activeTab, setActiveTab] = useState("calendar");
    const [meetingUrlInput, setMeetingUrlInput] = useState(spec?.meetingUrl ?? "");
    const [virtualConfirmAppt, setVirtualConfirmAppt] = useState<Appointment | null>(null);
    const [virtualConfirmUrl, setVirtualConfirmUrl] = useState("");
    const [presencialConfirmAppt, setPresencialConfirmAppt] = useState<Appointment | null>(null);
    const [presencialConfirmLocationId, setPresencialConfirmLocationId] = useState("");

    const allAppts = useMemo(
        () => (spec ? getAppointments({ specialistId: spec.id }) : []),
        [spec, getAppointments]
    );
    // Medianoche de hoy — se fija una vez por montaje (estable para deps de useMemo).
    const todayMidnight = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

    // Buckets de citas en UNA sola pasada (antes: 5 .filter()/Set por render).
    const { sinCerrar, pendientes, confirmadas, completadas, totalPatients } = useMemo(() => {
        const sinCerrar: Appointment[] = [], pendientes: Appointment[] = [];
        const confirmadas: Appointment[] = [], completadas: Appointment[] = [];
        const patients = new Set<string>();
        for (const a of allAppts) {
            patients.add(a.studentName);
            const isPast = new Date(a.date + "T12:00:00") < todayMidnight;
            // Pasadas y aún abiertas (Pendiente o Confirmada) → requieren cierre
            if ((a.status === "Pendiente" || a.status === "Confirmada") && isPast) sinCerrar.push(a);
            // Pendientes solo de hoy en adelante
            if (a.status === "Pendiente" && !isPast) pendientes.push(a);
            if (a.status === "Confirmada") confirmadas.push(a);
            if (a.status === "Completada") completadas.push(a);
        }
        return { sinCerrar, pendientes, confirmadas, completadas, totalPatients: patients.size };
    }, [allAppts, todayMidnight]);

    // Calendar tab state
    const [selDate, setSelDate] = useState(new Date());
    const apptDates = useMemo(
        () => [...new Set(allAppts.filter(a => a.status !== "Cancelada").map(a => a.date))]
            .map(d => new Date(d + "T12:00:00"))
            .filter(d => d >= todayMidnight),
        [allAppts, todayMidnight]
    );
    const dayAppts = useMemo(
        () => allAppts.filter(a => a.date === localISODate(selDate) && a.status !== "Cancelada"),
        [allAppts, selDate]
    );

    // Historial: citas raíz (Completada/Cancelada sin parentId), orden desc por fecha.
    const historialAppts = useMemo(
        () => allAppts
            .filter(a => (a.status === "Completada" || a.status === "Cancelada") && !a.parentId)
            .sort((a, b) => b.date.localeCompare(a.date)),
        [allAppts]
    );
    // Mapa parentId → citas de seguimiento (cualquier estado).
    const followUpsByParent = useMemo(
        () => allAppts.reduce((acc, a) => {
            if (a.parentId) {
                if (!acc[a.parentId]) acc[a.parentId] = [];
                acc[a.parentId].push(a);
            }
            return acc;
        }, {} as Record<string, typeof allAppts>),
        [allAppts]
    );

    // Hooks
    const action = useActionModal();
    const resch = useReschedule("specialist");
    const slots = useScheduleSlots(spec?.id, spec?.schedule ?? EMPTY_SCHEDULE);

    // ── Direct confirm (no modal) ───────────────────────────────
    const { updateAppointmentStatus } = useStore();
    const handleConfirmDirect = (appt: Appointment) => {
        if (appt.modality === "Virtual") {
            setVirtualConfirmAppt(appt);
            setVirtualConfirmUrl(spec?.meetingUrl ?? "");
        } else if (appt.modality === "Presencial" && orgLocations.length > 0) {
            setPresencialConfirmAppt(appt);
            setPresencialConfirmLocationId(spec?.locationId ?? (orgLocations[0]?.id ?? ""));
        } else {
            updateAppointmentStatus(appt.id, "Confirmada", undefined);
            toast.success("Cita confirmada");
        }
    };

    const handleConfirmPresencial = () => {
        if (!presencialConfirmAppt) return;
        updateAppointmentStatus(presencialConfirmAppt.id, "Confirmada", undefined, false, undefined, presencialConfirmLocationId || undefined);
        toast.success("Cita presencial confirmada");
        setPresencialConfirmAppt(null);
        setPresencialConfirmLocationId("");
    };

    const handleConfirmVirtual = async () => {
        if (!virtualConfirmAppt || !spec) return;
        if (!virtualConfirmUrl.trim()) {
            toast.error("Agrega el enlace de videollamada antes de confirmar.");
            return;
        }
        updateAppointmentStatus(virtualConfirmAppt.id, "Confirmada", undefined, false, virtualConfirmUrl.trim());
        toast.success("Cita virtual confirmada");
        setVirtualConfirmAppt(null);
        setVirtualConfirmUrl("");
    };

    // ── Seguimiento (new follow-up appointment) ───────────────
    const [seguimientoAppt, setSeguimientoAppt] = useState<Appointment | null>(null);
    const [seguimientoDate, setSeguimientoDate] = useState<Date | null>(null);
    const [seguimientoSlot, setSeguimientoSlot] = useState<string | null>(null);
    const [seguimientoAvailDates, setSeguimientoAvailDates] = useState<Date[]>([]);
    const [seguimientoSlots, setSeguimientoSlots] = useState<{ start: string; end: string }[]>([]);

    useEffect(() => {
        if (!seguimientoAppt || !spec) { setSeguimientoAvailDates([]); return; }
        const now = new Date();
        getAvailableDays(spec.id, now.getFullYear(), now.getMonth()).then(setSeguimientoAvailDates);
    }, [seguimientoAppt]);

    useEffect(() => {
        if (!seguimientoDate || !spec) { setSeguimientoSlots([]); return; }
        getAvailableSlots(spec.id, localISODate(seguimientoDate)).then(setSeguimientoSlots);
    }, [seguimientoDate]);

    const openSeguimiento = (appt: Appointment) => {
        setSeguimientoAppt(appt);
        setSeguimientoDate(null);
        setSeguimientoSlot(null);
    };

    const confirmSeguimiento = () => {
        if (!seguimientoAppt || !seguimientoDate || !seguimientoSlot || !user) return;
        // Strip any previous "Seguimiento:" prefix to avoid nesting prefixes
        const baseMotivo = seguimientoAppt.motivo.replace(/^Seguimiento:\s*/i, "");
        void createAppointment({
            studentId: seguimientoAppt.studentId,
            studentName: seguimientoAppt.studentName,
            specialistId: seguimientoAppt.specialistId,
            department: seguimientoAppt.department,
            motivo: baseMotivo,
            modality: seguimientoAppt.modality,
            preferredDate: localISODate(seguimientoDate),
            preferredTime: seguimientoSlot,
            isFollowUp: true,
            parentId: seguimientoAppt.parentId ?? seguimientoAppt.id,
        });
        // Notify the student about the follow-up appointment
        addNotification(seguimientoAppt.studentId, {
            title: "Cita de seguimiento agendada",
            message: `Tu especialista ${spec?.name} ha agendado una cita de seguimiento para el ${seguimientoDate.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })} a las ${seguimientoSlot}. Revisa tu panel de citas.`,
            type: "confirmed",
        });
        toast.success(`Cita de seguimiento agendada para ${seguimientoAppt.studentName}`);
        setSeguimientoAppt(null);
        setSeguimientoDate(null);
        setSeguimientoSlot(null);
    };

    // Historial pagination
    const [historialSpecPage, setHistorialSpecPage] = useState(0);

    // Loading states
    if (!specialistsLoaded) return (
        <div className="flex flex-col items-center justify-center min-h-[50vh]">
            <div className="w-12 h-12 rounded-full border-4 border-blue-600 border-t-transparent animate-spin mb-4" />
            <p className="text-slate-500 font-medium">Cargando perfil...</p>
        </div>
    );

    if (!user || !spec) return (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Users className="w-8 h-8 text-slate-400" />
            </div>
            <p className="text-slate-500 font-medium">No se encontró perfil de especialista.</p>
        </div>
    );

    const endUserLabel = user.organization?.userRoleLabel ?? "Usuario";
    const endUserTabLabel = `${endUserLabel}s`;

    const statsData = [
        { label: "Pendientes", value: pendientes.length, icon: Clock, gradient: "from-amber-500 to-amber-600" },
        { label: "Confirmadas", value: confirmadas.length, icon: CalendarCheck, gradient: "from-blue-600 to-indigo-600" },
        { label: "Completadas", value: completadas.length, icon: CheckCircle2, gradient: "from-emerald-500 to-emerald-600" },
        { label: endUserTabLabel, value: totalPatients, icon: Users, gradient: "from-violet-500 to-violet-600" },
    ];

    // Paginación del historial (historialAppts y followUpsByParent ya memoizados arriba)
    const HISTORIAL_SPEC_PAGE_SIZE = 10;
    const historialSpecTotalPages = Math.ceil(historialAppts.length / HISTORIAL_SPEC_PAGE_SIZE);
    const pagedHistorialAppts = historialAppts.slice(
        historialSpecPage * HISTORIAL_SPEC_PAGE_SIZE,
        (historialSpecPage + 1) * HISTORIAL_SPEC_PAGE_SIZE
    );

    const sidebarTabs = [
        { key: "calendar", label: "Mi Calendario", icon: CalendarDays },
        { key: "historial", label: "Historial", icon: History },
        { key: "expedientes", label: "Expedientes", icon: ClipboardList },
        { key: "schedules", label: "Mis Horarios", icon: Clock },
        { key: "content", label: "Publicar Contenido", icon: FileText },
        { key: "event", label: "Publicar Evento", icon: Megaphone },
    ];

    return (
        <AppShell sidebar={{ tabs: sidebarTabs, active: activeTab, onSelect: setActiveTab, badges: { calendar: pendientes.length + sinCerrar.length } }}>
            <div className="space-y-8 max-w-7xl mx-auto w-full pb-12">

                {/* Header */}
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Panel de {dept}</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1 font-medium">{spec.name} — Gestión de citas y agenda</p>
                </div>

                {/* Inactivo: explica por qué dejaron de llegar solicitudes, en lugar
                    de que el especialista lo interprete como una falla del sistema. */}
                {!spec.active && (
                    <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                        <Info className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                        <div className="text-sm">
                            <p className="font-bold text-slate-800 dark:text-slate-100">Tu perfil está marcado como inactivo</p>
                            <p className="text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                                No estás recibiendo solicitudes nuevas y no apareces en la agenda de los usuarios.
                                Puedes seguir atendiendo y cerrando tus citas actuales. Si crees que es un error,
                                contacta al administrador de tu organización.
                            </p>
                        </div>
                    </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {statsData.map((s, i) => <StatCard key={s.label} index={i} {...s} />)}
                </div>

                {/* Contenido por pestaña — fade-up en cada cambio (key=activeTab) */}
                <Reveal key={activeTab} className="space-y-8">
                {/* Expedientes Tab */}
                {activeTab === "expedientes" && (
                    <PatientRecords mySpecialistId={spec.id} endUserLabel={endUserLabel} />
                )}

                {/* Calendar Tab */}
                {activeTab === "calendar" && (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-1">
                            <MiniCalendar selectedDate={selDate} onSelect={setSelDate} highlightedDates={apptDates} />
                        </div>
                        <div className="lg:col-span-2 space-y-5">
                            <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                                Citas — {selDate.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
                            </h3>

                            {/* Citas pasadas sin cerrar */}
                            {sinCerrar.length > 0 && (
                                <div className="rounded-2xl border border-rose-200 dark:border-rose-900/50 overflow-hidden">
                                    <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-900/50">
                                        <span className="flex h-2 w-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                                        <p className="text-xs font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">
                                            Requieren cierre — {sinCerrar.length} {sinCerrar.length === 1 ? "cita" : "citas"}
                                        </p>
                                    </div>
                                    <div className="p-3 bg-rose-50/60 dark:bg-rose-950/20 text-xs text-rose-700 dark:text-rose-400 font-medium border-b border-rose-100 dark:border-rose-900/30">
                                        Estas citas ya pasaron su fecha pero no fueron finalizadas. Por favor complétalas o cancélalas.
                                    </div>
                                    <div className="p-3 space-y-2 bg-white dark:bg-slate-900">
                                        {sinCerrar.map(appt => (
                                            <AppointmentCard key={appt.id} appt={appt} onAction={action.open} onReschedule={() => resch.open(appt.id)} onSeguimiento={openSeguimiento} onConfirmDirect={handleConfirmDirect} />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Pending list — solo citas futuras */}
                            {pendientes.length > 0 && (
                                <div className="rounded-2xl border border-amber-200 dark:border-amber-900/50 overflow-hidden">
                                    <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/50">
                                        <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                                        <p className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                                            Pendientes de confirmación — {pendientes.length} {pendientes.length === 1 ? "cita" : "citas"}
                                        </p>
                                    </div>
                                    <div className="p-3 space-y-2 bg-white dark:bg-slate-900">
                                        {pendientes.map(appt => (
                                            <AppointmentCard key={appt.id} appt={appt} onAction={action.open} onReschedule={() => resch.open(appt.id)} onSeguimiento={openSeguimiento} onConfirmDirect={handleConfirmDirect} />
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Day appointments */}
                            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                                <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                                    <CalendarCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                                    <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                                        Agenda del día — {dayAppts.length > 0 ? `${dayAppts.length} ${dayAppts.length === 1 ? "cita" : "citas"}` : "Sin citas"}
                                    </p>
                                </div>
                                {dayAppts.length > 0 ? (
                                    <div className="p-3 space-y-2 bg-white dark:bg-slate-900">
                                        {dayAppts.map(appt => (
                                            <AppointmentCard key={appt.id} appt={appt} onAction={action.open} onReschedule={() => resch.open(appt.id)} onSeguimiento={openSeguimiento} onConfirmDirect={handleConfirmDirect} />
                                        ))}
                                    </div>
                                ) : (
                                    <EmptyState icon={CalendarCheck} title="Sin citas para este día" />
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Historial Tab */}
                {activeTab === "historial" && (
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Historial de Citas</h3>
                                <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">
                                    {completadas.length} completadas · {allAppts.filter(a => a.status === "Cancelada").length} canceladas
                                    {activePeriod && <span className="ml-2 text-xs font-bold text-blue-500">· {activePeriod.name}</span>}
                                </p>
                            </div>
                        </div>

                        {historialAppts.length === 0 ? (
                            <div className="bg-white dark:bg-slate-800 rounded-3xl border border-dashed border-slate-200 dark:border-slate-700 p-12 text-center">
                                <History className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                                <p className="text-slate-500 dark:text-slate-400 font-medium">Sin historial de citas aún</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {pagedHistorialAppts.map(appt => {
                                    const isLate = appt.status === "Completada" &&
                                        appt.updatedAt &&
                                        appt.updatedAt.split("T")[0] > appt.date;
                                    const apptFollowUps = followUpsByParent[appt.id] ?? [];
                                    // "Activo" = hay un seguimiento ABIERTO; los completados liberan el botón para la siguiente sesión
                                    const hasActiveFollowUp = apptFollowUps.some(f => f.status === "Pendiente" || f.status === "Confirmada");
                                    return (
                                        <div key={appt.id} className="space-y-2">
                                            {/* Root appointment */}
                                            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 flex flex-col sm:flex-row sm:items-start gap-3 opacity-90 hover:opacity-100 hover:shadow-md transition-all">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                        <p className="font-bold text-slate-900 dark:text-white text-sm">{appt.studentName}</p>
                                                        <StatusBadge status={appt.status} />
                                                        {isLate && (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[0.65rem] font-bold border border-amber-200 dark:border-amber-800">
                                                                Sesión tardía
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-slate-500 dark:text-slate-400 text-xs">
                                                        {new Date(appt.date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} — {appt.time}
                                                    </p>
                                                    <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">{appt.modality} · {appt.motivo}</p>
                                                    {appt.status === "Cancelada" && appt.cancellationReason && (
                                                        <div className="mt-2 flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-900/20 rounded-xl border border-rose-100 dark:border-rose-800">
                                                            <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                                                            <div>
                                                                <p className="text-[0.65rem] font-bold text-rose-400 uppercase tracking-wider mb-0.5">Motivo de cancelación</p>
                                                                <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">{appt.cancellationReason}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                {appt.status === "Completada" && (
                                                    hasActiveFollowUp ? (
                                                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-400 border border-slate-200 dark:border-slate-600 shrink-0 self-start">
                                                            <ArrowRight className="w-3.5 h-3.5" /> Seguimiento activo
                                                        </span>
                                                    ) : (
                                                        <button
                                                            onClick={() => openSeguimiento(appt)}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:opacity-80 cursor-pointer shrink-0 self-start bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700"
                                                        >
                                                            <ArrowRight className="w-3.5 h-3.5" /> Seguimiento
                                                        </button>
                                                    )
                                                )}
                                            </div>

                                            {/* Follow-up appointments nested below */}
                                            {apptFollowUps.length > 0 && (
                                                <div className="ml-6 space-y-2 border-l-2 border-indigo-200 dark:border-indigo-700 pl-4">
                                                    {apptFollowUps
                                                        .sort((a, b) => a.date.localeCompare(b.date))
                                                        .map(fu => (
                                                            <div key={fu.id} className="bg-indigo-50/60 dark:bg-indigo-900/10 rounded-xl border border-indigo-100 dark:border-indigo-800 p-3 flex flex-col sm:flex-row sm:items-start gap-3">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[0.65rem] font-bold border border-indigo-200 dark:border-indigo-700">
                                                                            <ArrowRight className="w-2.5 h-2.5" /> Seguimiento
                                                                        </span>
                                                                        <StatusBadge status={fu.status} />
                                                                    </div>
                                                                    <p className="text-slate-500 dark:text-slate-400 text-xs">
                                                                        {new Date(fu.date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} — {fu.time}
                                                                    </p>
                                                                    <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">{fu.modality} · {fu.motivo}</p>
                                                                </div>
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {historialSpecTotalPages > 1 && (
                                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700">
                                        <span className="text-xs text-slate-400 font-medium">
                                            {historialSpecPage * HISTORIAL_SPEC_PAGE_SIZE + 1}–{Math.min((historialSpecPage + 1) * HISTORIAL_SPEC_PAGE_SIZE, historialAppts.length)} de {historialAppts.length}
                                        </span>
                                        <div className="flex gap-1">
                                            <button onClick={() => setHistorialSpecPage(p => Math.max(0, p - 1))} disabled={historialSpecPage === 0}
                                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">← Anterior</button>
                                            {Array.from({ length: historialSpecTotalPages }, (_, i) => (
                                                <button key={i} onClick={() => setHistorialSpecPage(i)}
                                                    className={`w-7 h-7 rounded-lg text-xs font-bold ${i === historialSpecPage ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"}`}>{i + 1}</button>
                                            ))}
                                            <button onClick={() => setHistorialSpecPage(p => Math.min(historialSpecTotalPages - 1, p + 1))} disabled={historialSpecPage === historialSpecTotalPages - 1}
                                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">Siguiente →</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Schedules Tab */}
                {activeTab === "schedules" && (
                    <div>
                        {/* Meeting URL config */}
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 mb-6 shadow-sm">
                            <div className="flex items-center gap-2 mb-3">
                                <Video className="w-4 h-4 text-blue-600" />
                                <h4 className="font-bold text-slate-900 dark:text-white text-sm">Sala permanente de videollamada <span className="font-normal text-slate-400">(opcional)</span></h4>
                            </div>
                            <p className="text-slate-500 text-xs mb-3">Si usas una sala fija de Zoom o Google Meet, guárdala aquí y se pre-llenará al confirmar citas virtuales. Si generas un enlace único por reunión, déjalo vacío y pégalo directamente al confirmar.</p>
                            <div className="flex gap-2">
                                <input
                                    type="url"
                                    value={meetingUrlInput}
                                    onChange={e => setMeetingUrlInput(e.target.value)}
                                    placeholder="https://meet.google.com/xxx-xxxx-xxx"
                                    className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <Btn size="sm" onClick={() => spec && updateMeetingUrl(spec.id, meetingUrlInput || null)}>
                                    Guardar
                                </Btn>
                            </div>
                        </div>

                        {/* Location config — el especialista ELIGE una sede del catálogo de la org (no escribe) */}
                        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 mb-6 shadow-sm">
                            <div className="flex items-center gap-2 mb-3">
                                <MapPin className="w-4 h-4 text-emerald-600" />
                                <h4 className="font-bold text-slate-900 dark:text-white text-sm">Sede de atención presencial <span className="font-normal text-slate-400">(opcional)</span></h4>
                            </div>
                            <p className="text-slate-500 text-xs mb-3">Elige tu sede del catálogo de la organización. Se mostrará al alumno al confirmar citas presenciales.</p>
                            {orgLocations.length === 0 ? (
                                <p className="text-slate-400 text-xs italic">Tu organización aún no tiene sedes registradas. Pide al administrador que las agregue.</p>
                            ) : (
                                <select
                                    value={spec?.locationId ?? ""}
                                    onChange={e => spec && updateSpecialistLocation(spec.id, e.target.value || null)}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                >
                                    <option value="">Sin sede asignada</option>
                                    {orgLocations.map(l => (
                                        <option key={l.id} value={l.id}>{l.name}{l.address ? ` — ${l.address}` : ""}</option>
                                    ))}
                                </select>
                            )}
                        </div>

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                            <div>
                                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Mis Horarios de Atención</h3>
                                <p className="text-slate-500 font-medium mt-1">
                                    Hoy es <span className="text-blue-600 font-bold">
                                        {new Date().toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                                    </span>
                                </p>
                                <p className="text-rose-500 text-xs font-bold mt-2 uppercase tracking-tight flex items-center gap-1.5">
                                    <Info className="w-3.5 h-3.5" /> Se recomienda dar de alta horarios con 1 semana de anticipación.
                                </p>
                            </div>
                            <div className="flex items-center gap-3 px-5 py-3 bg-blue-50 border border-blue-100 rounded-2xl">
                                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0 shadow-sm">
                                    <Plus className="w-4 h-4 text-white" />
                                </div>
                                <p className="text-blue-800 text-sm font-bold leading-tight">
                                    Haz clic en un día del calendario<br />
                                    <span className="text-blue-600 font-black uppercase text-[10px] tracking-widest">Para agregar un Horario</span>
                                </p>
                            </div>
                        </div>

                        {[0, 1].map(weekOffset => {
                            const today = new Date();
                            // If Sunday (0), Monday is tomorrow; otherwise calculate from current day
                            const dayShift = today.getDay() === 0 ? 1 : 1 - today.getDay();
                            const mondayOfCurrentWeek = new Date(today);
                            mondayOfCurrentWeek.setDate(today.getDate() + dayShift + weekOffset * 7);

                            const fridayOfWeek = new Date(mondayOfCurrentWeek);
                            fridayOfWeek.setDate(mondayOfCurrentWeek.getDate() + 4);

                            return (
                                <div key={weekOffset} className={weekOffset === 1 ? "mt-8" : ""}>
                                    {/* Week header */}
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className={`w-2 h-2 rounded-full ${weekOffset === 0 ? "bg-blue-600" : "bg-indigo-500"}`} />
                                        <h4 className="text-slate-700 font-bold text-sm uppercase tracking-wider">
                                            {weekOffset === 0 ? "Semana Actual" : "Próxima Semana"}
                                        </h4>
                                        <span className="text-slate-400 text-xs font-medium">
                                            {mondayOfCurrentWeek.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "")}
                                            {" — "}
                                            {fridayOfWeek.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "")}
                                        </span>
                                    </div>

                                    {/* Day columns */}
                                    <div className="flex overflow-x-auto md:grid md:grid-cols-5 gap-3 sm:gap-4 pb-4 md:pb-0 scroll-smooth snap-x">
                                        {["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"].map((day, i) => {
                                            const dow = i + 1;
                                            const dateObj = new Date(mondayOfCurrentWeek);
                                            dateObj.setDate(mondayOfCurrentWeek.getDate() + i);
                                            const isoDate = localISODate(dateObj);
                                            const dateStr = `${dateObj.getDate()} ${dateObj.toLocaleDateString("es-MX", { month: "short" })}`.replace(".", "");
                                            const isPast = dateObj < new Date(new Date().setHours(0, 0, 0, 0));

                                            const daySlots = spec.schedule.filter((s: any) =>
                                                s.specificDate === isoDate ||
                                                // Recurrentes semanales legacy (week null); los slots de semana
                                                // migraron a specificDate y ya no dependen del weekOffset
                                                (s.specificDate === null && s.dayOfWeek === dow &&
                                                    (s.week === undefined || s.week === null))
                                            );

                                            return (
                                                <div
                                                    key={`${weekOffset}-${day}`}
                                                    onClick={() => !isPast && slots.openAddSlot(dow, weekOffset, isoDate)}
                                                    className={`bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 min-h-[140px] sm:min-h-[160px] shadow-sm flex-shrink-0 w-[210px] sm:w-[240px] md:w-auto snap-start transition-all ${isPast ? "opacity-40" : "cursor-pointer hover:border-blue-400 hover:ring-4 hover:ring-blue-400/5 hover:bg-white"}`}
                                                >
                                                    <div className="flex flex-col mb-3 sm:mb-4">
                                                        <p className="text-slate-900 font-bold uppercase tracking-wider text-[0.6rem] sm:text-xs">{day}</p>
                                                        <p className="text-indigo-600 font-black text-[0.55rem] sm:text-[0.65rem] uppercase">{dateStr}</p>
                                                    </div>

                                                    {daySlots.length > 0 ? (
                                                        <div className="space-y-1.5 sm:space-y-2">
                                                            {daySlots.map((s: any) => (
                                                                <div key={s.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-2 py-1.5 sm:px-3 sm:py-2 shadow-sm group">
                                                                    <span className="text-slate-700 font-bold text-[0.7rem] sm:text-sm tracking-tighter">{s.startTime}–{s.endTime}</span>
                                                                    {!isPast && (
                                                                        <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                                                            <button
                                                                                onClick={e => { e.stopPropagation(); slots.openEditSlot(s); }}
                                                                                className="text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg p-1 transition-colors cursor-pointer"
                                                                            >
                                                                                <Pencil className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                                                            </button>
                                                                            <button
                                                                                onClick={e => { e.stopPropagation(); slots.removeSlot(s.id); }}
                                                                                className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg p-1 transition-colors cursor-pointer"
                                                                            >
                                                                                <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-center justify-center text-center py-2">
                                                            <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-slate-300 mb-1" />
                                                            <p className="text-slate-400 font-medium text-[0.6rem] sm:text-xs">Sin atención</p>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}

                        {/* Add/Edit Slot Modal */}
                        <Modal
                            open={slots.show}
                            onClose={() => { slots.setShow(false); }}
                            title={slots.editingSlotId ? "Editar Horario" : "Agregar Horario"}
                            subtitle={
                                <div className="flex items-center gap-2 text-blue-600 font-bold text-sm mt-1">
                                    <Calendar className="w-4 h-4" />
                                    <span>
                                        {DAYS_FULL[Number(slots.newDay)]}
                                        {slots.selectedBaseDate && ` • ${new Date(slots.selectedBaseDate + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long" })}`}
                                    </span>
                                </div>
                            }
                            maxWidth="max-w-md"
                        >
                            <div className="space-y-5">

                                {/* Day selector — only shown when editing */}
                                {slots.editingSlotId && (
                                    <div>
                                        <label className="block mb-2 text-slate-900 font-bold text-sm">Día de la semana</label>
                                        <select value={slots.newDay} onChange={e => slots.setNewDay(e.target.value)} className={inputCls}>
                                            {[1, 2, 3, 4, 5].map(d => <option key={d} value={d}>{DAYS_FULL[d]}</option>)}
                                        </select>
                                    </div>
                                )}

                                {/* Recurrence selector */}
                                <div>
                                    <label className="block mb-2 text-slate-900 font-bold text-sm">¿Cuándo aplica este horario?</label>
                                    <div className="grid grid-cols-1 gap-2">
                                        {[
                                            {
                                                value: "date",
                                                label: "Solo este día",
                                                desc: `Únicamente el ${slots.selectedBaseDate ? new Date(slots.selectedBaseDate + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }) : "día seleccionado"}`,
                                                color: "blue",
                                            },
                                            {
                                                value: "0",
                                                label: "Toda la semana",
                                                desc: `Añade ${slots.newStart}–${slots.newEnd} a los días hábiles restantes de la semana del día seleccionado`,
                                                color: "indigo",
                                            },
                                        ].map(opt => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => slots.setNewWeek(opt.value)}
                                                className={`flex items-start gap-3 p-3.5 rounded-xl border-2 text-left transition-all cursor-pointer ${slots.newWeek === opt.value
                                                    ? `border-${opt.color}-500 bg-${opt.color}-50`
                                                    : "border-slate-200 bg-white hover:border-slate-300"
                                                    }`}
                                            >
                                                <div className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center transition-all ${slots.newWeek === opt.value
                                                    ? `border-${opt.color}-500 bg-${opt.color}-500`
                                                    : "border-slate-300"
                                                    }`}>
                                                    {slots.newWeek === opt.value && (
                                                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                                                    )}
                                                </div>
                                                <div>
                                                    <p className={`font-bold text-sm ${slots.newWeek === opt.value ? `text-${opt.color}-700` : "text-slate-700"}`}>
                                                        {opt.label}
                                                    </p>
                                                    <p className="text-slate-400 text-xs mt-0.5">{opt.desc}</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Time range */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block mb-2 text-slate-900 font-bold text-sm">Hora de inicio</label>
                                        <input type="time" value={slots.newStart} onChange={e => slots.setNewStart(e.target.value)} className={inputCls} />
                                    </div>
                                    <div>
                                        <label className="block mb-2 text-slate-900 font-bold text-sm">Hora de fin</label>
                                        <input type="time" value={slots.newEnd} onChange={e => slots.setNewEnd(e.target.value)} className={inputCls} />
                                    </div>
                                </div>

                                <Btn onClick={slots.save} className="w-full" size="lg">
                                    {slots.editingSlotId ? "Guardar cambios" : "Guardar bloque de atención"}
                                </Btn>
                            </div>
                        </Modal>
                    </div>
                )}

                {/* Publish Content Tab */}
                {activeTab === "content" && (
                    <ContentTab dept={dept} endUserTabLabel={endUserTabLabel} />
                )}

                {/* Publish Event Tab */}
                {activeTab === "event" && (
                    <EventTab dept={dept} endUserTabLabel={endUserTabLabel} />
                )}
                </Reveal>

                {/* Virtual Confirm Modal */}
                <Modal
                    open={!!virtualConfirmAppt}
                    onClose={() => setVirtualConfirmAppt(null)}
                    title="Confirmar cita virtual"
                    subtitle={virtualConfirmAppt ? `${virtualConfirmAppt.studentName} — ${virtualConfirmAppt.date} a las ${virtualConfirmAppt.time}` : ""}
                    maxWidth="max-w-md"
                >
                    <div className="space-y-4">
                        <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-2">
                            <Video className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                            <p className="text-blue-800 text-sm">Esta es una cita virtual. El alumno recibirá el enlace de videollamada junto con la confirmación.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-900 mb-2">Enlace de videollamada</label>
                            <input
                                type="url"
                                value={virtualConfirmUrl}
                                onChange={e => setVirtualConfirmUrl(e.target.value)}
                                placeholder="https://meet.google.com/xxx-xxxx-xxx"
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <p className="text-slate-400 text-xs mt-1">Este enlace quedará guardado únicamente en esta cita. Para cambiar el predeterminado, edítalo en la sección de configuración.</p>
                        </div>
                        <div className="flex gap-3">
                            <Btn variant="ghost" onClick={() => setVirtualConfirmAppt(null)} className="flex-1">Cancelar</Btn>
                            <Btn onClick={handleConfirmVirtual} className="flex-1">
                                <CheckCircle2 className="w-4 h-4" /> Confirmar cita
                            </Btn>
                        </div>
                    </div>
                </Modal>

                {/* Presencial Confirm Modal */}
                <Modal
                    open={!!presencialConfirmAppt}
                    onClose={() => setPresencialConfirmAppt(null)}
                    title="Confirmar cita presencial"
                    subtitle={presencialConfirmAppt ? `${presencialConfirmAppt.studentName} — ${presencialConfirmAppt.date} a las ${presencialConfirmAppt.time}` : ""}
                    maxWidth="max-w-md"
                >
                    <div className="space-y-4">
                        <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-2">
                            <MapPin className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                            <p className="text-emerald-800 text-sm">El alumno verá la sede que elijas junto con la confirmación.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-900 mb-2">Sede de atención</label>
                            <select
                                value={presencialConfirmLocationId}
                                onChange={e => setPresencialConfirmLocationId(e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                                <option value="">Sin sede específica</option>
                                {orgLocations.map(l => (
                                    <option key={l.id} value={l.id}>{l.name}{l.address ? ` — ${l.address}` : ""}</option>
                                ))}
                            </select>
                            <p className="text-slate-400 text-xs mt-1">Solo puedes elegir entre las sedes de tu organización.</p>
                        </div>
                        <div className="flex gap-3">
                            <Btn variant="ghost" onClick={() => setPresencialConfirmAppt(null)} className="flex-1">Cancelar</Btn>
                            <Btn onClick={handleConfirmPresencial} className="flex-1">
                                <CheckCircle2 className="w-4 h-4" /> Confirmar cita
                            </Btn>
                        </div>
                    </div>
                </Modal>

                {/* Action Modal — only shown for Completar and Cancelar, Confirmar is direct */}
                <Modal
                    open={!!action.appt && !!action.status && action.status !== "Confirmada"}
                    onClose={action.close}
                    title={action.status === "Completada" ? "Finalizar Cita" : "Cancelar Cita"}
                    subtitle={action.appt ? `${action.appt.studentName} — ${action.appt.date} a las ${action.appt.time}` : ""}
                    maxWidth="max-w-md"
                >
                    <div className="space-y-5">
                        {action.status === "Completada" ? (
                            <>
                                {/* Confidential clinical notes banner */}
                                <div className="flex items-start gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
                                    <Lock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                                    <p className="text-slate-500 text-xs leading-relaxed">
                                        Estas anotaciones son <span className="font-bold text-slate-700">confidenciales</span> — solo tú puedes verlas. No son visibles para el alumno.
                                    </p>
                                </div>
                                <div>
                                    <label className="block mb-2 text-slate-900 font-bold text-sm flex items-center gap-2">
                                        <ClipboardList className="w-4 h-4 text-indigo-600" />
                                        Anotaciones clínicas (opcional)
                                    </label>
                                    <textarea
                                        value={action.notes}
                                        onChange={e => action.setNotes(e.target.value)}
                                        placeholder="Observaciones de la sesión, seguimiento recomendado, estado del paciente..."
                                        rows={4}
                                        className="w-full px-4 py-3 rounded-xl border border-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-colors text-slate-700 bg-slate-50/50 text-sm"
                                    />
                                </div>
                            </>
                        ) : (
                            <div>
                                <label className="block mb-2 text-slate-900 font-bold text-sm">Motivo de cancelación <span className="text-rose-500">*</span></label>
                                <textarea
                                    value={action.notes}
                                    onChange={e => action.setNotes(e.target.value)}
                                    placeholder="Indica el motivo de la cancelación..."
                                    rows={3}
                                    className="w-full px-4 py-3 rounded-xl border border-slate-200 resize-none focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-colors text-slate-700 bg-slate-50/50 text-sm"
                                />
                            </div>
                        )}
                        <div className="flex gap-3">
                            <Btn variant="outline" onClick={action.close} className="flex-1">Cancelar</Btn>
                            <Btn
                                onClick={() => {
                                    if (action.status === "Cancelada" && !action.notes.trim()) { toast.error("Indica el motivo de la cancelación."); return; }
                                    action.confirm();
                                }}
                                className={`flex-1 text-white border-0 shadow-lg ${action.status === "Cancelada" ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700"}`}
                            >
                                {action.status === "Completada" ? "Finalizar Cita" : "Confirmar Cancelación"}
                            </Btn>
                        </div>
                    </div>
                </Modal>

                {/* Reschedule Modal */}
                <Modal open={resch.show} onClose={() => resch.setShow(false)} title="Reagendar Cita" subtitle="Propón una nueva fecha y hora para el alumno">
                    <div className="space-y-6">
                        <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-start gap-3">
                            <Info className="w-5 h-5 text-blue-600 mt-0.5" />
                            <p className="text-sm text-blue-700">El alumno recibirá una notificación con el nuevo horario.</p>
                        </div>
                        <div>
                            <label className="block text-slate-700 font-bold text-sm mb-2">Modalidad</label>
                            <div className="grid grid-cols-2 gap-2">
                                {["Presencial", "Virtual"].map(m => (
                                    <button key={m} type="button" onClick={() => resch.setSelModality(m)}
                                        className={`py-2.5 rounded-xl border-2 font-bold text-sm transition-all cursor-pointer ${resch.selModality === m ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
                                        {m}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-slate-700 font-bold text-sm mb-3">Nueva Fecha</label>
                                <MiniCalendar selectedDate={resch.date} onSelect={resch.setDate} availableDates={resch.availDates} onMonthChange={resch.handleMonthChange} />
                            </div>
                            <div>
                                <label className="block text-slate-700 font-bold text-sm mb-3">Horarios</label>
                                {!resch.date ? (
                                    <div className="h-48 flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                        <Calendar className="w-8 h-8 text-slate-300 mb-2" />
                                        <p className="text-xs text-slate-400">Selecciona un día</p>
                                    </div>
                                ) : resch.slots.length === 0 ? (
                                    <div className="h-48 flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                        <Clock className="w-8 h-8 text-slate-300 mb-2" />
                                        <p className="text-xs text-slate-400">Sin horarios disponibles</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                                        {resch.slots.map(t => (
                                            <button key={t.start} onClick={() => resch.setSlot(t.start)}
                                                className={`py-3 rounded-xl border-2 font-bold text-sm transition-all cursor-pointer ${resch.slot === t.start ? "border-blue-600 bg-blue-600 text-white" : "border-slate-100 bg-white text-slate-600 hover:border-blue-200"}`}>
                                                {t.start}–{t.end}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="pt-4 border-t border-slate-100 flex gap-3">
                            <Btn variant="ghost" onClick={() => resch.setShow(false)} className="flex-1">Cancelar</Btn>
                            <Btn disabled={!resch.slot} onClick={() => { resch.confirm(); toast.success("Cita reagendada"); }} className="flex-1">
                                Confirmar Reagendamiento
                            </Btn>
                        </div>
                    </div>
                </Modal>
                {/* Seguimiento Modal — schedule follow-up appointment */}
                <Modal
                    open={!!seguimientoAppt}
                    onClose={() => setSeguimientoAppt(null)}
                    title="Agendar Cita de Seguimiento"
                    subtitle={seguimientoAppt ? `${seguimientoAppt.studentName} — continuación de sesión anterior` : ""}
                    maxWidth="max-w-lg"
                >
                    <div className="space-y-6">
                        <div className="flex items-start gap-3 p-3.5 bg-indigo-50 border border-indigo-100 rounded-xl">
                            <ArrowRight className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                            <p className="text-indigo-700 text-sm">
                                Se creará una nueva cita de seguimiento para <span className="font-bold">{seguimientoAppt?.studentName}</span> con el mismo motivo y modalidad.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-slate-700 font-bold text-sm mb-3">Nueva Fecha</label>
                                <MiniCalendar
                                    selectedDate={seguimientoDate}
                                    onSelect={setSeguimientoDate}
                                    availableDates={seguimientoAvailDates}
                                />
                            </div>
                            <div>
                                <label className="block text-slate-700 font-bold text-sm mb-3">Horarios Disponibles</label>
                                {!seguimientoDate ? (
                                    <div className="h-48 flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                        <Calendar className="w-8 h-8 text-slate-300 mb-2" />
                                        <p className="text-xs text-slate-400">Selecciona un día</p>
                                    </div>
                                ) : seguimientoSlots.length === 0 ? (
                                    <div className="h-48 flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                        <Clock className="w-8 h-8 text-slate-300 mb-2" />
                                        <p className="text-xs text-slate-400">Sin horarios disponibles</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                                        {seguimientoSlots.map(t => (
                                            <button key={t.start} onClick={() => setSeguimientoSlot(t.start)}
                                                className={`py-3 rounded-xl border-2 font-bold text-sm transition-all cursor-pointer ${seguimientoSlot === t.start ? "border-indigo-600 bg-indigo-600 text-white shadow-md" : "border-slate-100 bg-white text-slate-600 hover:border-indigo-200"}`}>
                                                {t.start}–{t.end}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-100 flex gap-3">
                            <Btn variant="ghost" onClick={() => setSeguimientoAppt(null)} className="flex-1">Cancelar</Btn>
                            <Btn
                                disabled={!seguimientoSlot}
                                onClick={confirmSeguimiento}
                                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white border-0 shadow-lg shadow-indigo-600/20"
                            >
                                <ArrowRight className="w-4 h-4" /> Confirmar Seguimiento
                            </Btn>
                        </div>
                    </div>
                </Modal>

            </div>
        </AppShell>
    );
}

// ─── AppointmentCard sub-component ───────────────────────
function AppointmentCard({
    appt,
    onAction,
    onReschedule,
    onSeguimiento,
    onConfirmDirect,
}: {
    appt: Appointment;
    onAction: (a: Appointment, s: string) => void;
    onReschedule: () => void;
    onSeguimiento: (a: Appointment) => void;
    onConfirmDirect: (a: Appointment) => void;
}) {
    const apptDateTime = new Date(`${appt.date}T${appt.time}:00`);
    const now = new Date();
    const todayM = new Date(); todayM.setHours(0, 0, 0, 0);
    const apptDateMidnight = new Date(appt.date + "T12:00:00");
    const isApptPast = apptDateMidnight < todayM;
    const hoursUntilAppt = (apptDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    const isWithin24h = hoursUntilAppt >= 0 && hoursUntilAppt < 24;
    const isFollowUp = appt.isFollowUp || appt.motivo?.startsWith("Seguimiento:");

    return (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:shadow-md transition-shadow">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="font-bold text-slate-900 dark:text-white text-sm">{appt.studentName}</p>
                    <StatusBadge status={appt.status} />
                    {isFollowUp && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[0.65rem] font-bold border border-indigo-200 dark:border-indigo-700">
                            <ArrowRight className="w-2.5 h-2.5" /> Seguimiento
                        </span>
                    )}
                </div>
                <p className="text-slate-500 dark:text-slate-300 text-xs">{appt.date} — {appt.time} • {appt.modality}</p>
                {appt.motivo && (
                    <p className="text-slate-400 dark:text-slate-300 text-xs mt-0.5">
                        Motivo: {appt.motivo.replace(/^Seguimiento:\s*/i, "")}
                    </p>
                )}
                {appt.status === "Cancelada" && appt.cancellationReason && (
                    <div className="mt-2 flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-900/20 rounded-xl border border-rose-100 dark:border-rose-800">
                        <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-[0.65rem] font-bold text-rose-400 uppercase tracking-wider mb-0.5">Motivo de cancelación</p>
                            <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">{appt.cancellationReason}</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
                {appt.status === "Pendiente" && (
                    <>
                        <Btn size="sm" variant="emerald" onClick={() => onConfirmDirect(appt)}>
                            <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar
                        </Btn>
                        {!isApptPast && (
                            <Btn size="sm" variant="ghost" onClick={onReschedule}>
                                <RefreshCw className="w-3.5 h-3.5" /> Reagendar
                            </Btn>
                        )}
                        {isWithin24h ? (
                            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium px-2 py-1 bg-amber-50 dark:bg-amber-900/30 rounded-lg border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> &lt;24h
                            </span>
                        ) : (
                            <Btn size="sm" variant="rose" onClick={() => onAction(appt, "Cancelada")}>Cancelar</Btn>
                        )}
                    </>
                )}

                {appt.status === "Confirmada" && (
                    <>
                        <Btn size="sm" onClick={() => onAction(appt, "Completada")}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white border-0 shadow-sm">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Completar
                        </Btn>
                        {!isApptPast && (
                            <Btn size="sm" variant="ghost" onClick={onReschedule}>
                                <RefreshCw className="w-3.5 h-3.5" /> Reagendar
                            </Btn>
                        )}
                        {isWithin24h ? (
                            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium px-2 py-1 bg-amber-50 dark:bg-amber-900/30 rounded-lg border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                                <Lock className="w-3 h-3" /> &lt;24h
                            </span>
                        ) : (
                            <Btn size="sm" variant="rose" onClick={() => onAction(appt, "Cancelada")}>Cancelar</Btn>
                        )}
                    </>
                )}

                {appt.status === "Completada" && (
                    <button
                        onClick={() => onSeguimiento(appt)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:opacity-80 cursor-pointer bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700"
                    >
                        <ArrowRight className="w-3.5 h-3.5" /> Seguimiento
                    </button>
                )}
            </div>
        </div>
    );
}
