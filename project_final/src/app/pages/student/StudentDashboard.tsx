import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
    CalendarCheck, Clock, CheckCircle2, BookOpen, RefreshCw,
    AlertTriangle, Info, Video, Users, ChevronLeft, ChevronRight,
    Calendar, Plus, Brain, GraduationCap, Apple,
    ExternalLink, Image as ImageIcon, Maximize2,
} from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useStore } from "../../../context/StoreContext";
import { AppShell } from "../../components/layout/AppShell";
import { Btn, StatCard, TabNav, Modal, MiniCalendar, StatusBadge, inputCls, Avatar, EmptyState } from "../../components/ui";
import { DEPT_CONFIG, DEPT_REASONS } from "../../../constants";
import { useAppointmentWizard, useReschedule, useCancelAppointment } from "../../hooks";
import type { AppEvent } from "../../../types";

function getVideoEmbedUrl(url: string): string | null {
    try {
        const u = new URL(url);
        // YouTube
        if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) {
            const id = u.hostname.includes("youtu.be")
                ? u.pathname.slice(1)
                : u.searchParams.get("v") || u.pathname.split("/").pop();
            return id ? `https://www.youtube.com/embed/${id}` : null;
        }
        // Vimeo
        if (u.hostname.includes("vimeo.com")) {
            const id = u.pathname.split("/").pop();
            return id ? `https://player.vimeo.com/video/${id}` : null;
        }
        return null;
    } catch {
        return null;
    }
}

// ── Carousel static slides ────────────────────────────────
interface CarouselSlide extends AppEvent { gradient?: string; _static?: boolean; }

const WELCOME_SLIDE: CarouselSlide = {
    id: "__welcome__", _static: true,
    type: "bienvenida", department: "TECNL", date: "", time: "",
    title: "Sistema de Citas TECNL",
    description: "Agenda citas con Psicología, Tutorías y Nutrición. Tu bienestar académico es nuestra prioridad.",
    gradient: "from-blue-950 via-slate-900 to-teal-900",
};

const PLACEHOLDER_SLIDE: CarouselSlide = {
    id: "__placeholder__", _static: true,
    type: "placeholder", department: "Institucional", date: "", time: "",
    title: "Próximamente Eventos",
    description: "El equipo está preparando talleres, conferencias y actividades para ti. ¡Mantente pendiente!",
    gradient: "from-slate-900 via-indigo-950 to-slate-900",
};

// Dept data for wizard step 1
const DEPARTMENTS = [
    { key: "Psicología", icon: Brain, color: "from-blue-500 to-blue-700" },
    { key: "Tutorías", icon: GraduationCap, color: "from-emerald-500 to-teal-600" },
    { key: "Nutrición", icon: Apple, color: "from-amber-500 to-orange-500" },
];

