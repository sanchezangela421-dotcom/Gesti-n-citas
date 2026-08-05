import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Users, ClipboardList, ArrowLeft, Search, Lock, Pencil, Plus } from "lucide-react";
import { API, authHeaders } from "../../../lib/api";
import { Btn, EmptyState, StatusBadge } from "../../components/ui";
import type { PatientSummary, PatientRecord, RecordSession } from "../../../types";

interface PatientRecordsProps {
    /** Specialist.id del usuario actual — define qué sesiones puede anotar. */
    mySpecialistId: string;
    endUserLabel: string;
}

export function PatientRecords({ mySpecialistId, endUserLabel }: PatientRecordsProps) {
    const [patients, setPatients] = useState<PatientSummary[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [query, setQuery] = useState("");

    const [selected, setSelected] = useState<PatientSummary | null>(null);
    const [record, setRecord] = useState<PatientRecord | null>(null);
    const [loadingRecord, setLoadingRecord] = useState(false);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch(`${API}/patients`, { headers: authHeaders() });
                if (res.ok) setPatients(await res.json());
            } catch { /* silencioso */ }
            finally { setLoadingList(false); }
        })();
    }, []);

    const openRecord = useCallback(async (p: PatientSummary) => {
        setSelected(p);
        setRecord(null);
        setEditingId(null);
        setLoadingRecord(true);
        try {
            const res = await fetch(`${API}/patients/${p.studentId}/record`, { headers: authHeaders() });
            if (res.ok) {
                setRecord(await res.json());
            } else {
                const body = await res.json().catch(() => ({}));
                toast.error(body.error || "No se pudo cargar el expediente.");
                setSelected(null);
            }
        } catch {
            toast.error("Error de conexión.");
            setSelected(null);
        } finally {
            setLoadingRecord(false);
        }
    }, []);

    const startEdit = (s: RecordSession) => {
        setEditingId(s.id);
        setDraft(s.note?.body ?? "");
    };

    const saveNote = async (apptId: string) => {
        const body = draft.trim();
        if (!body) { toast.error("La nota no puede estar vacía."); return; }
        setSaving(true);
        try {
            const res = await fetch(`${API}/appointments/${apptId}/note`, {
                method: "PUT",
                headers: authHeaders(),
                body: JSON.stringify({ body }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || "No se pudo guardar la nota.");
            }
            const saved = await res.json();
            setRecord(prev => prev ? {
                ...prev,
                timeline: prev.timeline.map(s => s.id === apptId
                    ? { ...s, note: { id: saved.id, body: saved.body, authoredByMe: true, createdAt: saved.createdAt, updatedAt: saved.updatedAt } }
                    : s),
            } : prev);
            setEditingId(null);
            toast.success("Nota guardada.");
        } catch (e: any) {
            toast.error(e.message || "Error al guardar la nota.");
        } finally {
            setSaving(false);
        }
    };

    const filtered = patients.filter(p => p.studentName.toLowerCase().includes(query.toLowerCase()));

    // ── Vista de expediente de un paciente ──────────────────────────────
    if (selected) {
        return (
            <div className="space-y-5">
                <button
                    onClick={() => { setSelected(null); setRecord(null); }}
                    className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                >
                    <ArrowLeft className="w-4 h-4" /> Volver a {endUserLabel.toLowerCase()}s
                </button>

                <div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{selected.studentName}</h3>
                        {(record?.inactive ?? selected.inactive) && (
                            <span className="text-[0.65rem] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-700 uppercase tracking-wider">
                                Paciente inactivo
                            </span>
                        )}
                    </div>
                    <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 text-sm">
                        Expediente {record ? `· ${record.department}` : ""} · {selected.total} {selected.total === 1 ? "sesión" : "sesiones"}
                    </p>
                </div>

                {(record?.inactive ?? selected.inactive) && (
                    <div className="flex items-start gap-3 p-3.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl">
                        <ClipboardList className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                        <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed">
                            Esta persona fue <span className="font-bold">dada de baja</span>. Su expediente se conserva
                            por obligación legal de retención y sigue siendo consultable, pero ya no es posible agendar
                            nuevas sesiones con ella.
                        </p>
                    </div>
                )}

                <div className="flex items-start gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl">
                    <Lock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed">
                        Expediente <span className="font-bold text-slate-700 dark:text-slate-200">confidencial</span>. Solo visible para especialistas del mismo departamento. Cada acceso queda registrado.
                    </p>
                </div>

                {loadingRecord ? (
                    <div className="flex justify-center py-12">
                        <div className="w-8 h-8 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
                    </div>
                ) : !record || record.timeline.length === 0 ? (
                    <EmptyState icon={ClipboardList} title="Sin sesiones registradas" />
                ) : (
                    <div className="space-y-3">
                        {record.timeline.map(s => {
                            const canEdit = s.specialistId === mySpecialistId && (s.status === "Confirmada" || s.status === "Completada");
                            const isEditing = editingId === s.id;
                            return (
                                <div key={s.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
                                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <StatusBadge status={s.status} />
                                            {s.isFollowUp && (
                                                <span className="text-[0.65rem] font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/40 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-700">Seguimiento</span>
                                            )}
                                        </div>
                                        <p className="text-slate-400 dark:text-slate-500 text-xs">
                                            {new Date(s.date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })} — {s.time}
                                        </p>
                                    </div>
                                    <p className="text-slate-500 dark:text-slate-400 text-xs">{s.modality} · {s.motivo}</p>
                                    <p className="text-slate-400 dark:text-slate-500 text-[0.7rem] mt-0.5">Atendió: {s.specialistName}</p>

                                    {/* Nota clínica */}
                                    {isEditing ? (
                                        <div className="mt-3 space-y-2">
                                            <textarea
                                                value={draft}
                                                onChange={e => setDraft(e.target.value)}
                                                rows={4}
                                                autoFocus
                                                placeholder="Observaciones de la sesión, estado del paciente, plan de seguimiento..."
                                                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 text-sm text-slate-700"
                                            />
                                            <div className="flex gap-2 justify-end">
                                                <Btn size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={saving}>Cancelar</Btn>
                                                <Btn size="sm" onClick={() => saveNote(s.id)} disabled={saving}
                                                    className="bg-indigo-600 hover:bg-indigo-700 text-white border-0">
                                                    {saving ? "Guardando..." : "Guardar nota"}
                                                </Btn>
                                            </div>
                                        </div>
                                    ) : s.note ? (
                                        <div className="mt-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800">
                                            <div className="flex items-center justify-between gap-2 mb-1">
                                                <p className="text-[0.65rem] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                                                    <ClipboardList className="w-3 h-3" /> Nota clínica {!s.note.authoredByMe && "(otro especialista)"}
                                                </p>
                                                {canEdit && (
                                                    <button onClick={() => startEdit(s)} className="text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300 cursor-pointer">
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                            <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">{s.note.body}</p>
                                        </div>
                                    ) : canEdit ? (
                                        <button
                                            onClick={() => startEdit(s)}
                                            className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-300 hover:opacity-80 cursor-pointer"
                                        >
                                            <Plus className="w-3.5 h-3.5" /> Agregar nota clínica
                                        </button>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    // ── Lista de pacientes ──────────────────────────────────────────────
    return (
        <div className="space-y-5">
            <div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Expedientes</h3>
                <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 text-sm">
                    {endUserLabel}s que has atendido
                </p>
            </div>

            <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Buscar por nombre..."
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
            </div>

            {loadingList ? (
                <div className="flex justify-center py-12">
                    <div className="w-8 h-8 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState icon={Users} title={query ? "Sin coincidencias" : "Aún no has atendido pacientes"} />
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filtered.map(p => (
                        <button
                            key={p.studentId}
                            onClick={() => openRecord(p)}
                            className="text-left bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer"
                        >
                            <p className="font-bold text-slate-900 dark:text-white text-sm truncate">{p.studentName}</p>
                            <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
                                {p.total} {p.total === 1 ? "sesión" : "sesiones"}
                            </p>
                            <p className="text-slate-400 dark:text-slate-500 text-[0.7rem] mt-0.5">
                                Última: {new Date(p.lastSession + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                            </p>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
