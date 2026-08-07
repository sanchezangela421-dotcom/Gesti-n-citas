import { useState } from "react";
import { toast } from "sonner";
import { Megaphone, CheckCircle2, CalendarDays, Users, Pencil, Trash2, Image as ImageIcon, Plus } from "lucide-react";
import { useStore } from "../../../context/StoreContext";
import { useDepartments } from "../../hooks/useDepartments";
import { Btn, Modal, EmptyState, inputCls } from "../../components/ui";
import { API, authHeaders, getUploadUrl } from "../../../lib/api";
import type { AppEvent, EventRegistrant } from "../../../types";

// Pestaña "Publicar Evento" del admin — aislada para que el formulario, la lista
// de inscritos y la edición no re-rendericen el resto del dashboard.
export function AdminEventsTab({ endUserTabLabel }: { endUserTabLabel: string }) {
    // Solo los departamentos que la organizacion tiene contratados
    const departments = useDepartments();

    const { addEvent, updateEvent, deleteEvent, events } = useStore();

    const [eventsDeptTab, setEventsDeptTab] = useState("Todos");

    // Event form
    const [evTitle, setEvTitle] = useState("");
    const [evDesc, setEvDesc] = useState("");
    const [evDept, setEvDept] = useState(departments[0] ?? "Psicología");
    const [evDate, setEvDate] = useState("");
    const [evTime, setEvTime] = useState("");
    const [evType, setEvType] = useState("taller");
    const [evImg] = useState("");
    const [evRegUrl, setEvRegUrl] = useState("");
    const [selectedEventImg, setSelectedEventImg] = useState<File | null>(null);

    // Edit event modal
    const [editingEvent, setEditingEvent] = useState<AppEvent | null>(null);
    const [editEvTitle, setEditEvTitle] = useState("");
    const [editEvDesc, setEditEvDesc] = useState("");
    const [editEvDate, setEditEvDate] = useState("");
    const [editEvTime, setEditEvTime] = useState("");
    const [editEvType, setEditEvType] = useState("");
    const [editEvDept, setEditEvDept] = useState("");
    const [editEvRegUrl, setEditEvRegUrl] = useState("");
    const [editEvImg, setEditEvImg] = useState<File | null>(null);

    const openEditEvent = (ev: AppEvent) => {
        setEditingEvent(ev);
        setEditEvTitle(ev.title);
        setEditEvDesc(ev.description);
        setEditEvDate(ev.date);
        setEditEvTime(ev.time);
        setEditEvType(ev.type);
        setEditEvDept(ev.department);
        setEditEvRegUrl(ev.registrationUrl || "");
        setEditEvImg(null);
    };

    // Inscritos a un evento (la lista llega filtrada por org desde el backend)
    const [inscritosEvent, setInscritosEvent] = useState<AppEvent | null>(null);
    const [inscritosList, setInscritosList] = useState<EventRegistrant[]>([]);
    const [inscritosLoading, setInscritosLoading] = useState(false);

    const openInscritos = async (ev: AppEvent) => {
        setInscritosEvent(ev);
        setInscritosList([]);
        setInscritosLoading(true);
        try {
            const res = await fetch(`${API}/events/${ev.id}/registrations`, { headers: authHeaders() });
            if (res.ok) setInscritosList(await res.json());
            else {
                const b = await res.json().catch(() => ({}));
                toast.error(b.error || "No se pudo cargar la lista de inscritos.");
            }
        } catch {
            toast.error("Error de conexión.");
        } finally {
            setInscritosLoading(false);
        }
    };

    const handleSaveEvent = async () => {
        if (!editingEvent || !editEvTitle || !editEvDate) { toast.error("Título y fecha son obligatorios"); return; }
        await updateEvent(editingEvent.id, {
            title: editEvTitle, description: editEvDesc, department: editEvDept,
            date: editEvDate, time: editEvTime, type: editEvType,
            registrationUrl: editEvType === "taller" ? editEvRegUrl : undefined,
        }, editEvImg || undefined);
        toast.success("Evento actualizado");
        setEditingEvent(null);
    };

    const handlePublishEvent = () => {
        if (!evTitle || !evDate) { toast.error("Título y fecha son obligatorios"); return; }
        addEvent({
            title: evTitle, description: evDesc, department: evDept,
            date: evDate, time: evTime, type: evType,
            imageUrl: selectedEventImg ? undefined : (evImg || "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=400&q=80"),
            registrationUrl: evType === "taller" ? evRegUrl : undefined,
        }, selectedEventImg || undefined);
        setEvTitle(""); setEvDesc(""); setEvDate(""); setEvTime(""); setEvRegUrl(""); setSelectedEventImg(null);
    };

    return (
        <>
            <div className="p-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div>
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Difusión Institucional</h3>
                        <p className="text-slate-500 font-medium mb-8">Publica eventos, conferencias y talleres. Aparecerán en el carrusel principal de todos los {endUserTabLabel}.</p>
                        <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 shadow-sm space-y-5">
                            <div>
                                <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Formato del evento</label>
                                <div className="grid grid-cols-2 gap-3">
                                    {["taller", "conferencia"].map(t => (
                                        <button key={t} onClick={() => setEvType(t)}
                                            className={`py-3 rounded-xl border-2 cursor-pointer capitalize font-bold text-sm transition-all ${evType === t ? "border-violet-600 bg-violet-50 text-violet-700 shadow-sm" : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 text-slate-500 dark:text-slate-400"}`}>
                                            {t}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Título del evento <span className="text-rose-500">*</span></label>
                                <input type="text" value={evTitle} onChange={e => setEvTitle(e.target.value)} placeholder="Ej. Taller de Organización de Tiempo" className={inputCls} />
                            </div>
                            <div>
                                <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Descripción global</label>
                                <textarea value={evDesc} onChange={e => setEvDesc(e.target.value)} placeholder="¿De qué trata este evento?..." className={`${inputCls} resize-none`} rows={3} />
                            </div>
                            <div>
                                <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Departamento organizador</label>
                                <select value={evDept} onChange={e => setEvDept(e.target.value)} className={inputCls}>
                                    {departments.map(d => <option key={d}>{d}</option>)}<option value="General">General (Todas las áreas)</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Fecha programada <span className="text-rose-500">*</span></label>
                                    <input type="date" value={evDate} onChange={e => setEvDate(e.target.value)} className={inputCls} />
                                </div>
                                <div>
                                    <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Hora de inicio</label>
                                    <input type="time" value={evTime} onChange={e => setEvTime(e.target.value)} className={inputCls} />
                                </div>
                            </div>
                            <div>
                                <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Imagen de Portada <span className="text-rose-500">*</span></label>
                                <div className="relative flex items-center gap-4 p-5 bg-white dark:bg-slate-700/30 border border-slate-200 dark:border-slate-600 rounded-2xl hover:border-violet-400 transition-colors cursor-pointer">
                                    <input type="file" accept="image/*" onChange={e => setSelectedEventImg(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                                    <div className="w-20 h-20 rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-100">
                                        {selectedEventImg
                                            ? <ImageIcon className="w-8 h-8 text-violet-400" />
                                            : (getUploadUrl(evImg) ? <img src={getUploadUrl(evImg)!} className="w-full h-full object-cover" alt="" /> : <ImageIcon className="w-8 h-8 text-slate-400" />)}
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-bold text-slate-700">{selectedEventImg ? selectedEventImg.name : "Subir imagen de portada"}</p>
                                        <p className="text-xs text-slate-400">Formatos: JPG, PNG. Recomendado: 800×400px</p>
                                    </div>
                                    <Plus className="w-5 h-5 text-slate-300 group-hover:text-violet-500 transition-colors" />
                                </div>
                            </div>
                            {evType === "taller" && (
                                <div>
                                    <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Enlace de Registro (Google Forms) <span className="text-rose-500">*</span></label>
                                    <input type="url" value={evRegUrl} onChange={e => setEvRegUrl(e.target.value)} placeholder="https://forms.gle/..." className={inputCls} />
                                </div>
                            )}
                            <Btn onClick={handlePublishEvent} size="lg" className="w-full bg-violet-600 hover:bg-violet-700 text-white">
                                <Megaphone className="w-5 h-5 mr-2" /> Difundir Evento
                            </Btn>
                        </div>
                    </div>

                    {/* Active events list */}
                    <div>
                        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center"><CheckCircle2 className="w-4 h-4 text-emerald-600" /></div>
                            Eventos Activos ({events.length})
                        </h3>
                        {/* Dept filter tabs */}
                        <div className="flex gap-2 mb-4 flex-wrap">
                            {["Todos", ...departments].map(d => (
                                <button key={d} onClick={() => setEventsDeptTab(d)}
                                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${eventsDeptTab === d ? "bg-violet-600 text-white border-violet-600" : "bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-violet-400"}`}>
                                    {d}
                                </button>
                            ))}
                        </div>
                        <div className="space-y-4 max-h-[620px] overflow-y-auto pr-2">
                            {events.filter(ev => eventsDeptTab === "Todos" || ev.department === eventsDeptTab).map((ev: any) => (
                                <div key={ev.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow group">
                                    {ev.imageUrl && (
                                        <div className="h-32 bg-slate-100 overflow-hidden relative">
                                            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent z-10" />
                                            <img src={ev.imageUrl} alt={ev.title} className="w-full h-full object-cover"
                                                onError={(e: React.SyntheticEvent<HTMLImageElement>) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                                            <div className="absolute bottom-3 left-3 z-20 flex items-center gap-2">
                                                <span className={`px-2 py-0.5 rounded-md font-bold text-[0.65rem] uppercase tracking-wider shadow-sm ${ev.type === "conferencia" ? "bg-violet-500 text-white" : "bg-blue-500 text-white"}`}>
                                                    {ev.type === "conferencia" ? "Conferencia" : "Taller"}
                                                </span>
                                                <span className="px-2 py-0.5 rounded-md font-bold text-[0.65rem] uppercase tracking-wider bg-black/40 text-white backdrop-blur-md">{ev.department}</span>
                                            </div>
                                            {/* Edit/Delete buttons overlaid on image */}
                                            <div className="absolute top-2 right-2 z-30 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                <button onClick={() => openEditEvent(ev)} title="Editar evento"
                                                    className="p-1.5 bg-white/90 hover:bg-white text-blue-600 rounded-lg cursor-pointer shadow">
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </button>
                                                <button onClick={() => deleteEvent(ev.id)} title="Eliminar evento"
                                                    className="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg cursor-pointer shadow">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    <div className="p-4 flex items-start justify-between gap-2">
                                        <div>
                                            <p className="text-slate-900 dark:text-white font-bold text-base leading-tight">{ev.title}</p>
                                            <p className="text-slate-500 text-xs mt-2 font-medium flex items-center gap-1">
                                                <CalendarDays className="w-3.5 h-3.5" />
                                                {new Date(ev.date + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
                                                {ev.time ? ` • ${ev.time}` : ""}
                                            </p>
                                            {ev.type === "conferencia" && (
                                                <button onClick={() => openInscritos(ev)}
                                                    className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-violet-600 hover:text-violet-800 cursor-pointer">
                                                    <Users className="w-3.5 h-3.5" /> {ev.registeredCount ?? 0} inscrito{(ev.registeredCount ?? 0) === 1 ? "" : "s"}
                                                </button>
                                            )}
                                        </div>
                                        {!ev.imageUrl && (
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 shrink-0 transition-all">
                                                <button onClick={() => openEditEvent(ev)} title="Editar evento"
                                                    className="p-1.5 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all cursor-pointer">
                                                    <Pencil className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => deleteEvent(ev.id)} title="Eliminar evento"
                                                    className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all cursor-pointer">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── Inscritos Modal ─── */}
            <Modal open={!!inscritosEvent} onClose={() => setInscritosEvent(null)} title="Inscritos al evento" subtitle={inscritosEvent?.title}>
                {inscritosLoading ? (
                    <div className="flex justify-center py-8"><div className="w-7 h-7 rounded-full border-4 border-violet-600 border-t-transparent animate-spin" /></div>
                ) : inscritosList.length === 0 ? (
                    <EmptyState icon={Users} title="Aún no hay inscritos" />
                ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                        <p className="text-xs text-slate-400 font-medium mb-1">{inscritosList.length} {inscritosList.length === 1 ? "persona inscrita" : "personas inscritas"}</p>
                        {inscritosList.map(r => (
                            <div key={r.id} className="flex items-center justify-between gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700">
                                <div className="min-w-0">
                                    <p className="font-bold text-slate-800 dark:text-white text-sm truncate">{r.name}</p>
                                    <p className="text-slate-500 dark:text-slate-400 text-xs truncate">{r.email}</p>
                                </div>
                                <p className="text-slate-400 text-[0.7rem] shrink-0">{new Date(r.registeredAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</p>
                            </div>
                        ))}
                    </div>
                )}
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
                    <div>
                        <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Departamento</label>
                        <select value={editEvDept} onChange={e => setEditEvDept(e.target.value)} className={inputCls}>
                            {departments.map(d => <option key={d}>{d}</option>)}<option value="General">General</option>
                        </select>
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
        </>
    );
}
