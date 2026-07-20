import { useState } from "react";
import { toast } from "sonner";
import { Megaphone, CheckCircle2, CalendarDays, Users, Pencil, Trash2, Image as ImageIcon } from "lucide-react";
import { useStore } from "../../../context/StoreContext";
import { Btn, Modal, EmptyState, inputCls } from "../../components/ui";
import { API, authHeaders } from "../../../lib/api";
import type { EventRegistrant } from "../../../types";

// Pestaña "Publicar Evento" — aislada para que el formulario, la lista de inscritos
// y la edición no re-rendericen el dashboard principal.
export function EventTab({ dept, endUserTabLabel }: { dept: string; endUserTabLabel: string }) {
    const { addEvent, updateEvent, deleteEvent, events } = useStore();

    // Inscritos a un evento (conferencia)
    const [inscritosEvent, setInscritosEvent] = useState<any | null>(null);
    const [inscritosList, setInscritosList] = useState<EventRegistrant[]>([]);
    const [inscritosLoading, setInscritosLoading] = useState(false);

    const openInscritos = async (ev: any) => {
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
        addEvent({
            title: evTitle, description: evDesc, department: dept,
            date: evDate, time: evTime, type: evType,
            // Si hay archivo lo sube multer y el servidor pone la URL; si no, usar URL manual o default
            imageUrl: selectedEventImg ? undefined : (evImg || "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=400&q=80"),
            registrationUrl: evType === "taller" ? evRegUrl : undefined,
        }, selectedEventImg || undefined);
        setEvTitle(""); setEvDesc(""); setEvDate(""); setEvTime(""); setEvImg(""); setEvRegUrl(""); setSelectedEventImg(null);
    };

    return (
        <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                {/* ── Form ── */}
                <div>
                    <h3 className="text-2xl font-bold text-slate-900 mb-2">Publicar Evento o Taller</h3>
                    <p className="text-slate-500 font-medium mb-6">Crea un banner que aparecerá en el carrusel principal de {endUserTabLabel}.</p>
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
                                    <ImageIcon className={`w-8 h-8 ${selectedEventImg ? "text-violet-400" : "text-slate-400"}`} />
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
                                            {ev.type === "conferencia" && (
                                                <button onClick={() => openInscritos(ev)}
                                                    className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-violet-600 hover:text-violet-800 cursor-pointer">
                                                    <Users className="w-3 h-3" /> {ev.registeredCount ?? 0} inscrito{(ev.registeredCount ?? 0) === 1 ? "" : "s"}
                                                </button>
                                            )}
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

            {/* Inscritos Modal */}
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
