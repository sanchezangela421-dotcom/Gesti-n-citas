import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
    Clock, CalendarCheck, CheckCircle2, Users, FileText, Megaphone,
    CalendarDays, Info, RefreshCw, Pencil, Trash2, Calendar,
    Video, Plus, ExternalLink, Image as ImageIcon,
    ClipboardList, ArrowRight, Lock, History, XCircle,
} from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useStore } from "../../../context/StoreContext";
import { AppShell } from "../../components/layout/AppShell";
import { Btn, StatCard, Modal, MiniCalendar, StatusBadge, inputCls, EmptyState } from "../../components/ui";
import { DAYS_FULL } from "../../../constants";
import { useReschedule, useActionModal } from "../../hooks";
import { localISODate } from "../../../utils/date";
import type { Appointment } from "../../../types";

// ─── Schedule slot management hook ───────────────────────
function useScheduleSlots(specId: string | undefined, schedule: any[]) {
    const { addScheduleSlot, removeScheduleSlot } = useStore();

    const [show, setShow] = useState(false);
    const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
    const [newDay, setNewDay] = useState<number | string>(1);
    const [newWeek, setNewWeek] = useState<number | string>("both");
    const [newStart, setNewStart] = useState("09:00");
    const [newEnd, setNewEnd] = useState("13:00");
    const [selectedBaseDate, setSelectedBaseDate] = useState<string | undefined>(undefined);

    const openEditSlot = (slot: any) => {
        setEditingSlotId(slot.id);
        setNewDay(slot.dayOfWeek);
        setNewWeek(slot.week === null || slot.week === undefined ? "both" : slot.week);
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

        // ── Modo semana completa: "Esta semana" (0) o "Próxima semana" (1) ──
        if ((newWeek === "0" || newWeek === "1") && !editingSlotId) {
            const weekOffset = parseInt(String(newWeek));
            const todayM = new Date(); todayM.setHours(0, 0, 0, 0);
            const dayShift = todayM.getDay() === 0 ? 1 : 1 - todayM.getDay();
            const mondayOfWeek = new Date(todayM);
            mondayOfWeek.setDate(todayM.getDate() + dayShift + weekOffset * 7);

            // Calcula los días hábiles (Lun-Vie) de la semana objetivo que no hayan pasado
            const daysToCreate: number[] = [];
            for (let i = 0; i < 5; i++) {
                const dayDate = new Date(mondayOfWeek);
                dayDate.setDate(mondayOfWeek.getDate() + i);
                if (weekOffset === 0 && dayDate < todayM) continue; // saltar días pasados de esta semana
                const dow = i + 1; // 1=Lun … 5=Vie
                const hasOverlap = schedule.some(s => {
                    const sWeek = s.week === null ? undefined : s.week;
                    return (
                        s.dayOfWeek === dow &&
                        (sWeek === undefined || sWeek === weekOffset) &&
                        s.specificDate === null &&
                        newStart < s.endTime && newEnd > s.startTime
                    );
                });
                if (!hasOverlap) daysToCreate.push(dow);
            }

            if (daysToCreate.length === 0) {
                toast.error("Ya existe un horario solapado en todos los días de esa semana.");
                return;
            }

            daysToCreate.forEach(dow =>
                addScheduleSlot(specId, {
                    dayOfWeek: dow,
                    startTime: newStart,
                    endTime: newEnd,
                    available: true,
                    week: weekOffset,
                    specificDate: undefined,
                })
            );

            setShow(false); setEditingSlotId(null);
            toast.success(
                `${daysToCreate.length} horarios agregados para ${weekOffset === 0 ? "esta semana" : "la próxima semana"}`
            );
            return;
        }

        // ── Modo día único: "Solo este día" o "Siempre" ──
        const dayInt = parseInt(String(newDay));
        const isSpecificDate = newWeek === "date";
        const weekVal = newWeek === "both" || newWeek === "date" ? undefined : parseInt(String(newWeek));

        const hasOverlap = schedule.some(s => {
            if (editingSlotId && s.id === editingSlotId) return false;
            const sWeek = s.week === null ? undefined : s.week;
            return (
                s.dayOfWeek === dayInt &&
                (sWeek === undefined || weekVal === undefined || sWeek === weekVal) &&
                (isSpecificDate ? s.specificDate === selectedBaseDate : (s.specificDate == null)) &&
                newStart < s.endTime && newEnd > s.startTime
            );
        });

        if (hasOverlap) { toast.error("Ya existe un horario solapado para este rango."); return; }
        if (editingSlotId) removeScheduleSlot(specId, editingSlotId);

        addScheduleSlot(specId, {
            dayOfWeek: dayInt,
            startTime: newStart,
            endTime: newEnd,
            available: true,
            week: weekVal,
            specificDate: isSpecificDate ? selectedBaseDate : undefined,
        });
        setShow(false); setEditingSlotId(null);
        toast.success(editingSlotId ? "Horario actualizado" : "Horario agregado");
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
    const { specialists, specialistsLoaded, getAppointments, addScheduleSlot, addEvent, updateEvent, deleteEvent, addResource, updateResource, deleteResource, resources, events, getAvailableDays, getAvailableSlots, createAppointment, addNotification, updateMeetingUrl } = useStore();

    const spec = specialists.find(s => s.userId === user?.id);
    const dept = user?.department || "Psicología";

    const [activeTab, setActiveTab] = useState("calendar");
    const [meetingUrlInput, setMeetingUrlInput] = useState(spec?.meetingUrl ?? "");
    const [virtualConfirmAppt, setVirtualConfirmAppt] = useState<Appointment | null>(null);
    const [virtualConfirmUrl, setVirtualConfirmUrl] = useState("");

    const allAppts = spec ? getAppointments({ specialistId: spec.id }) : [];
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);

    // Citas pasadas que siguen abiertas (Pendiente o Confirmada sin cerrar)
    const sinCerrar = allAppts.filter(a =>
        (a.status === "Pendiente" || a.status === "Confirmada") &&
        new Date(a.date + "T12:00:00") < todayMidnight
    );

    // Pendientes solo de hoy en adelante
    const pendientes = allAppts.filter(a =>
        a.status === "Pendiente" && new Date(a.date + "T12:00:00") >= todayMidnight
    );
    const confirmadas = allAppts.filter(a => a.status === "Confirmada");
    const completadas = allAppts.filter(a => a.status === "Completada");
    const totalPatients = new Set(allAppts.map(a => a.studentName)).size;

    // Calendar tab state
    const [selDate, setSelDate] = useState(new Date());
    const [activeListTab, setActiveListTab] = useState("pending");
    const apptDates = [...new Set(allAppts.filter(a => a.status !== "Cancelada").map(a => a.date))]
        .map(d => new Date(d + "T12:00:00"))
        .filter(d => d >= todayMidnight);
    const dayAppts = allAppts.filter(a => a.date === localISODate(selDate) && a.status !== "Cancelada");

    // Hooks
    const action = useActionModal();
    const resch = useReschedule("specialist");
    const slots = useScheduleSlots(spec?.id, spec?.schedule ?? []);

    // ── Direct confirm (no modal) ───────────────────────────────
    const { updateAppointmentStatus } = useStore();
    const handleConfirmDirect = (appt: Appointment) => {
        if (appt.modality === "Virtual") {
            setVirtualConfirmAppt(appt);
            setVirtualConfirmUrl(spec?.meetingUrl ?? "");
        } else {
            updateAppointmentStatus(appt.id, "Confirmada", undefined);
            toast.success("Cita confirmada");
        }
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
        createAppointment({
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

    // Content form
    const [ctitle, setCtitle] = useState("");
    const [cdesc, setCdesc] = useState("");
    const [ctype, setCtype] = useState("video");
    const [curl, setCurl] = useState("");
    const [cimgUrl, setCimgUrl] = useState("");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    // Edit resource modal
    const [editingResource, setEditingResource] = useState<any | null>(null);
    const [editRTitle, setEditRTitle] = useState("");
    const [editRDesc, setEditRDesc] = useState("");
    const [editRUrl, setEditRUrl] = useState("");
    const [editRFile, setEditRFile] = useState<File | null>(null);

    const openEditResource = (r: any) => {
        setEditingResource(r);
        setEditRTitle(r.title);
        setEditRDesc(r.description);
        setEditRUrl(r.url === "#" ? "" : r.url);
        setEditRFile(null);
    };

    const handleSaveResource = async () => {
        if (!editingResource || !editRTitle) { toast.error("El título es obligatorio"); return; }
        await updateResource(editingResource.id, {
            title: editRTitle, description: editRDesc, url: editRUrl || "#",
        }, editRFile || undefined);
        toast.success("Recurso actualizado");
        setEditingResource(null);
    };

    // Edit event modal
    const [editingEvent, setEditingEvent] = useState<any | null>(null);
    const [editEvTitle, setEditEvTitle] = useState("");
    const [editEvDesc, setEditEvDesc] = useState("");
    const [editEvDate, setEditEvDate] = useState("");
    const [editEvTime, setEditEvTime] = useState("");
    const [editEvType, setEditEvType] = useState("");
    const [editEvRegUrl, setEditEvRegUrl] = useState("");
    const [editEvImg, setEditEvImg] = useState<File | null>(null);

    const openEditEvent = (ev: any) => {
        setEditingEvent(ev);
        setEditEvTitle(ev.title);
        setEditEvDesc(ev.description);
        setEditEvDate(ev.date);
        setEditEvTime(ev.time);
        setEditEvType(ev.type);
        setEditEvRegUrl(ev.registrationUrl || "");
        setEditEvImg(null);
    };

    const handleSaveEvent = async () => {
        if (!editingEvent || !editEvTitle || !editEvDate) { toast.error("Título y fecha son obligatorios"); return; }
        await updateEvent(editingEvent.id, {
            title: editEvTitle, description: editEvDesc,
            date: editEvDate, time: editEvTime, type: editEvType,
            registrationUrl: editEvType === "taller" ? editEvRegUrl : undefined,
        }, editEvImg || undefined);
        toast.success("Evento actualizado");
        setEditingEvent(null);
    };

    const handlePublishContent = () => {
        if (!ctitle) { toast.error("El título es obligatorio"); return; }
        if (ctype !== "image" && !curl && !selectedFile) {
            toast.error("Agrega un enlace o sube un archivo"); return;
        }
        addResource({
            department: dept,
            type: ctype,
            title: ctitle,
            description: cdesc,
            url: curl || "#",
            imageUrl: cimgUrl || undefined,
        }, selectedFile || undefined);
        toast.success("Contenido publicado exitosamente");
        setCtitle(""); setCdesc(""); setCurl(""); setCimgUrl(""); setSelectedFile(null);
    };

    // Event form
    const [evTitle, setEvTitle] = useState("");
    const [evDesc, setEvDesc] = useState("");
    const [evDate, setEvDate] = useState("");
    const [evTime, setEvTime] = useState("");
    const [evType, setEvType] = useState("taller");
    const [evImg, setEvImg] = useState("");
    const [evRegUrl, setEvRegUrl] = useState("");
    const [selectedEventImg, setSelectedEventImg] = useState<File | null>(null);

    const handlePublishEvent = () => {
        if (!evTitle || !evDate) { toast.error("Título y fecha son obligatorios"); return; }
        const finalImg = selectedEventImg ? URL.createObjectURL(selectedEventImg) : (evImg || "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=400&q=80");
        addEvent({
            title: evTitle, description: evDesc, department: dept,
            date: evDate, time: evTime, type: evType,
            imageUrl: finalImg,
            registrationUrl: evType === "taller" ? evRegUrl : undefined,
        });
        toast.success("Evento publicado exitosamente");
        setEvTitle(""); setEvDesc(""); setEvDate(""); setEvTime(""); setEvImg(""); setEvRegUrl(""); setSelectedEventImg(null);
    };

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

    const statsData = [
        { label: "Pendientes", value: pendientes.length, icon: Clock, gradient: "from-amber-500 to-amber-600" },
        { label: "Confirmadas", value: confirmadas.length, icon: CalendarCheck, gradient: "from-blue-600 to-indigo-600" },
        { label: "Completadas", value: completadas.length, icon: CheckCircle2, gradient: "from-emerald-500 to-emerald-600" },
        { label: "Pacientes", value: totalPatients, icon: Users, gradient: "from-violet-500 to-violet-600" },
    ];

    // Root appointments in history (Completada or Cancelada, no parentId)
    const historialAppts = allAppts
        .filter(a => (a.status === "Completada" || a.status === "Cancelada") && !a.parentId)
        .sort((a, b) => b.date.localeCompare(a.date));

    // Map parentId → follow-up appointments (any status, not cancelled)
    const followUpsByParent = allAppts.reduce((acc, a) => {
        if (a.parentId) {
            if (!acc[a.parentId]) acc[a.parentId] = [];
            acc[a.parentId].push(a);
        }
        return acc;
    }, {} as Record<string, typeof allAppts>);

    const sidebarTabs = [
        { key: "calendar", label: "Mi Calendario", icon: CalendarDays },
        { key: "historial", label: "Historial", icon: History },
        { key: "schedules", label: "Mis Horarios", icon: Clock },
        { key: "content", label: "Publicar Contenido", icon: FileText },
        { key: "event", label: "Publicar Evento", icon: Megaphone },
    ];

    const isPastDay = (date: Date) => {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const d = new Date(date); d.setHours(0, 0, 0, 0);
        return d < today;
    };

    return (
        <AppShell sidebar={{ tabs: sidebarTabs, active: activeTab, onSelect: setActiveTab, badges: { calendar: pendientes.length + sinCerrar.length } }}>
            <div className="space-y-8 max-w-7xl mx-auto w-full pb-12">

                {/* Header */}
                <div>
                    <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Panel de {dept}</h1>
                    <p className="text-slate-500 dark:text-slate-400 mt-1 font-medium">{spec.name} — Gestión de citas y agenda</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {statsData.map(s => <StatCard key={s.label} {...s} />)}
                </div>

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
                                {historialAppts.map(appt => {
                                    const isLate = appt.status === "Completada" &&
                                        appt.updatedAt &&
                                        appt.updatedAt.split("T")[0] > appt.date;
                                    const apptFollowUps = followUpsByParent[appt.id] ?? [];
                                    const hasActiveFollowUp = apptFollowUps.some(f => f.status !== "Cancelada");
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
                                                    {appt.status === "Completada" && appt.notes && (
                                                        <div className="mt-2 flex items-start gap-2 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800">
                                                            <ClipboardList className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                                                            <div>
                                                                <p className="text-[0.65rem] font-bold text-indigo-400 uppercase tracking-wider mb-0.5">Notas clínicas</p>
                                                                <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">{appt.notes}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {appt.status === "Cancelada" && appt.notes && (
                                                        <div className="mt-2 flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-900/20 rounded-xl border border-rose-100 dark:border-rose-800">
                                                            <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                                                            <div>
                                                                <p className="text-[0.65rem] font-bold text-rose-400 uppercase tracking-wider mb-0.5">Motivo de cancelación</p>
                                                                <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">{appt.notes}</p>
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
                                                                    {fu.status === "Completada" && fu.notes && (
                                                                        <div className="mt-2 flex items-start gap-2 p-2 bg-white dark:bg-slate-800 rounded-lg border border-indigo-100 dark:border-indigo-800">
                                                                            <ClipboardList className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
                                                                            <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">{fu.notes}</p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                {fu.status === "Completada" && !followUpsByParent[fu.id]?.some(f => f.status !== "Cancelada") && (
                                                                    <button
                                                                        onClick={() => openSeguimiento(fu)}
                                                                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-bold transition-all hover:opacity-80 cursor-pointer shrink-0 self-start bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700"
                                                                    >
                                                                        <ArrowRight className="w-3 h-3" /> Seguimiento
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ))
                                                    }
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
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
                                <h4 className="font-bold text-slate-900 dark:text-white text-sm">Enlace de Videoconferencia (Citas Virtuales)</h4>
                            </div>
                            <p className="text-slate-500 text-xs mb-3">Este enlace se mostrará a los alumnos al agendar una cita virtual contigo.</p>
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
                                                (s.specificDate === null && s.dayOfWeek === dow &&
                                                    (s.week === undefined || s.week === null || s.week === weekOffset))
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
                                                label: "Esta semana",
                                                desc: `Añade ${slots.newStart}–${slots.newEnd} a todos los días hábiles disponibles de esta semana`,
                                                color: "indigo",
                                            },
                                            {
                                                value: "1",
                                                label: "Próxima semana",
                                                desc: `Añade ${slots.newStart}–${slots.newEnd} a los 5 días hábiles de la próxima semana`,
                                                color: "violet",
                                            },
                                            {
                                                value: "both",
                                                label: "Siempre (recurrente)",
                                                desc: `Todos los ${DAYS_FULL[Number(slots.newDay)]} de forma permanente`,
                                                color: "emerald",
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
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                        {/* ── Form ── */}
                        <div>
                            <h3 className="text-2xl font-bold text-slate-900 mb-2">Publicar Material Educativo</h3>
                            <p className="text-slate-500 font-medium mb-6">Comparte recursos con los estudiantes de la facultad.</p>
                            <div className="space-y-5 bg-slate-50 border border-slate-200 rounded-3xl p-6 shadow-sm">
                                <div>
                                    <label className="block mb-2 text-slate-900 font-bold text-sm">Título <span className="text-rose-500">*</span></label>
                                    <input type="text" value={ctitle} onChange={e => setCtitle(e.target.value)} placeholder="Ej. Guía para el manejo de ansiedad" className={inputCls} />
                                </div>
                                <div>
                                    <label className="block mb-2 text-slate-900 font-bold text-sm">Descripción</label>
                                    <textarea value={cdesc} onChange={e => setCdesc(e.target.value)} className={`${inputCls} resize-none`} rows={3} />
                                </div>
                                <div>
                                    <label className="block mb-2 text-slate-900 font-bold text-sm">Tipo de recurso</label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[
                                            { key: "video", label: "Video", icon: Video, color: "rose" },
                                            { key: "image", label: "Infografía", icon: ImageIcon, color: "emerald" },
                                            { key: "link", label: "Enlace", icon: ExternalLink, color: "blue" },
                                        ].map(t => (
                                            <button key={t.key} onClick={() => { setCtype(t.key); setCurl(""); setSelectedFile(null); }}
                                                className={`flex flex-col items-center gap-2 p-4 border-2 rounded-2xl cursor-pointer transition-all ${ctype === t.key ? `border-${t.color}-500 bg-${t.color}-50` : "border-slate-200 bg-white hover:border-slate-300"}`}>
                                                <t.icon className={`w-6 h-6 ${ctype === t.key ? `text-${t.color}-600` : "text-slate-400"}`} />
                                                <span className={`text-xs font-bold ${ctype === t.key ? `text-${t.color}-700` : "text-slate-500"}`}>{t.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {ctype === "image" && (
                                    <div>
                                        <label className="block mb-2 text-slate-900 font-bold text-sm">Imagen / Infografía <span className="text-rose-500">*</span></label>
                                        <div className="relative flex items-center gap-4 p-4 bg-white border-2 border-dashed border-emerald-200 rounded-2xl hover:border-emerald-400 transition-colors cursor-pointer">
                                            <input type="file" accept="image/*" onChange={e => setSelectedFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                                            {selectedFile ? (
                                                <>
                                                    <img src={URL.createObjectURL(selectedFile)} alt="" className="w-16 h-16 rounded-xl object-cover border border-slate-200 shrink-0" />
                                                    <div><p className="text-sm font-bold text-slate-700">{selectedFile.name}</p><p className="text-xs text-slate-400">{(selectedFile.size / 1024).toFixed(1)} KB — haz clic para cambiar</p></div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className="w-16 h-16 rounded-xl bg-emerald-50 flex items-center justify-center border border-emerald-100 shrink-0"><ImageIcon className="w-7 h-7 text-emerald-400" /></div>
                                                    <div><p className="text-sm font-bold text-slate-700">Subir imagen o infografía</p><p className="text-xs text-slate-400">JPG, PNG, WEBP. Recomendado: 800×400px</p></div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {ctype === "video" && (
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block mb-1 text-slate-900 font-bold text-sm">Enlace del video <span className="text-rose-500">*</span></label>
                                            <p className="text-xs text-slate-400 mb-2">Pega la URL de YouTube o Vimeo. Los alumnos verán el video integrado directamente en la plataforma.</p>
                                            <input type="url" value={curl} onChange={e => setCurl(e.target.value)} placeholder="https://youtube.com/watch?v=... o https://vimeo.com/..." className={inputCls} />
                                        </div>
                                        <div>
                                            <label className="block mb-2 text-slate-900 font-bold text-sm">Archivo adjunto (opcional)</label>
                                            <div className="relative flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-xl hover:border-rose-300 transition-colors cursor-pointer">
                                                <input type="file" onChange={e => setSelectedFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                                                <Plus className="w-5 h-5 text-slate-400" />
                                                <div>
                                                    <p className="text-sm font-bold text-slate-700">{selectedFile ? selectedFile.name : "Subir archivo complementario"}</p>
                                                    {selectedFile && <p className="text-xs text-slate-400">{(selectedFile.size / 1024).toFixed(1)} KB</p>}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {ctype === "link" && (
                                    <div>
                                        <label className="block mb-2 text-slate-900 font-bold text-sm">URL del enlace <span className="text-rose-500">*</span></label>
                                        <input type="url" value={curl} onChange={e => setCurl(e.target.value)} placeholder="https://..." className={inputCls} />
                                    </div>
                                )}
                                <Btn onClick={handlePublishContent} size="lg" className="w-full">
                                    <FileText className="w-5 h-5" /> Publicar Material
                                </Btn>
                            </div>
                        </div>

                        {/* ── Published resources for this dept ── */}
                        <div>
                            <h3 className="text-xl font-bold text-slate-900 mb-4">Material publicado — {dept}</h3>
                            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                                {resources.filter(r => r.department === dept).length === 0 ? (
                                    <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl">
                                        <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                        <p className="text-sm font-medium">Sin material publicado en {dept}</p>
                                    </div>
                                ) : (
                                    resources.filter(r => r.department === dept).map(r => (
                                        <div key={r.id} className="flex items-start gap-3 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm hover:shadow-md transition-shadow group">
                                            <div className={`p-2 rounded-lg shrink-0 ${r.type === "video" ? "bg-rose-50" : r.type === "link" ? "bg-blue-50" : "bg-emerald-50"}`}>
                                                {r.type === "video" && <Video className="w-4 h-4 text-rose-500" />}
                                                {r.type === "link" && <ExternalLink className="w-4 h-4 text-blue-500" />}
                                                {r.type === "image" && <ImageIcon className="w-4 h-4 text-emerald-500" />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-slate-800 truncate">{r.title}</p>
                                                {r.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{r.description}</p>}
                                                <span className="text-[0.65rem] uppercase tracking-wider font-bold text-slate-400">{r.type}</span>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 shrink-0 transition-all">
                                                <button onClick={() => openEditResource(r)} title="Editar"
                                                    className="p-1.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all cursor-pointer">
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => deleteResource(r.id)} title="Eliminar"
                                                    className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all cursor-pointer">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Publish Event Tab */}
                {activeTab === "event" && (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                        {/* ── Form ── */}
                        <div>
                            <h3 className="text-2xl font-bold text-slate-900 mb-2">Publicar Evento o Taller</h3>
                            <p className="text-slate-500 font-medium mb-6">Crea un banner que aparecerá en el carrusel principal de estudiantes.</p>
                            <div className="space-y-5 bg-slate-50 border border-slate-200 rounded-3xl p-6 shadow-sm">
                                <div>
                                    <label className="block mb-2 text-slate-900 font-bold text-sm">Formato</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {["taller", "conferencia"].map(t => (
                                            <button key={t} onClick={() => setEvType(t)}
                                                className={`py-3 rounded-xl border-2 cursor-pointer capitalize font-bold text-sm transition-all ${evType === t ? "border-violet-600 bg-violet-50 text-violet-700 shadow-sm" : "border-slate-200 bg-white text-slate-500"}`}>
                                                {t}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div>
                                    <label className="block mb-2 text-slate-900 font-bold text-sm">Título <span className="text-rose-500">*</span></label>
                                    <input type="text" value={evTitle} onChange={e => setEvTitle(e.target.value)} placeholder="Ej. Taller de Organización" className={inputCls} />
                                </div>
                                <div>
                                    <label className="block mb-2 text-slate-900 font-bold text-sm">Descripción</label>
                                    <textarea value={evDesc} onChange={e => setEvDesc(e.target.value)} className={`${inputCls} resize-none`} rows={3} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block mb-2 text-slate-900 font-bold text-sm">Fecha <span className="text-rose-500">*</span></label>
                                        <input type="date" value={evDate} onChange={e => setEvDate(e.target.value)} className={inputCls} />
                                    </div>
                                    <div>
                                        <label className="block mb-2 text-slate-900 font-bold text-sm">Hora</label>
                                        <input type="time" value={evTime} onChange={e => setEvTime(e.target.value)} className={inputCls} />
                                    </div>
                                </div>
                                <div>
                                    <label className="block mb-2 text-slate-900 font-bold text-sm">Imagen de portada</label>
                                    <div className="relative flex items-center gap-4 p-5 bg-white border border-slate-200 rounded-2xl hover:border-violet-400 transition-colors cursor-pointer">
                                        <input type="file" accept="image/*" onChange={e => setSelectedEventImg(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                                        <div className="w-20 h-20 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-100">
                                            {selectedEventImg ? <img src={URL.createObjectURL(selectedEventImg)} className="w-full h-full object-cover" alt="" /> : <ImageIcon className="w-8 h-8 text-slate-400" />}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-700">{selectedEventImg ? selectedEventImg.name : "Subir imagen"}</p>
                                            <p className="text-xs text-slate-400">JPG, PNG. Recomendado: 800×400px</p>
                                        </div>
                                    </div>
                                </div>
                                {evType === "taller" && (
                                    <div>
                                        <label className="block mb-2 text-slate-900 font-bold text-sm">Enlace de registro <span className="text-rose-500">*</span></label>
                                        <input type="url" value={evRegUrl} onChange={e => setEvRegUrl(e.target.value)} placeholder="https://forms.gle/..." className={inputCls} />
                                    </div>
                                )}
                                <Btn onClick={handlePublishEvent} size="lg" className="w-full bg-violet-600 hover:bg-violet-700">
                                    <Megaphone className="w-5 h-5" /> Publicar Evento
                                </Btn>
                            </div>
                        </div>

                        {/* ── Published events for this dept ── */}
                        <div>
                            <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center"><CheckCircle2 className="w-4 h-4 text-emerald-600" /></div>
                                Eventos publicados — {dept} ({events.filter(e => e.department === dept).length})
                            </h3>
                            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
                                {events.filter(e => e.department === dept).length === 0 ? (
                                    <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl">
                                        <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                        <p className="text-sm font-medium">Sin eventos publicados en {dept}</p>
                                    </div>
                                ) : (
                                    events.filter(e => e.department === dept).map(ev => (
                                        <div key={ev.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow group">
                                            {ev.imageUrl && (
                                                <div className="h-28 bg-slate-100 overflow-hidden relative">
                                                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/50 to-transparent z-10" />
                                                    <img src={ev.imageUrl} alt={ev.title} className="w-full h-full object-cover"
                                                        onError={(e: React.SyntheticEvent<HTMLImageElement>) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                                    <span className={`absolute bottom-2 left-2 z-20 px-2 py-0.5 rounded-md font-bold text-[0.6rem] uppercase ${ev.type === "conferencia" ? "bg-violet-500 text-white" : "bg-blue-500 text-white"}`}>
                                                        {ev.type === "conferencia" ? "Conferencia" : "Taller"}
                                                    </span>
                                                    <div className="absolute top-2 right-2 z-20 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                        <button onClick={() => openEditEvent(ev)} title="Editar"
                                                            className="p-1.5 bg-white/90 hover:bg-white text-blue-600 rounded-lg cursor-pointer shadow">
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </button>
                                                        <button onClick={() => deleteEvent(ev.id)} title="Eliminar"
                                                            className="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg cursor-pointer shadow">
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                            <div className="p-3 flex items-start justify-between gap-2">
                                                <div>
                                                    <p className="text-slate-900 font-bold text-sm leading-tight">{ev.title}</p>
                                                    <p className="text-slate-500 text-xs mt-1 flex items-center gap-1">
                                                        <CalendarDays className="w-3 h-3" />
                                                        {new Date(ev.date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" })}
                                                        {ev.time ? ` • ${ev.time}` : ""}
                                                    </p>
                                                </div>
                                                {!ev.imageUrl && (
                                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 shrink-0 transition-all">
                                                        <button onClick={() => openEditEvent(ev)} title="Editar"
                                                            className="p-1.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all cursor-pointer">
                                                            <Pencil className="w-4 h-4" />
                                                        </button>
                                                        <button onClick={() => deleteEvent(ev.id)} title="Eliminar"
                                                            className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all cursor-pointer">
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}

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
                            <p className="text-slate-400 text-xs mt-1">Si lo cambias, se actualizará tu enlace general para citas virtuales.</p>
                        </div>
                        <div className="flex gap-3">
                            <Btn variant="ghost" onClick={() => setVirtualConfirmAppt(null)} className="flex-1">Cancelar</Btn>
                            <Btn onClick={handleConfirmVirtual} className="flex-1">
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
                                <label className="block mb-2 text-slate-900 font-bold text-sm">Motivo de cancelación (opcional)</label>
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
                                onClick={() => action.confirm()}
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

                {/* ─── Edit Event Modal ─── */}
                <Modal open={!!editingEvent} onClose={() => setEditingEvent(null)} title="Editar Evento" subtitle={editingEvent?.title} maxWidth="max-w-lg">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            {["taller", "conferencia"].map(t => (
                                <button key={t} onClick={() => setEditEvType(t)}
                                    className={`py-2.5 rounded-xl border-2 cursor-pointer capitalize font-bold text-sm transition-all ${editEvType === t ? "border-violet-600 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-500"}`}>
                                    {t}
                                </button>
                            ))}
                        </div>
                        <div>
                            <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Título <span className="text-rose-500">*</span></label>
                            <input type="text" value={editEvTitle} onChange={e => setEditEvTitle(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Descripción</label>
                            <textarea value={editEvDesc} onChange={e => setEditEvDesc(e.target.value)} rows={3} className={`${inputCls} resize-none`} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Fecha <span className="text-rose-500">*</span></label>
                                <input type="date" value={editEvDate} onChange={e => setEditEvDate(e.target.value)} className={inputCls} />
                            </div>
                            <div>
                                <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Hora</label>
                                <input type="time" value={editEvTime} onChange={e => setEditEvTime(e.target.value)} className={inputCls} />
                            </div>
                        </div>
                        {editEvType === "taller" && (
                            <div>
                                <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Enlace de Registro</label>
                                <input type="url" value={editEvRegUrl} onChange={e => setEditEvRegUrl(e.target.value)} placeholder="https://forms.gle/..." className={inputCls} />
                            </div>
                        )}
                        <div>
                            <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Cambiar imagen (opcional)</label>
                            <input type="file" accept="image/*" onChange={e => setEditEvImg(e.target.files?.[0] || null)}
                                className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100 cursor-pointer" />
                            {editEvImg && <p className="text-xs text-slate-400 mt-1">{editEvImg.name}</p>}
                        </div>
                        <div className="flex gap-3 pt-2">
                            <Btn variant="ghost" onClick={() => setEditingEvent(null)} className="flex-1">Cancelar</Btn>
                            <Btn onClick={handleSaveEvent} className="flex-1 bg-violet-600 hover:bg-violet-700 text-white shadow-violet-600/20">Guardar Cambios</Btn>
                        </div>
                    </div>
                </Modal>

                {/* ─── Edit Resource Modal ─── */}
                <Modal open={!!editingResource} onClose={() => setEditingResource(null)} title="Editar Recurso" subtitle={editingResource?.title} maxWidth="max-w-md">
                    <div className="space-y-4">
                        <div>
                            <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Título <span className="text-rose-500">*</span></label>
                            <input type="text" value={editRTitle} onChange={e => setEditRTitle(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                            <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Descripción</label>
                            <textarea value={editRDesc} onChange={e => setEditRDesc(e.target.value)} rows={3} className={`${inputCls} resize-none`} />
                        </div>
                        {editingResource?.type !== "image" && (
                            <div>
                                <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Enlace</label>
                                <input type="url" value={editRUrl} onChange={e => setEditRUrl(e.target.value)} placeholder="https://..." className={inputCls} />
                            </div>
                        )}
                        {editingResource?.type !== "link" && (
                            <div>
                                <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Cambiar archivo (opcional)</label>
                                <input type="file" onChange={e => setEditRFile(e.target.files?.[0] || null)}
                                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer" />
                                {editRFile && <p className="text-xs text-slate-400 mt-1">{editRFile.name}</p>}
                            </div>
                        )}
                        <div className="flex gap-3 pt-2">
                            <Btn variant="ghost" onClick={() => setEditingResource(null)} className="flex-1">Cancelar</Btn>
                            <Btn onClick={handleSaveResource} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20">Guardar Cambios</Btn>
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
                {appt.status === "Completada" && appt.notes && (
                    <div className="mt-2 flex items-start gap-2 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800">
                        <ClipboardList className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-[0.65rem] font-bold text-indigo-400 uppercase tracking-wider mb-0.5">Notas clínicas</p>
                            <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">{appt.notes}</p>
                        </div>
                    </div>
                )}
                {appt.status === "Cancelada" && appt.notes && (
                    <div className="mt-2 flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-900/20 rounded-xl border border-rose-100 dark:border-rose-800">
                        <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-[0.65rem] font-bold text-rose-400 uppercase tracking-wider mb-0.5">Motivo de cancelación</p>
                            <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">{appt.notes}</p>
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
