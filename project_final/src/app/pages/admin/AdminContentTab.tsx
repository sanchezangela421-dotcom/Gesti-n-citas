import { useState } from "react";
import { toast } from "sonner";
import { Video, Image as ImageIcon, ExternalLink, Plus, FileText, Pencil, Trash2 } from "lucide-react";
import { useStore } from "../../../context/StoreContext";
import { useDepartments } from "../../hooks/useDepartments";
import { Btn, Modal, inputCls } from "../../components/ui";
import type { Resource } from "../../../types";

// Pestaña "Publicar Contenido" del admin — aislada para que escribir en el formulario
// no re-renderice las gráficas/listas del resto del dashboard.
export function AdminContentTab() {
    // Solo los departamentos que la organizacion tiene contratados
    const departments = useDepartments();

    const { addResource, updateResource, deleteResource, resources } = useStore();

    // Tab de departamento para ver el material publicado
    const [contentDeptTab, setContentDeptTab] = useState(departments[0] ?? "Psicología");

    // Content form
    const [ctitle, setCtitle] = useState("");
    const [cdesc, setCdesc] = useState("");
    const [ctype, setCtype] = useState("video");
    const [curl, setCurl] = useState("");
    const [cimgUrl] = useState("");
    const [cdept, setCdept] = useState(departments[0] ?? "Psicología");
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    // Edit resource modal
    const [editingResource, setEditingResource] = useState<Resource | null>(null);
    const [editRTitle, setEditRTitle] = useState("");
    const [editRDesc, setEditRDesc] = useState("");
    const [editRUrl, setEditRUrl] = useState("");
    const [editRFile, setEditRFile] = useState<File | null>(null);

    const openEditResource = (r: Resource) => {
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

    const handlePublishContent = () => {
        if (!ctitle) { toast.error("El título es obligatorio"); return; }
        if (ctype !== "image" && !curl && !selectedFile) {
            toast.error("Agrega un enlace o sube un archivo"); return;
        }
        addResource({
            title: ctitle, description: cdesc, type: ctype,
            url: curl || "#", imageUrl: cimgUrl || undefined, department: cdept,
        }, selectedFile || undefined);
        setCtitle(""); setCdesc(""); setCurl(""); setSelectedFile(null);
    };

    return (
        <>
            <div className="p-8">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                {/* ── Form ── */}
                <div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Publicar Material Educativo</h3>
                <p className="text-slate-500 font-medium mb-6">Como administrador, puedes publicar recursos para cualquier departamento.</p>
                <div className="space-y-5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 shadow-sm">

                    {/* Title + dept */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Título del material <span className="text-rose-500">*</span></label>
                            <input type="text" value={ctitle} onChange={e => setCtitle(e.target.value)} placeholder="Ej. Guía para el manejo de ansiedad" className={inputCls} />
                        </div>
                        <div>
                            <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Departamento</label>
                            <select value={cdept} onChange={e => setCdept(e.target.value)} className={inputCls}>
                                {departments.map(d => <option key={d}>{d}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Descripción breve</label>
                        <textarea value={cdesc} onChange={e => setCdesc(e.target.value)} placeholder="Explica brevemente de qué trata..." className={`${inputCls} resize-none`} rows={2} />
                    </div>

                    {/* Type selector */}
                    <div>
                        <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Tipo de recurso</label>
                        <div className="grid grid-cols-3 gap-3">
                            {[
                                { key: "video", label: "Video", icon: Video, color: "rose" },
                                { key: "image", label: "Imagen", icon: ImageIcon, color: "emerald" },
                                { key: "link", label: "Enlace", icon: ExternalLink, color: "blue" },
                            ].map(t => (
                                <button key={t.key} onClick={() => { setCtype(t.key); setCurl(""); setSelectedFile(null); }}
                                    className={`flex flex-col items-center gap-2 p-4 border-2 rounded-2xl cursor-pointer transition-all ${ctype === t.key ? `border-${t.color}-500 bg-${t.color}-50 shadow-sm` : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/50 hover:border-slate-300"}`}>
                                    <t.icon className={`w-6 h-6 ${ctype === t.key ? `text-${t.color}-600` : "text-slate-400"}`} />
                                    <span className={`text-xs font-bold ${ctype === t.key ? `text-${t.color}-700` : "text-slate-500"}`}>{t.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Image: file upload */}
                    {ctype === "image" && (
                        <div>
                            <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">
                                Imagen / Infografía <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative flex items-center gap-4 p-4 bg-white dark:bg-slate-700/30 border-2 border-dashed border-emerald-200 dark:border-emerald-800 rounded-2xl hover:border-emerald-400 transition-colors cursor-pointer">
                                <input type="file" accept="image/*" onChange={e => setSelectedFile(e.target.files?.[0] || null)} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                                {selectedFile ? (
                                    <>
                                        <div className="w-16 h-16 rounded-xl bg-emerald-100 flex items-center justify-center border border-emerald-200 shrink-0">
                                            <ImageIcon className="w-7 h-7 text-emerald-500" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-700">{selectedFile.name}</p>
                                            <p className="text-xs text-slate-400">{(selectedFile.size / 1024).toFixed(1)} KB — haz clic para cambiar</p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-16 h-16 rounded-xl bg-emerald-50 flex items-center justify-center border border-emerald-100 shrink-0">
                                            <ImageIcon className="w-7 h-7 text-emerald-400" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-700">Subir imagen o infografía</p>
                                            <p className="text-xs text-slate-400">JPG, PNG, WEBP. Recomendado: 800×400px</p>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Video: URL + optional file */}
                    {ctype === "video" && (
                        <div className="space-y-4">
                            <div>
                                <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">
                                    URL del video <span className="text-rose-500">*</span>
                                    <span className="text-slate-400 font-normal ml-2 text-xs">(YouTube, Vimeo, etc.)</span>
                                </label>
                                <input type="url" value={curl} onChange={e => setCurl(e.target.value)} placeholder="https://youtube.com/watch?v=..." className={inputCls} />
                            </div>
                            <div>
                                <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Archivo adjunto (opcional)</label>
                                <div className="relative flex items-center gap-3 p-4 bg-white dark:bg-slate-700/30 border border-slate-200 dark:border-slate-600 rounded-xl hover:border-rose-300 transition-colors cursor-pointer">
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

                    {/* Link: URL only */}
                    {ctype === "link" && (
                        <div>
                            <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">
                                URL del enlace <span className="text-rose-500">*</span>
                            </label>
                            <input type="url" value={curl} onChange={e => setCurl(e.target.value)} placeholder="https://..." className={inputCls} />
                        </div>
                    )}

                    <Btn onClick={handlePublishContent} size="lg" className="w-full"><FileText className="w-5 h-5 mr-2" /> Publicar Material</Btn>
                </div>{/* end form card */}
                </div>{/* end form column */}

                {/* ── Resource list by dept ── */}
                <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-4">Material publicado</h3>
                    {/* Dept tabs */}
                    <div className="flex gap-2 mb-4 flex-wrap">
                        {departments.map(d => (
                            <button key={d} onClick={() => setContentDeptTab(d)}
                                className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-all cursor-pointer ${contentDeptTab === d ? "bg-blue-600 text-white border-blue-600" : "bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-blue-400"}`}>
                                {d}
                            </button>
                        ))}
                    </div>
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                        {resources.filter(r => r.department === contentDeptTab).length === 0 ? (
                            <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-100 dark:border-slate-700 rounded-2xl">
                                <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                                <p className="text-sm font-medium">Sin material publicado en {contentDeptTab}</p>
                            </div>
                        ) : (
                            resources.filter(r => r.department === contentDeptTab).map(r => (
                                <div key={r.id} className="flex items-start gap-3 p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-sm hover:shadow-md transition-shadow group">
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
                </div>{/* end resource list */}

                </div>{/* end grid */}
            </div>

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
        </>
    );
}