export function StudentDashboard() {
    const { user } = useAuth();
    const { getAppointments, updateAppointmentStatus, events, resources, getStats, specialists } = useStore();

    // ── UI state ──────────────────────────────────────────
    const [activeApptTab, setActiveApptTab] = useState("proximas");
    const [activeResTab, setActiveResTab] = useState("Psicología");
    const [activeBannerIndex, setActiveBannerIndex] = useState(0);
    const [showResources, setShowResources] = useState(false);
    const [previewImg, setPreviewImg] = useState<{ url: string; title: string } | null>(null);
    const [videoModal, setVideoModal] = useState<{ embedUrl: string; title: string } | null>(null);
    const [showConfModal, setShowConfModal] = useState(false);
    const [selConf, setSelConf] = useState<AppEvent | null>(null);
    const resourcesRef = useRef<HTMLDivElement>(null);

    // ── Derived data ──────────────────────────────────────
    const appointments = getAppointments({ studentId: user?.id });
    const proximas = appointments.filter(a => a.status === "Pendiente" || a.status === "Confirmada");
    const historial = appointments.filter(a => a.status === "Completada" || a.status === "Cancelada");

    const stats = [
        { label: "Pendientes", value: appointments.filter(a => a.status === "Pendiente").length, icon: Clock, bg: "bg-gradient-to-br from-[#EA580C] to-[#f97316]" },
        { label: "Confirmadas", value: appointments.filter(a => a.status === "Confirmada").length, icon: CheckCircle2, bg: "bg-gradient-to-br from-[#16A34A] to-[#22c55e]" },
        { label: "Completadas", value: appointments.filter(a => a.status === "Completada").length, icon: CalendarCheck, bg: "bg-gradient-to-br from-[#2563EB] to-[#3b82f6]" },
    ];

    // ── Hooks ─────────────────────────────────────────────
    const wizard = useAppointmentWizard();
    const resch = useReschedule("student");
    const cancel = useCancelAppointment();

    // ── Carousel slides (welcome always first; placeholder when no events) ──
    const slides: CarouselSlide[] = [
        WELCOME_SLIDE,
        ...(events.length > 0 ? events : [PLACEHOLDER_SLIDE]),
    ];

    // ── Banner auto-rotation ──────────────────────────────
    useEffect(() => {
        if (slides.length <= 1) return;
        const t = setInterval(() => setActiveBannerIndex(p => (p + 1) % slides.length), 5000);
        return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slides.length]);

    if (!user) return null;

    return (
        <AppShell>
            <div className="space-y-8 max-w-7xl mx-auto w-full pb-28">

                {/* ── Page Header ── */}
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                        Bienvenido(a), <span className="text-blue-600">{user.name?.split(" ")[0]}</span>
                    </h1>
                    <p className="text-slate-500 mt-1 font-medium">
                        {user.carrera || "Estudiante"}
                        <span className="mx-2 text-slate-300 dark:text-slate-600">•</span> Semestre {user.semestre || "—"}
                        <span className="mx-2 text-slate-300 dark:text-slate-600">•</span> No. Control: {user.matricula || "—"}
                    </p>
                </div>

                {/* ── Banner Carousel ── */}
                <div className="relative bg-white rounded-[2rem] sm:rounded-[2.5rem] overflow-hidden shadow-xl shadow-blue-900/10 border border-slate-100 group aspect-[1/1] sm:aspect-[21/9] lg:aspect-[3/1]">
                    <div
                        className="flex h-full transition-transform duration-700 ease-out"
                        style={{ transform: `translateX(-${activeBannerIndex * 100}%)` }}
                    >
                        {slides.map(slide => (
                            <div key={slide.id} className="relative w-full h-full shrink-0 overflow-hidden">
                                {/* Background: gradient for static slides, image for events */}
                                {slide.imageUrl ? (
                                    <>
                                        <img src={slide.imageUrl} alt={slide.title} className="absolute inset-0 w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
                                    </>
                                ) : (
                                    <div className={`absolute inset-0 bg-gradient-to-br ${slide.gradient}`}>
                                        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
                                        <div className="absolute bottom-0 left-0 w-72 h-72 bg-white/5 rounded-full blur-3xl" />
                                        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSIvPjwvc3ZnPg==')] opacity-60" />
                                    </div>
                                )}

                                {/* Content */}
                                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 sm:p-12 text-center z-10">
                                    <div className="max-w-4xl space-y-4 sm:space-y-6 animate-in fade-in zoom-in-95 duration-1000 delay-300">
                                        {slide._static ? (
                                            /* ── Static slide content ── */
                                            <>
                                                <div className="flex justify-center">
                                                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-xl">
                                                        {slide.id === "__welcome__"
                                                            ? <CalendarCheck className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
                                                            : <Calendar className="w-8 h-8 sm:w-10 sm:h-10 text-white/70" />
                                                        }
                                                    </div>
                                                </div>
                                                <h2 className="text-2xl sm:text-5xl font-black text-white leading-tight drop-shadow-2xl uppercase italic tracking-tighter">
                                                    {slide.title}
                                                </h2>
                                                <p className="text-white/70 text-base md:text-lg font-medium max-w-2xl mx-auto">
                                                    {slide.description}
                                                </p>
                                                {slide.id === "__welcome__" && (
                                                    <>
                                                        <div className="pt-4 flex items-center justify-center">
                                                            <Btn size="lg"
                                                                onClick={() => { wizard.setShow(true); wizard.reset(); }}
                                                                className="bg-white text-slate-900 hover:bg-white/90 border-0 shadow-2xl px-10 py-4 uppercase italic font-black tracking-tighter transform hover:scale-105 transition-transform active:scale-95">
                                                                Solicitar Cita
                                                            </Btn>
                                                        </div>
                                                        <div className="flex items-center justify-center gap-6 pt-4 border-t border-white/10 w-fit mx-auto">
                                                            {["Psicología", "Tutorías", "Nutrición"].map(d => (
                                                                <span key={d} className="text-white/50 text-xs font-black uppercase tracking-widest">{d}</span>
                                                            ))}
                                                        </div>
                                                    </>
                                                )}
                                                {slide.id === "__placeholder__" && (
                                                    <div className="flex items-center justify-center gap-2 text-white/40 text-xs font-black uppercase tracking-[0.3em] pt-4 border-t border-white/10 w-fit mx-auto">
                                                        <Clock className="w-4 h-4" /> Muy pronto
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            /* ── Real event content ── */
                                            <>
                                                <div className="flex justify-center gap-2">
                                                    <span className={`px-3 py-1 rounded-full text-[0.7rem] font-black uppercase tracking-[0.2em] shadow-lg ${slide.type === "conferencia" ? "bg-violet-600 text-white" : "bg-blue-600 text-white"}`}>
                                                        {slide.type}
                                                    </span>
                                                    <span className="px-3 py-1 rounded-full bg-white/20 backdrop-blur-md text-white text-[0.7rem] font-black uppercase tracking-[0.2em] border border-white/20">
                                                        {slide.department}
                                                    </span>
                                                </div>
                                                <h2 className="text-2xl sm:text-5xl font-black text-white leading-tight drop-shadow-2xl uppercase italic tracking-tighter">
                                                    {slide.title}
                                                </h2>
                                                <p className="text-white/90 text-base md:text-lg font-medium line-clamp-2 max-w-2xl mx-auto hidden sm:block">
                                                    {slide.description}
                                                </p>
                                                <div className="pt-4 flex items-center justify-center gap-4">
                                                    <Btn size="lg"
                                                        onClick={() => {
                                                            if (slide.type === "taller" && slide.registrationUrl) window.open(slide.registrationUrl, "_blank");
                                                            else if (slide.type === "conferencia") { setSelConf(slide); setShowConfModal(true); }
                                                            else toast.success("¡Registrado en el evento!");
                                                        }}
                                                        className="bg-slate-900 text-white hover:bg-black border-0 shadow-2xl px-12 py-4 uppercase italic font-black tracking-tighter transform hover:scale-105 transition-transform active:scale-95">
                                                        {slide.type === "conferencia" ? "Más información" : "¡Registrarme Ahora!"}
                                                    </Btn>
                                                </div>
                                                <div className="flex items-center justify-center gap-2 text-white/70 text-xs font-black uppercase italic tracking-[0.3em] pt-4 border-t border-white/10 w-fit mx-auto">
                                                    <Clock className="w-4 h-4" />
                                                    {new Date(slide.date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long" })}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Dots */}
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2.5 z-20">
                        {slides.map((_, i) => (
                            <button key={i} onClick={() => setActiveBannerIndex(i)}
                                className={`w-3 h-3 rounded-full transition-all duration-300 border-2 ${i === activeBannerIndex ? "bg-white border-white w-8" : "bg-white/20 border-white/40 hover:bg-white/40"}`}
                            />
                        ))}
                    </div>

                    {/* Arrows */}
                    <button onClick={() => setActiveBannerIndex(p => (p - 1 + slides.length) % slides.length)}
                        className="absolute left-6 top-1/2 -translate-y-1/2 p-3 bg-white/10 backdrop-blur-md hover:bg-white/20 text-white rounded-2xl border border-white/10 opacity-0 group-hover:opacity-100 hidden sm:block">
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button onClick={() => setActiveBannerIndex(p => (p + 1) % slides.length)}
                        className="absolute right-6 top-1/2 -translate-y-1/2 p-3 bg-white/10 backdrop-blur-md hover:bg-white/20 text-white rounded-2xl border border-white/10 opacity-0 group-hover:opacity-100 hidden sm:block">
                        <ChevronRight className="w-6 h-6" />
                    </button>
                </div>

                {/* ── Stats ── */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {stats.map(s => <StatCard key={s.label} label={s.label.toUpperCase()} value={s.value} icon={s.icon} gradient={s.bg} />)}
                </div>

                {/* ── Appointments ── */}
                <div className="mt-8">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Mis Citas</h3>
                    <div className="flex items-center justify-between">
                        <TabNav
                            tabs={[
                                { key: "proximas", label: `Próximas (${proximas.length})` },
                                { key: "historial", label: `Historial (${historial.length})` },
                            ]}
                            active={activeApptTab}
                            onSelect={setActiveApptTab}
                        />
                        <Btn variant="outline" onClick={() => setShowResources(true)} size="sm" className="shrink-0 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:border-blue-500 hover:text-blue-600 dark:hover:border-blue-400 dark:hover:text-blue-400">
                            <BookOpen className="w-4 h-4" /> Mis Recursos
                        </Btn>
                    </div>

                    <div className="mt-6 space-y-4">
                        {activeApptTab === "proximas" && (
                            proximas.length === 0 ? (
                                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
                                    <EmptyState icon={CalendarCheck} title="No tienes citas próximas" subtitle="Solicita una cita usando el botón de arriba" />
                                </div>
                            ) : proximas.map(appt => {
                                const apptDate = new Date(appt.date + "T12:00:00");
                                const today = new Date(); today.setHours(0, 0, 0, 0);
                                const isPast = apptDate < today;
                                const apptDateTime = new Date(`${appt.date}T${appt.time}:00`);
                                const hoursUntil = (apptDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
                                const isWithin24h = hoursUntil >= 0 && hoursUntil < 24;
                                return (
                                <div key={appt.id} className={`bg-white dark:bg-slate-800 rounded-2xl border shadow-sm p-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:shadow-md transition-shadow ${isPast ? "border-rose-100 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-900/10" : "border-slate-200 dark:border-slate-700"}`}>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <p className="font-bold text-slate-900 dark:text-white">{appt.department}</p>
                                            {isPast ? (
                                                <StatusBadge status="Sin atender" />
                                            ) : (
                                                <StatusBadge status={appt.status} />
                                            )}
                                        </div>
                                        <p className="text-slate-500 dark:text-slate-300 text-sm">{appt.specialistName}</p>
                                        <p className="text-slate-400 dark:text-slate-400 text-xs mt-1">
                                            {apptDate.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })} — {appt.time}
                                        </p>
                                        {appt.motivo && <p className="text-slate-400 dark:text-slate-400 text-xs mt-0.5">Motivo: {appt.motivo}</p>}
                                        {appt.status === "Confirmada" && appt.modality === "Virtual" && (() => {
                                            const specData = specialists.find(s => s.id === appt.specialistId);
                                            return specData?.meetingUrl ? (
                                                <a href={specData.meetingUrl} target="_blank" rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1.5 mt-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800">
                                                    <Video className="w-3.5 h-3.5" /> Unirse a videollamada
                                                </a>
                                            ) : (
                                                <p className="text-blue-500 text-xs mt-1 flex items-center gap-1">
                                                    <Video className="w-3.5 h-3.5" /> Cita virtual — el especialista compartirá el enlace
                                                </p>
                                            );
                                        })()}
                                        {isPast && (
                                            <p className="text-rose-500 text-xs mt-1 font-medium">El especialista debe registrar el resultado de esta sesión.</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {!isPast && (
                                            <>
                                                <Btn size="sm" variant="ghost" onClick={() => resch.open(appt.id)}>
                                                    <RefreshCw className="w-3.5 h-3.5" /> Reagendar
                                                </Btn>
                                                {appt.status === "Pendiente" && (
                                                    isWithin24h ? (
                                                        <span className="text-xs text-amber-700 font-medium px-2 py-1 bg-amber-50 rounded-lg border border-amber-200">
                                                            No cancelable — menos de 24h
                                                        </span>
                                                    ) : (
                                                        <Btn size="sm" variant="rose" onClick={() => cancel.open(appt.id)}>
                                                            Cancelar
                                                        </Btn>
                                                    )
                                                )}
                                                {appt.status === "Confirmada" && (
                                                    <span className="text-xs text-slate-500 dark:text-slate-400 font-medium px-2 py-1 bg-slate-50 dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600">
                                                        Confirmada — contacta al especialista
                                                    </span>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                                );
                            })
                        )}

                        {activeApptTab === "historial" && (
                            historial.length === 0 ? (
                                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
                                    <EmptyState icon={CalendarCheck} title="Sin historial de citas" />
                                </div>
                            ) : historial.map(appt => {
                                const isLate = appt.status === "Completada" &&
                                    appt.updatedAt &&
                                    appt.updatedAt.split("T")[0] > appt.date;
                                return (
                                <div key={appt.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 flex items-center gap-4 opacity-80">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                                            <p className="font-bold text-slate-900 dark:text-white">{appt.department}</p>
                                            <StatusBadge status={appt.status} />
                                            {isLate && <StatusBadge status="Sesión tardía" />}
                                        </div>
                                        <p className="text-slate-500 dark:text-slate-300 text-sm">{appt.specialistName}</p>
                                        <p className="text-slate-400 dark:text-slate-400 text-xs mt-1">
                                            {new Date(appt.date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })} — {appt.time}
                                        </p>
                                        {appt.status === "Cancelada" && appt.notes && (
                                            <div className="mt-2 flex items-start gap-2 p-2.5 bg-rose-50 rounded-xl border border-rose-100">
                                                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                                                <div>
                                                    <p className="text-[0.65rem] font-bold text-rose-400 uppercase tracking-wider mb-0.5">Motivo de cancelación</p>
                                                    <p className="text-slate-600 text-xs leading-relaxed">{appt.notes}</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* ── New Appointment Wizard ── */}
                <Modal open={wizard.show} onClose={() => { wizard.setShow(false); wizard.reset(); }} title="Solicitar Cita" maxWidth="max-w-2xl">
                    {/* Step indicators */}
                    <div className="flex items-center gap-2 mb-6">
                        {[1, 2, 3].map(n => (
                            <div key={n} className={`h-1.5 flex-1 rounded-full transition-all ${wizard.step >= n ? "bg-blue-600" : "bg-slate-200"}`} />
                        ))}
                    </div>

                    {wizard.step === 1 && (
                        <div className="space-y-4">
                            <p className="font-bold text-slate-900 text-lg">¿Con qué departamento?</p>
                            <div className="grid gap-3">
                                {DEPARTMENTS.map(d => (
                                    <button key={d.key} onClick={() => { wizard.setSelDept(d.key); wizard.setStep(2); }}
                                        className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer text-left ${wizard.selDept === d.key ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                                        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${d.color} flex items-center justify-center shrink-0`}>
                                            <d.icon className="w-6 h-6 text-white" />
                                        </div>
                                        <p className="font-bold text-slate-900 text-base">{d.key}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {wizard.step === 2 && wizard.selDept && (
                        <div className="space-y-5">
                            <button onClick={() => wizard.setStep(1)} className="text-slate-500 text-sm flex items-center gap-1 hover:text-slate-700 cursor-pointer">
                                <ChevronLeft className="w-4 h-4" /> Cambiar departamento
                            </button>
                            <p className="font-bold text-slate-900 text-lg">Elige especialista, fecha y horario</p>

                            {/* Specialist selection */}
                            <div className="space-y-2">
                                {wizard.deptSpecialists.map(s => (
                                    <button key={s.id} onClick={() => wizard.setSelSpecId(s.id)}
                                        className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer text-left ${wizard.selSpecId === s.id ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:border-slate-300"}`}>
                                        <Avatar name={s.name} size="md" avatarUrl={s.avatarUrl} />
                                        <div>
                                            <p className="font-bold text-slate-900 text-sm">{s.name}</p>
                                            <p className="text-slate-400 text-xs">{s.shift} • {s.email}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            {/* Date picker */}
                            {wizard.selSpecId && (
                                <div>
                                    <p className="font-bold text-slate-700 text-sm mb-2">Selecciona una fecha disponible</p>
                                    <MiniCalendar selectedDate={wizard.selDate} onSelect={wizard.setSelDate} availableDates={wizard.availDates} onMonthChange={wizard.handleMonthChange} />
                                </div>
                            )}

                            {/* Slots */}
                            {wizard.selDate && wizard.slotsForDate.length > 0 && (
                                <div>
                                    <p className="font-bold text-slate-700 text-sm mb-2">Selecciona un horario</p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {wizard.slotsForDate.map(slot => (
                                            <button key={slot.start} onClick={() => wizard.setSelSlot(slot.start)}
                                                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 font-bold text-sm transition-all cursor-pointer ${wizard.selSlot === slot.start ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300"}`}>
                                                <Clock className="w-3.5 h-3.5" />{slot.start}–{slot.end}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <Btn className="w-full" disabled={!wizard.selSpecId || !wizard.selDate || !wizard.selSlot} onClick={() => wizard.setStep(3)}>
                                Continuar
                            </Btn>
                        </div>
                    )}

                    {wizard.step === 3 && (
                        <div className="space-y-5">
                            <button onClick={() => wizard.setStep(2)} className="text-slate-500 text-sm flex items-center gap-1 hover:text-slate-700 cursor-pointer">
                                <ChevronLeft className="w-4 h-4" /> Volver
                            </button>

                            {/* Specialist summary */}
                            {wizard.deptSpecialists.filter(s => s.id === wizard.selSpecId).map(selSpec => (
                                <div key={selSpec.id} className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                                    <Avatar name={selSpec.name} size="lg" avatarUrl={selSpec.avatarUrl} />
                                    <div className="min-w-0">
                                        <p className="font-bold text-slate-900 text-sm">{selSpec.name}</p>
                                        <p className="text-slate-500 text-xs">{selSpec.department}</p>
                                        <p className="text-blue-600 text-xs font-semibold mt-0.5">
                                            {wizard.selDate
                                                ? new Date(wizard.selDate.getTime() - wizard.selDate.getTimezoneOffset() * 60000)
                                                    .toISOString().split("T")[0]
                                                    .split("-").reverse().join("/")
                                                : ""} · {wizard.selSlot}
                                        </p>
                                    </div>
                                </div>
                            ))}

                            {/* Reason */}
                            {wizard.selDept && DEPT_REASONS[wizard.selDept] && (
                                <div>
                                    <p className="font-bold text-slate-900 mb-2">Motivo de la cita</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {DEPT_REASONS[wizard.selDept].map((r: string) => (
                                            <button key={r} onClick={() => wizard.setSelReason(r)}
                                                className={`p-3 rounded-xl border-2 text-sm text-left transition-all cursor-pointer ${wizard.selReason === r ? "border-blue-600 bg-blue-50 text-blue-700 font-bold" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}>
                                                {r}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Modality */}
                            <div>
                                <p className="font-bold text-slate-900 mb-2">Modalidad</p>
                                <div className="grid grid-cols-2 gap-3">
                                    {["Presencial", "Virtual"].map(m => (
                                        <button key={m} onClick={() => wizard.setSelModality(m)}
                                            className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-bold text-sm transition-all cursor-pointer ${wizard.selModality === m ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-100 text-slate-500 hover:border-slate-300"}`}>
                                            {m === "Virtual" ? <Video className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                                            {m}
                                        </button>
                                    ))}
                                </div>
                                {wizard.selModality === "Virtual" && (() => {
                                    const selSpec = wizard.deptSpecialists.find(s => s.id === wizard.selSpecId);
                                    return (
                                        <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-2">
                                            <Video className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                                            <div className="text-sm">
                                                <p className="font-bold text-blue-800">Cita virtual</p>
                                                <p className="text-blue-600 mt-0.5">El enlace de videollamada te será enviado por correo al confirmar tu cita.</p>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Confidentiality */}
                            <label className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl border border-blue-100 cursor-pointer">
                                <input type="checkbox" checked={wizard.confidentialityAccepted} onChange={e => wizard.setConfidentialityAccepted(e.target.checked)}
                                    className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 mt-0.5" />
                                <p className="text-blue-800 text-sm">Acepto el aviso de confidencialidad. La información compartida será tratada de forma privada.</p>
                            </label>

                            <Btn className="w-full" disabled={!wizard.selReason || !wizard.confidentialityAccepted} onClick={wizard.confirm}>
                                Confirmar Cita
                            </Btn>
                        </div>
                    )}

                    {wizard.step === 4 && (
                        <div className="text-center py-8">
                            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                            </div>
                            <h3 className="text-2xl font-bold text-slate-900 mb-2">¡Cita solicitada!</h3>
                            <p className="text-slate-500 mb-6">Tu solicitud ha sido enviada. El especialista la revisará pronto.</p>
                            <Btn onClick={() => { wizard.setShow(false); wizard.reset(); }}>Entendido</Btn>
                        </div>
                    )}
                </Modal>

                {/* ── Reschedule Modal ── */}
                <Modal open={resch.show} onClose={() => resch.setShow(false)} title="Reagendar Cita" maxWidth="max-w-lg">
                    <div className="space-y-5">
                        <MiniCalendar selectedDate={resch.date} onSelect={resch.setDate} availableDates={resch.availDates} onMonthChange={resch.handleMonthChange} />
                        {resch.date && (
                            resch.slots.length > 0 ? (
                                <div className="grid grid-cols-3 gap-2">
                                    {resch.slots.map(slot => (
                                        <button key={slot.start} onClick={() => resch.setSlot(slot.start)}
                                            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 font-bold text-sm transition-all cursor-pointer ${resch.slot === slot.start ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-600 hover:border-blue-300"}`}>
                                            <Clock className="w-3.5 h-3.5" />{slot.start}–{slot.end}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-center text-slate-400 text-sm py-4">Sin horarios disponibles para este día</p>
                            )
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            {["Presencial", "Virtual"].map(m => (
                                <button key={m} onClick={() => resch.setSelModality(m)}
                                    className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-bold text-sm transition-all cursor-pointer ${resch.selModality === m ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500"}`}>
                                    {m === "Virtual" ? <Video className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                                    {m}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-3">
                            <Btn variant="ghost" onClick={() => resch.setShow(false)} className="flex-1">Cancelar</Btn>
                            <Btn disabled={!resch.slot} onClick={() => { resch.confirm(); toast.success("Cita reagendada exitosamente"); }} className="flex-1">
                                Confirmar
                            </Btn>
                        </div>
                    </div>
                </Modal>

                {/* ── Cancel Modal ── */}
                <Modal open={cancel.show} onClose={cancel.close} title="¿Cancelar tu cita?" subtitle="Considera reagendar para no perder seguimiento.">
                    <div className="space-y-6 mt-2">
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3">
                            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-amber-800 text-sm">Si cancelas definitivamente tendrás que solicitar una nueva cita desde cero.</p>
                        </div>
                        <div>
                            <label className="block text-slate-700 font-bold text-sm mb-2">Motivo de cancelación</label>
                            <textarea value={cancel.reason} onChange={e => cancel.setReason(e.target.value)}
                                placeholder="Ej. Problemas de salud, choque con clases..."
                                className="w-full p-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all resize-none text-sm"
                                rows={3} />
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-slate-100">
                            <Btn variant="ghost" onClick={cancel.close} className="flex-1">Volver</Btn>
                            <Btn variant="outline" onClick={() => { cancel.close(); resch.open(cancel.apptId!); }} className="flex-1 text-blue-600 border-blue-200 hover:bg-blue-50">
                                <RefreshCw className="w-4 h-4" /> Reagendar
                            </Btn>
                            <Btn className="flex-1 bg-rose-600 hover:bg-rose-700" disabled={cancel.reason.trim().length < 5} onClick={cancel.confirm}>
                                Cancelar Cita
                            </Btn>
                        </div>
                    </div>
                </Modal>

                {/* ── Conference Modal ── */}
                <Modal open={showConfModal} onClose={() => setShowConfModal(false)} title="Información de la Conferencia" maxWidth="max-w-2xl">
                    {selConf && (
                        <div className="space-y-6">
                            <div className="relative aspect-video rounded-2xl overflow-hidden shadow-lg border border-slate-200">
                                <img src={selConf.imageUrl} alt={selConf.title} className="w-full h-full object-cover" />
                                <div className="absolute top-4 left-4 flex gap-2">
                                    <span className="px-3 py-1 bg-violet-600 text-white text-[0.6rem] font-black uppercase tracking-wider rounded-full shadow-md">Conferencia</span>
                                    <span className="px-3 py-1 bg-white/90 text-slate-900 text-[0.6rem] font-black uppercase rounded-full shadow-sm border border-slate-200">{selConf.department}</span>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <h2 className="text-2xl font-black text-slate-900 uppercase italic">{selConf.title}</h2>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                        <Calendar className="w-5 h-5 text-blue-600" />
                                        <div>
                                            <p className="text-[0.6rem] font-bold text-slate-400 uppercase">Fecha</p>
                                            <p className="text-sm font-bold text-slate-700">{new Date(selConf.date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                        <Clock className="w-5 h-5 text-blue-600" />
                                        <div>
                                            <p className="text-[0.6rem] font-bold text-slate-400 uppercase">Hora</p>
                                            <p className="text-sm font-bold text-slate-700">{selConf.time || "Por confirmar"}</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="p-5 bg-blue-50/50 rounded-2xl border border-blue-100">
                                    <h4 className="text-blue-900 text-xs font-black uppercase tracking-widest mb-3 flex items-center gap-2">
                                        <Info className="w-4 h-4" /> Descripción
                                    </h4>
                                    <p className="text-slate-600 text-sm leading-relaxed whitespace-pre-wrap">{selConf.description}</p>
                                </div>
                                <Btn onClick={() => { setShowConfModal(false); toast.success("¡Interés registrado!"); }}
                                    className="w-full bg-slate-900 text-white hover:bg-black font-black uppercase italic tracking-widest py-4 rounded-2xl shadow-xl">
                                    ¡Registrarme Ahora!
                                </Btn>
                            </div>
                        </div>
                    )}
                </Modal>

                {/* ── Resources Modal ── */}
                <Modal
                    open={showResources}
                    onClose={() => setShowResources(false)}
                    title="Materiales y Recursos Educativos"
                    subtitle="Explora contenido de apoyo por departamento"
                    maxWidth="max-w-5xl"
                >
                    <div className="space-y-6">
                        <TabNav
                            tabs={Object.keys(DEPT_CONFIG).map(d => ({ key: d, label: d }))}
                            active={activeResTab}
                            onSelect={setActiveResTab}
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 min-h-[400px]">
                            {resources.filter(r => r.department === activeResTab).map(item => (
                                <div key={item.id} className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all duration-300 overflow-hidden group">
                                    {item.type === "image" && item.imageUrl && (
                                        <div className="h-36 overflow-hidden bg-slate-100">
                                            <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                        </div>
                                    )}
                                    <div className="p-5">
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className={`p-1.5 rounded-md ${item.type === "video" ? "bg-rose-100" : item.type === "link" ? "bg-blue-100" : "bg-emerald-100"}`}>
                                                {item.type === "video" && <Video className="w-3.5 h-3.5 text-rose-600" />}
                                                {item.type === "link" && <ExternalLink className="w-3.5 h-3.5 text-blue-600" />}
                                                {item.type === "image" && <ImageIcon className="w-3.5 h-3.5 text-emerald-600" />}
                                            </div>
                                            <span className="text-slate-400 font-bold uppercase tracking-wider text-[0.65rem]">
                                                {item.type === "image" ? "Imagen" : item.type === "video" ? "Video" : "Enlace"}
                                            </span>
                                        </div>
                                        <p className="text-slate-900 dark:text-white font-bold leading-tight mb-2">{item.title}</p>
                                        <p className="text-slate-500 text-sm leading-relaxed line-clamp-3">{item.description}</p>
                                        <div className="mt-4 pt-4 border-t border-slate-50 dark:border-slate-700">
                                            <Btn
                                                variant="outline"
                                                className="w-full text-blue-600 border-blue-100 hover:bg-blue-50"
                                                onClick={() => {
                                                    if (item.type === "image") {
                                                        const src = item.imageUrl || item.fileUrl;
                                                        setPreviewImg({ url: src || "", title: item.title });
                                                    } else if (item.type === "video") {
                                                        const embedUrl = getVideoEmbedUrl(item.url);
                                                        if (embedUrl) {
                                                            setVideoModal({ embedUrl, title: item.title });
                                                        } else {
                                                            window.open(item.url, "_blank");
                                                        }
                                                    } else {
                                                        const link = item.fileUrl || item.url;
                                                        if (link && link !== "#") {
                                                            window.open(link, "_blank");
                                                        } else {
                                                            toast.error("Este recurso no tiene un archivo o enlace válido.");
                                                        }
                                                    }
                                                }}
                                            >
                                                <Maximize2 className="w-4 h-4" />
                                                {item.type === "image" ? "Ver imagen" : item.type === "video" ? "Ver video" : "Abrir enlace"}
                                            </Btn>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {resources.filter(r => r.department === activeResTab).length === 0 && (
                                <div className="col-span-full flex flex-col items-center justify-center py-20 text-slate-400 border-2 border-dashed border-slate-100 rounded-3xl">
                                    <BookOpen className="w-12 h-12 mb-3 opacity-20" />
                                    <p className="font-medium">No hay recursos disponibles para este departamento actualmente.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Preview modal — nested inside resources modal, same as original */}
                    <Modal
                        open={!!previewImg}
                        onClose={() => setPreviewImg(null)}
                        title={previewImg?.title || "Vista Previa"}
                        maxWidth="max-w-4xl"
                    >
                        {previewImg && (
                            <div className="rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center p-2">
                                <img
                                    src={previewImg.url}
                                    alt={previewImg.title}
                                    className="w-full max-h-[75vh] object-contain rounded-xl shadow-inner"
                                />
                            </div>
                        )}
                    </Modal>
                </Modal>

            </div>

            {/* ── Video player modal ── */}
            <Modal
                open={!!videoModal}
                onClose={() => setVideoModal(null)}
                title={videoModal?.title || "Video"}
                maxWidth="max-w-4xl"
            >
                {videoModal && (
                    <div className="aspect-video w-full rounded-2xl overflow-hidden bg-black shadow-lg">
                        <iframe
                            src={videoModal.embedUrl}
                            title={videoModal.title}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            className="w-full h-full"
                        />
                    </div>
                )}
            </Modal>

            {/* ── FAB: Solicitar Cita ── */}
            <button
                onClick={() => { wizard.setShow(true); wizard.reset(); }}
                className="fixed bottom-8 right-8 z-50 flex items-center gap-3 px-6 py-4 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-2xl shadow-2xl shadow-blue-600/40 font-bold text-sm transition-all hover:-translate-y-0.5 group"
            >
                <CalendarCheck className="w-5 h-5 shrink-0" />
                <span>Solicitar Cita</span>
            </button>

        </AppShell>
    );
}
