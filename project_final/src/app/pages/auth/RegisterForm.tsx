import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { CalendarCheck, UserPlus, ShieldCheck, RefreshCw, Building2, ChevronDown, Search, GraduationCap, Stethoscope, Briefcase } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { API_BASE } from "../../../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgOption {
    id: string;
    name: string;
    slug: string;
    type: string;
    userRoleLabel: string;
    logoUrl?: string | null;
}

interface RegField {
    key: string;
    label: string;
    type: string;           // "text" | "number" | "select" | "date" | "radio"
    required: boolean;
    options: string[] | null;
    placeholder: string | null;
    order: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const INPUT_BASE = "w-full px-3.5 py-2.5 rounded-xl border-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none transition-all text-sm font-medium";

function DynamicField({ field, value, onChange }: {
    field: RegField;
    value: string;
    onChange: (v: string) => void;
}) {
    const base = `${INPUT_BASE} border-emerald-200 focus:border-emerald-600 focus:bg-white`;

    switch (field.type) {
        case "select":
            return (
                <select
                    value={value}
                    required={field.required}
                    onChange={e => onChange(e.target.value)}
                    className={`${base} appearance-none cursor-pointer`}
                >
                    <option value="" disabled>{field.placeholder ?? `Selecciona ${field.label.toLowerCase()}`}</option>
                    {(field.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
            );

        case "radio":
            return (
                <div className="grid grid-cols-2 gap-3">
                    {(field.options ?? []).map(o => (
                        <button key={o} type="button" onClick={() => onChange(o)}
                            className={`py-2.5 rounded-xl border-2 font-medium transition-all active:scale-[0.98] cursor-pointer
                                ${value === o
                                    ? "border-emerald-600 bg-emerald-600 text-white shadow-md shadow-emerald-600/20"
                                    : "border-emerald-200 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-emerald-300"
                                }`}>
                            {o}
                        </button>
                    ))}
                </div>
            );

        case "date":
            return (
                <input
                    type="date"
                    value={value}
                    required={field.required}
                    max={new Date().toISOString().split("T")[0]}
                    min="1900-01-01"
                    onChange={e => onChange(e.target.value)}
                    className={base}
                />
            );

        case "number":
            return (
                <input
                    type="number"
                    value={value}
                    required={field.required}
                    placeholder={field.placeholder ?? ""}
                    onChange={e => onChange(e.target.value)}
                    className={base}
                />
            );

        default: // "text"
            return (
                <input
                    type="text"
                    value={value}
                    required={field.required}
                    placeholder={field.placeholder ?? ""}
                    onChange={e => onChange(e.target.value)}
                    className={base}
                />
            );
    }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RegisterForm({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
    const { register } = useAuth();

    // Universal fields
    const [name,            setName]            = useState("");
    const [email,           setEmail]           = useState("");
    const [password,        setPassword]        = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    // Org selector
    const [orgs,           setOrgs]           = useState<OrgOption[]>([]);
    const [orgsLoading,    setOrgsLoading]    = useState(true);
    const [selectedOrgId,  setSelectedOrgId]  = useState("");
    const [selectedOrg,    setSelectedOrg]    = useState<OrgOption | null>(null);

    // Dynamic fields
    const [fields,         setFields]         = useState<RegField[]>([]);
    const [fieldsLoading,  setFieldsLoading]  = useState(false);
    const [metadata,       setMetadata]       = useState<Record<string, string>>({});

    const [loading, setLoading] = useState(false);
    const [orgSearch, setOrgSearch] = useState("");

    const ORG_TYPE_ICON: Record<string, typeof Building2> = {
        school:   GraduationCap,
        hospital: Stethoscope,
        company:  Briefcase,
    };

    const filteredOrgs = useMemo(() =>
        orgs.filter(o =>
            o.name.toLowerCase().includes(orgSearch.toLowerCase()) ||
            o.userRoleLabel.toLowerCase().includes(orgSearch.toLowerCase())
        ),
    [orgs, orgSearch]);

    // ── Load active orgs on mount ──────────────────────────────────────────────
    useEffect(() => {
        fetch(`${API_BASE}/api/public/organizations`)
            .then(r => r.json())
            .then(data => { setOrgs(data); setOrgsLoading(false); })
            .catch(() => { toast.error("No se pudieron cargar las organizaciones"); setOrgsLoading(false); });
    }, []);

    // ── Load registration fields when org changes ──────────────────────────────
    useEffect(() => {
        if (!selectedOrgId) { setFields([]); setMetadata({}); setSelectedOrg(null); return; }

        const org = orgs.find(o => o.id === selectedOrgId) ?? null;
        setSelectedOrg(org);

        if (!org) return;
        setFieldsLoading(true);

        fetch(`${API_BASE}/api/public/organizations/${org.slug}/fields`)
            .then(r => r.json())
            .then(data => {
                const f: RegField[] = data.registrationFields ?? [];
                setFields(f);
                // Inicializa metadata con vacío para cada campo
                setMetadata(Object.fromEntries(f.map((field: RegField) => [field.key, ""])));
                setFieldsLoading(false);
            })
            .catch(() => { toast.error("Error al cargar campos del formulario"); setFieldsLoading(false); });
    }, [selectedOrgId]);

    // ── Submit ─────────────────────────────────────────────────────────────────
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!selectedOrgId) { toast.error("Selecciona tu organización"); return; }
        if (password !== confirmPassword) { toast.error("Las contraseñas no coinciden"); return; }

        // Validar campos requeridos dinámicos
        for (const field of fields) {
            if (field.required && !metadata[field.key]?.trim()) {
                toast.error(`El campo "${field.label}" es requerido`);
                return;
            }
        }

        setLoading(true);
        const result = await register({
            name,
            email,
            password,
            organizationId: selectedOrgId,
            metadata,
        });
        setLoading(false);

        if (result.ok) {
            toast.success("¡Registro exitoso! Revisa tu correo para verificar tu cuenta.");
            onSwitchToLogin();
        } else {
            toast.error(result.error || "No se pudo completar el registro.");
        }
    };

    const roleLabel = selectedOrg?.userRoleLabel ?? "usuario";

    return (
        <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 relative overflow-hidden font-sans">

            {/* ── Left panel ── */}
            <div className="hidden lg:flex w-[52%] flex-col justify-between p-12 relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-emerald-700">
                <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-emerald-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob" />

                <div className="relative z-10">
                    <div className="flex items-center gap-4 mb-10">
                        <div className="w-14 h-14 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-xl">
                            <CalendarCheck className="w-7 h-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-white text-2xl font-bold tracking-tight">
                                {selectedOrg ? selectedOrg.name : "Sistema de Citas"}
                            </h1>
                            <p className="text-emerald-200 text-sm font-medium tracking-wide">NUEVA CUENTA</p>
                        </div>
                    </div>

                    <h2 className="text-2xl text-white font-bold leading-tight mb-6">
                        {selectedOrg
                            ? `Regístrate como ${roleLabel.toLowerCase()} en ${selectedOrg.name}.`
                            : "Selecciona tu organización."
                        }
                    </h2>

                    {/* Buscador */}
                    <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                        <input
                            value={orgSearch}
                            onChange={e => setOrgSearch(e.target.value)}
                            placeholder="Buscar organización..."
                            className="w-full bg-white/10 border border-white/20 rounded-xl pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-white/40 transition-colors"
                        />
                    </div>

                    {/* Grid de orgs */}
                    <div className="grid grid-cols-2 gap-2 overflow-y-auto max-h-64 pr-1 scrollbar-thin">
                        {filteredOrgs.length === 0 ? (
                            <p className="col-span-2 text-white/40 text-sm text-center py-4">Sin resultados</p>
                        ) : filteredOrgs.map(o => {
                            const Icon = ORG_TYPE_ICON[o.type] ?? Building2;
                            const isSelected = selectedOrgId === o.id;
                            return (
                                <button key={o.id} type="button" onClick={() => setSelectedOrgId(o.id)}
                                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all text-center ${
                                        isSelected
                                            ? "bg-white/20 border-white/50 text-white"
                                            : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                                    }`}>
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden ${o.logoUrl ? "bg-white p-1" : isSelected ? "bg-white/20" : "bg-white/10"}`}>
                                        {o.logoUrl ? (
                                            <img src={`${API_BASE}${o.logoUrl}`} alt={o.name} className="w-full h-full object-contain" />
                                        ) : (
                                            <Icon className="w-5 h-5" />
                                        )}
                                    </div>
                                    <div>
                                        <p className="font-semibold text-xs leading-tight">{o.name}</p>
                                        <p className="text-xs opacity-60 mt-0.5">{o.userRoleLabel}s</p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ── Right panel ── */}
            <div className="flex-1 flex flex-col justify-center items-center py-8 px-4 sm:px-8 relative overflow-y-auto">
                <div className="w-full max-w-xl mx-auto my-auto">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-slate-900/50 border border-slate-100 dark:border-slate-800 p-8 sm:p-10">
                        <div className="text-center mb-8">
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Crear Cuenta</h2>
                            <p className="text-slate-500 mt-2 text-sm">Completa tus datos para registrarte</p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-6">

                            {/* Org selector (visible en móvil — en desktop está en el panel izquierdo) */}
                            <div className="lg:hidden">
                                <label className="block mb-1.5 text-slate-700 dark:text-slate-300 text-sm font-semibold ml-1">Organización</label>
                                <div className="relative">
                                    <select
                                        value={selectedOrgId}
                                        required
                                        onChange={e => setSelectedOrgId(e.target.value)}
                                        className={`${INPUT_BASE} border-slate-200 focus:border-blue-600 appearance-none`}
                                        disabled={orgsLoading}
                                    >
                                        <option value="">{orgsLoading ? "Cargando..." : "Selecciona tu organización"}</option>
                                        {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                </div>
                            </div>

                            {/* En desktop: org selector refleja la elección del panel izquierdo */}
                            {selectedOrg && (
                                <div className="hidden lg:flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                                    <Building2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                    <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                                        {selectedOrg.name} — registrándote como <strong>{roleLabel}</strong>
                                    </span>
                                </div>
                            )}

                            {/* Datos personales */}
                            <div className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800 p-5 rounded-2xl space-y-4">
                                <h3 className="text-xs font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wider flex items-center gap-2">
                                    <UserPlus className="w-3.5 h-3.5" /> Datos personales
                                </h3>
                                <div>
                                    <label className="block mb-1.5 text-slate-700 dark:text-slate-300 text-sm font-semibold ml-1">Nombre completo</label>
                                    <input type="text" value={name} required placeholder="Tu nombre completo"
                                        onChange={e => setName(e.target.value)}
                                        className={`${INPUT_BASE} border-blue-200 focus:border-blue-600 focus:bg-white`} />
                                </div>
                                <div>
                                    <label className="block mb-1.5 text-slate-700 dark:text-slate-300 text-sm font-semibold ml-1">Correo electrónico</label>
                                    <input type="email" value={email} required placeholder="tu@correo.com"
                                        onChange={e => setEmail(e.target.value)}
                                        className={`${INPUT_BASE} border-blue-200 focus:border-blue-600 focus:bg-white`} />
                                </div>
                            </div>

                            {/* Campos dinámicos de la organización */}
                            {selectedOrgId && (
                                <div className="bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800 p-5 rounded-2xl space-y-4">
                                    <h3 className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-2">
                                        <Building2 className="w-3.5 h-3.5" /> Datos de {selectedOrg?.name ?? "la organización"}
                                    </h3>

                                    {fieldsLoading ? (
                                        <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
                                            <RefreshCw className="w-4 h-4 animate-spin" /> Cargando campos...
                                        </div>
                                    ) : fields.length === 0 ? (
                                        <p className="text-sm text-slate-400 py-2">Esta organización no requiere datos adicionales.</p>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            {fields.map(field => (
                                                <div key={field.key} className={field.type === "radio" ? "sm:col-span-2" : ""}>
                                                    <label className="block mb-1.5 text-slate-700 dark:text-slate-300 text-sm font-semibold ml-1">
                                                        {field.label}
                                                        {field.required && <span className="text-red-500 ml-1">*</span>}
                                                    </label>
                                                    <DynamicField
                                                        field={field}
                                                        value={metadata[field.key] ?? ""}
                                                        onChange={v => setMetadata(m => ({ ...m, [field.key]: v }))}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Contraseña */}
                            <div className="bg-violet-50/50 dark:bg-violet-900/10 border border-violet-100 dark:border-violet-800 p-5 rounded-2xl space-y-4">
                                <h3 className="text-xs font-bold text-violet-800 dark:text-violet-300 uppercase tracking-wider flex items-center gap-2">
                                    <ShieldCheck className="w-3.5 h-3.5" /> Seguridad
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block mb-1.5 text-slate-700 dark:text-slate-300 text-sm font-semibold ml-1">Contraseña</label>
                                        <input type="password" value={password} required minLength={6} placeholder="Mínimo 6 caracteres"
                                            onChange={e => setPassword(e.target.value)}
                                            className={`${INPUT_BASE} border-violet-200 focus:border-violet-600 focus:bg-white`} />
                                    </div>
                                    <div>
                                        <label className="block mb-1.5 text-slate-700 dark:text-slate-300 text-sm font-semibold ml-1">Confirmar</label>
                                        <input type="password" value={confirmPassword} required minLength={6} placeholder="Repite contraseña"
                                            onChange={e => setConfirmPassword(e.target.value)}
                                            className={`${INPUT_BASE} border-violet-200 focus:border-violet-600 focus:bg-white`} />
                                    </div>
                                </div>
                            </div>

                            <button type="submit" disabled={loading || !selectedOrgId}
                                className="w-full py-4 mt-6 bg-gradient-to-r from-emerald-600 to-teal-500 text-white rounded-xl font-semibold shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-0.5 transition-all text-base cursor-pointer flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0">
                                {loading ? <><RefreshCw className="w-5 h-5 animate-spin" /> Registrando...</> : "Registrarse"}
                            </button>
                        </form>

                        <p className="text-center mt-8 text-slate-500 text-sm">
                            ¿Ya tienes cuenta?{" "}
                            <button onClick={onSwitchToLogin} className="text-emerald-600 font-semibold hover:text-emerald-700 underline underline-offset-4 cursor-pointer">
                                Iniciar sesión
                            </button>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
