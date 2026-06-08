import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
    Building2, Users, CalendarCheck, ShieldCheck, Plus,
    Power, PowerOff, Search, RefreshCw, Pencil,
    Globe, Stethoscope, GraduationCap, Briefcase,
    AlertTriangle, Clock, LogOut,
} from "lucide-react";
import { API, superAdminHeaders, getImageUrl } from "../../../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Org {
    id: string;
    name: string;
    slug: string;
    type: string;
    plan: string;
    active: boolean;
    userRoleLabel: string;
    logoUrl?: string | null;
    createdAt: string;
    _count: { users: number; specialists: number; appointments: number };
}

interface RegField {
    id: string;
    key: string;
    label: string;
    type: string;
    required: boolean;
    options: string[] | null;
    placeholder: string | null;
    order: number;
}

interface GlobalStats {
    orgs:         { total: number; active: number; inactive: number };
    users:        { total: number; byRole: Record<string, number> };
    appointments: { total: number };
    recentAudit:  AuditEntry[];
}

interface AuditEntry {
    id: string;
    actorId: string;
    actorRole: string;
    action: string;
    targetEntity: string;
    targetId: string;
    organizationId: string | null;
    ipAddress: string | null;
    createdAt: string;
    metadata: Record<string, any> | null;
}

interface UserRow {
    id: string;
    email: string;
    name: string;
    role: string;
    organizationId: string | null;
    emailVerified: boolean;
    createdAt: string;
    organization: { id: string; name: string; slug: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG_TYPE_LABEL: Record<string, string> = {
    school:   "Institución Educativa",
    hospital: "Hospital / Clínica",
    company:  "Empresa",
};

const ORG_TYPE_ICON: Record<string, typeof GraduationCap> = {
    school:   GraduationCap,
    hospital: Stethoscope,
    company:  Briefcase,
};

const PLAN_COLOR: Record<string, string> = {
    free:       "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    basic:      "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    enterprise: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

const ROLE_COLOR: Record<string, string> = {
    superadmin:  "bg-rose-100 text-rose-700",
    admin:       "bg-indigo-100 text-indigo-700",
    especialista:"bg-teal-100 text-teal-700",
    alumno:      "bg-slate-100 text-slate-600",
    usuario:     "bg-sky-100 text-sky-700",
};

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(iso: string) {
    return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
    user: { id: string; email: string; name: string };
    onLogout: () => void;
}

export function SuperAdminDashboard({ user, onLogout }: Props) {
    const [tab, setTab] = useState<"overview" | "orgs" | "users" | "audit">("overview");

    // ── Overview ──
    const [stats, setStats]         = useState<GlobalStats | null>(null);
    const [statsLoading, setStatsLoading] = useState(true);

    // ── Orgs ──
    const [orgs, setOrgs]           = useState<Org[]>([]);
    const [orgsLoading, setOrgsLoading] = useState(false);
    const [orgSearch, setOrgSearch] = useState("");
    const [showCreateOrg, setShowCreateOrg] = useState(false);
    const [createForm, setCreateForm] = useState({ name: "", slug: "", type: "school", plan: "free", userRoleLabel: "Usuario" });
    const [creating, setCreating]   = useState(false);

    // ── Users ──
    const [users, setUsers]         = useState<UserRow[]>([]);
    const [usersTotal, setUsersTotal] = useState(0);
    const [usersPage, setUsersPage] = useState(1);
    const [usersLoading, setUsersLoading] = useState(false);
    const [userOrgFilter, setUserOrgFilter] = useState("");

    // ── Audit ──
    const [audit, setAudit]         = useState<AuditEntry[]>([]);
    const [auditTotal, setAuditTotal] = useState(0);
    const [auditPage, setAuditPage] = useState(1);
    const [auditLoading, setAuditLoading] = useState(false);

    // ── Designar admin modal ──
    const [designOrg, setDesignOrg] = useState<Org | null>(null);
    const [adminForm, setAdminForm] = useState({ name: "", email: "", password: "" });
    const [designating, setDesignating] = useState(false);

    // ── Editar org modal ──
    const [editOrg, setEditOrg]     = useState<Org | null>(null);
    const [editForm, setEditForm]   = useState({ name: "", type: "school", plan: "free", userRoleLabel: "Usuario" });
    const [logoFile, setLogoFile]   = useState<File | null>(null);
    const [logoUploading, setLogoUploading] = useState(false);
    const logoInputRef = useRef<HTMLInputElement>(null);

    // ── Configurar campos de registro por org ──
    const [configFieldsOrg, setConfigFieldsOrg]     = useState<Org | null>(null);
    const [orgFields, setOrgFields]                  = useState<RegField[]>([]);
    const [orgFieldsLoading, setOrgFieldsLoading]    = useState(false);
    const [showAddField, setShowAddField]             = useState(false);
    const [editingField, setEditingField]             = useState<RegField | null>(null);
    const [fieldForm, setFieldForm]                  = useState({ label: "", key: "", type: "text", required: false, options: "", placeholder: "" });
    const [fieldSaving, setFieldSaving]              = useState(false);
    const [saving, setSaving]       = useState(false);

    // ── CRUD usuarios ──
    const [editUser, setEditUser]   = useState<UserRow | null>(null);
    const [editUserForm, setEditUserForm] = useState({ name: "", email: "", role: "alumno", organizationId: "", password: "" });
    const [showCreateUser, setShowCreateUser] = useState(false);
    const [createUserForm, setCreateUserForm] = useState({ name: "", email: "", role: "alumno", organizationId: "" });
    const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
    const [userActionLoading, setUserActionLoading] = useState(false);

    // ── Cache: evita re-fetch si el tab fue visitado hace < 30s ──
    const lastFetched = useRef<Record<string, number>>({});
    const CACHE_TTL   = 30_000;
    function isFresh(key: string) { return Date.now() - (lastFetched.current[key] ?? 0) < CACHE_TTL; }
    function markFresh(key: string) { lastFetched.current[key] = Date.now(); }

    // ── Fetch helpers ──────────────────────────────────────────────────────────

    const fetchStats = useCallback(async (force = false) => {
        if (!force && isFresh("overview")) return;
        setStatsLoading(true);
        try {
            const res = await fetch(`${API}/superadmin/stats`, { headers: superAdminHeaders() });
            if (!res.ok) throw new Error();
            setStats(await res.json());
            markFresh("overview");
        } catch {
            toast.error("Error al cargar estadísticas");
        } finally {
            setStatsLoading(false);
        }
    }, []);

    const fetchOrgs = useCallback(async (force = false) => {
        if (!force && isFresh("orgs")) return;
        setOrgsLoading(true);
        try {
            const res = await fetch(`${API}/superadmin/organizations`, { headers: superAdminHeaders() });
            if (!res.ok) throw new Error();
            setOrgs(await res.json());
            markFresh("orgs");
        } catch {
            toast.error("Error al cargar organizaciones");
        } finally {
            setOrgsLoading(false);
        }
    }, []);

    const fetchUsers = useCallback(async (page = 1, orgId = "", force = false) => {
        const key = `users-${page}-${orgId}`;
        if (!force && isFresh(key)) return;
        setUsersLoading(true);
        try {
            const params = new URLSearchParams({ page: String(page) });
            if (orgId) params.set("orgId", orgId);
            const res = await fetch(`${API}/superadmin/users?${params}`, { headers: superAdminHeaders() });
            if (!res.ok) throw new Error();
            const data = await res.json();
            setUsers(data.users);
            setUsersTotal(data.total);
            markFresh(key);
        } catch {
            toast.error("Error al cargar usuarios");
        } finally {
            setUsersLoading(false);
        }
    }, []);

    const fetchAudit = useCallback(async (page = 1, force = false) => {
        const key = `audit-${page}`;
        if (!force && isFresh(key)) return;
        setAuditLoading(true);
        try {
            const res = await fetch(`${API}/superadmin/audit?page=${page}`, { headers: superAdminHeaders() });
            if (!res.ok) throw new Error();
            const data = await res.json();
            setAudit(data.entries);
            setAuditTotal(data.total);
            markFresh(key);
        } catch {
            toast.error("Error al cargar auditoría");
        } finally {
            setAuditLoading(false);
        }
    }, []);

    // Load on tab switch — respeta caché de 30s para evitar 429
    useEffect(() => {
        if (tab === "overview") fetchStats();
        if (tab === "orgs")     fetchOrgs();
        if (tab === "users")    fetchUsers(usersPage, userOrgFilter);
        if (tab === "audit")    fetchAudit(auditPage);
    }, [tab]);

    // ── Actions ───────────────────────────────────────────────────────────────

    async function toggleOrgActive(org: Org) {
        try {
            const res = await fetch(`${API}/superadmin/organizations/${org.id}`, {
                method: "PATCH",
                headers: superAdminHeaders(),
                body: JSON.stringify({ active: !org.active }),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            toast.success(org.active ? `${org.name} desactivada` : `${org.name} activada`);
            lastFetched.current["orgs"] = 0;
            fetchOrgs(true);
        } catch (e: any) {
            toast.error(e.message ?? "Error al actualizar organización");
        }
    }

    async function saveEditOrg() {
        if (!editOrg) return;
        if (!editForm.name.trim()) { toast.error("El nombre es requerido"); return; }
        setSaving(true);
        try {
            const res = await fetch(`${API}/superadmin/organizations/${editOrg.id}`, {
                method: "PATCH",
                headers: superAdminHeaders(),
                body: JSON.stringify({ name: editForm.name.trim(), type: editForm.type, plan: editForm.plan, userRoleLabel: editForm.userRoleLabel }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success(`${data.name} actualizada`);
            setEditOrg(null);
            lastFetched.current["orgs"] = 0;
            fetchOrgs(true);
        } catch (e: any) {
            toast.error(e.message ?? "Error al guardar cambios");
        } finally {
            setSaving(false);
        }
    }

    async function uploadLogo() {
        if (!editOrg || !logoFile) return;
        setLogoUploading(true);
        try {
            const formData = new FormData();
            formData.append("logo", logoFile);
            const res = await fetch(`${API}/superadmin/organizations/${editOrg.id}/logo`, {
                method: "PATCH",
                headers: { Authorization: superAdminHeaders().Authorization },
                body: formData,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success("Logo actualizado");
            setLogoFile(null);
            setEditOrg(prev => prev ? { ...prev, logoUrl: data.logoUrl } : null);
            lastFetched.current["orgs"] = 0;
            fetchOrgs(true);
        } catch (e: any) {
            toast.error(e.message ?? "Error al subir logo");
        } finally {
            setLogoUploading(false);
        }
    }

    // ── Field management ──────────────────────────────────────────────────────

    async function openConfigFields(org: Org) {
        setConfigFieldsOrg(org);
        setOrgFieldsLoading(true);
        setShowAddField(false);
        setEditingField(null);
        try {
            const res = await fetch(`${API}/superadmin/organizations/${org.id}/fields`, { headers: superAdminHeaders() });
            if (!res.ok) throw new Error();
            setOrgFields(await res.json());
        } catch {
            toast.error("Error al cargar los campos");
        } finally {
            setOrgFieldsLoading(false);
        }
    }

    function openAddField() {
        setEditingField(null);
        setFieldForm({ label: "", key: "", type: "text", required: false, options: "", placeholder: "" });
        setShowAddField(true);
    }

    function openEditField(field: RegField) {
        setShowAddField(false);
        setFieldForm({
            label: field.label,
            key: field.key,
            type: field.type,
            required: field.required,
            options: Array.isArray(field.options) ? field.options.join("\n") : "",
            placeholder: field.placeholder ?? "",
        });
        setEditingField(field);
    }

    async function saveField() {
        if (!configFieldsOrg) return;
        if (!fieldForm.label.trim() || !fieldForm.key.trim()) { toast.error("Label e identificador son requeridos"); return; }
        if ((fieldForm.type === "select" || fieldForm.type === "radio") && !fieldForm.options.trim()) {
            toast.error("Las opciones son requeridas para select/radio");
            return;
        }
        const options = fieldForm.options.trim()
            ? fieldForm.options.split("\n").map(o => o.trim()).filter(Boolean)
            : undefined;

        setFieldSaving(true);
        try {
            const body = {
                label: fieldForm.label.trim(),
                key: fieldForm.key.trim(),
                type: fieldForm.type,
                required: fieldForm.required,
                placeholder: fieldForm.placeholder.trim() || undefined,
                options,
            };
            const url = editingField
                ? `${API}/superadmin/organizations/${configFieldsOrg.id}/fields/${editingField.id}`
                : `${API}/superadmin/organizations/${configFieldsOrg.id}/fields`;
            const res = await fetch(url, {
                method: editingField ? "PATCH" : "POST",
                headers: superAdminHeaders(),
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success(editingField ? "Campo actualizado" : "Campo agregado");
            setShowAddField(false);
            setEditingField(null);
            openConfigFields(configFieldsOrg);
        } catch (e: any) {
            toast.error(e.message ?? "Error al guardar campo");
        } finally {
            setFieldSaving(false);
        }
    }

    async function deleteField(field: RegField) {
        if (!configFieldsOrg) return;
        try {
            const res = await fetch(`${API}/superadmin/organizations/${configFieldsOrg.id}/fields/${field.id}`, {
                method: "DELETE",
                headers: superAdminHeaders(),
            });
            if (!res.ok) throw new Error((await res.json()).error);
            toast.success(`Campo "${field.label}" eliminado`);
            openConfigFields(configFieldsOrg);
        } catch (e: any) {
            toast.error(e.message ?? "Error al eliminar campo");
        }
    }

    async function createOrg() {
        if (!createForm.name.trim() || !createForm.slug.trim()) {
            toast.error("Nombre y slug son requeridos");
            return;
        }
        setCreating(true);
        try {
            const res = await fetch(`${API}/superadmin/organizations`, {
                method: "POST",
                headers: superAdminHeaders(),
                body: JSON.stringify(createForm),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success(`Organización "${data.name}" creada`);
            setShowCreateOrg(false);
            setCreateForm({ name: "", slug: "", type: "school", plan: "free", userRoleLabel: "Usuario" });
            lastFetched.current["orgs"] = 0;
            lastFetched.current["overview"] = 0;
            fetchOrgs(true);
        } catch (e: any) {
            toast.error(e.message ?? "Error al crear organización");
        } finally {
            setCreating(false);
        }
    }

    async function saveCreateUser() {
        const { name, email, role, organizationId } = createUserForm;
        if (!name.trim() || !email || !role) {
            toast.error("Nombre, correo y rol son requeridos");
            return;
        }
        if (role !== "superadmin" && !organizationId) {
            toast.error("Selecciona una organización para este rol");
            return;
        }
        setUserActionLoading(true);
        try {
            const res = await fetch(`${API}/superadmin/users`, {
                method: "POST",
                headers: superAdminHeaders(),
                body: JSON.stringify({ name: name.trim(), email, role, organizationId: organizationId || undefined }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success(`Usuario ${data.email} creado`);
            setShowCreateUser(false);
            setCreateUserForm({ name: "", email: "", role: "alumno", organizationId: "" });
            lastFetched.current[`users-${usersPage}-${userOrgFilter}`] = 0;
            fetchUsers(usersPage, userOrgFilter, true);
        } catch (e: any) {
            toast.error(e.message ?? "Error al crear usuario");
        } finally {
            setUserActionLoading(false);
        }
    }

    async function saveEditUser() {
        if (!editUser) return;
        const { name, email, role, organizationId, password } = editUserForm;
        if (!name.trim() || !email || !role) { toast.error("Nombre, correo y rol son requeridos"); return; }
        if (password && password.length < 8) { toast.error("La contraseña debe tener al menos 8 caracteres"); return; }
        setUserActionLoading(true);
        try {
            const body: any = { name: name.trim(), email, role, organizationId: organizationId || null };
            if (password) body.password = password;
            const res = await fetch(`${API}/superadmin/users/${editUser.id}`, {
                method: "PATCH",
                headers: superAdminHeaders(),
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success("Usuario actualizado");
            setEditUser(null);
            lastFetched.current[`users-${usersPage}-${userOrgFilter}`] = 0;
            fetchUsers(usersPage, userOrgFilter, true);
        } catch (e: any) {
            toast.error(e.message ?? "Error al actualizar usuario");
        } finally {
            setUserActionLoading(false);
        }
    }

    async function confirmDeleteUser() {
        if (!deleteUserId) return;
        setUserActionLoading(true);
        try {
            const res = await fetch(`${API}/superadmin/users/${deleteUserId}`, {
                method: "DELETE",
                headers: superAdminHeaders(),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success("Usuario eliminado");
            setDeleteUserId(null);
            lastFetched.current[`users-${usersPage}-${userOrgFilter}`] = 0;
            fetchUsers(usersPage, userOrgFilter, true);
        } catch (e: any) {
            toast.error(e.message ?? "Error al eliminar usuario");
        } finally {
            setUserActionLoading(false);
        }
    }

    async function designateAdmin() {
        if (!designOrg) return;
        if (!adminForm.name.trim() || !adminForm.email) {
            toast.error("Nombre y correo son requeridos");
            return;
        }
        setDesignating(true);
        try {
            const res = await fetch(`${API}/superadmin/users/organizations/${designOrg.id}/admin`, {
                method: "POST",
                headers: superAdminHeaders(),
                body: JSON.stringify({ name: adminForm.name, email: adminForm.email }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success(`Admin creado para ${designOrg.name}. Se envió correo con credenciales.`);
            setDesignOrg(null);
            setAdminForm({ name: "", email: "", password: "" });
        } catch (e: any) {
            toast.error(e.message ?? "Error al designar administrador");
        } finally {
            setDesignating(false);
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────

    const filteredOrgs = orgs.filter(o =>
        o.name.toLowerCase().includes(orgSearch.toLowerCase()) ||
        o.slug.toLowerCase().includes(orgSearch.toLowerCase())
    );

    const TABS = [
        { key: "overview", label: "Overview",       icon: Globe },
        { key: "orgs",     label: "Organizaciones", icon: Building2 },
        { key: "users",    label: "Usuarios",        icon: Users },
        { key: "audit",    label: "Auditoría",       icon: ShieldCheck },
    ] as const;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">

            {/* Top bar */}
            <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ShieldCheck className="w-5 h-5 text-rose-400" />
                        <span className="font-bold text-white tracking-tight">Super Admin</span>
                        <span className="text-slate-600">|</span>
                        <span className="text-xs text-slate-400 font-mono">{user?.email}</span>
                    </div>
                    <button
                        onClick={onLogout}
                        className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-400 transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        Salir
                    </button>

                </div>
            </header>

            <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

                {/* Tab nav */}
                <nav className="flex gap-1 bg-slate-900 p-1 rounded-xl w-fit">
                    {TABS.map(({ key, label, icon: Icon }) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                tab === key
                                    ? "bg-slate-700 text-white"
                                    : "text-slate-400 hover:text-white"
                            }`}
                        >
                            <Icon className="w-4 h-4" />
                            {label}
                        </button>
                    ))}
                </nav>

                {/* ── OVERVIEW ──────────────────────────────────────────────── */}
                {tab === "overview" && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-white">Resumen de plataforma</h2>
                            <button onClick={() => fetchStats(true)} className="text-slate-400 hover:text-white transition-colors">
                                <RefreshCw className={`w-4 h-4 ${statsLoading ? "animate-spin" : ""}`} />
                            </button>
                        </div>

                        {statsLoading ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {[...Array(4)].map((_, i) => (
                                    <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />
                                ))}
                            </div>
                        ) : stats && (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <StatTile icon={Building2} label="Organizaciones" value={stats.orgs.total} sub={`${stats.orgs.active} activas`} color="indigo" />
                                    <StatTile icon={Users}       label="Usuarios"       value={stats.users.total} sub={`${(stats.users.byRole.alumno ?? 0) + (stats.users.byRole.usuario ?? 0)} end-users`} color="teal" />
                                    <StatTile icon={CalendarCheck} label="Citas"        value={stats.appointments.total} color="blue" />
                                    <StatTile icon={ShieldCheck}  label="Administradores" value={stats.users.byRole.admin ?? 0} color="rose" />
                                </div>

                                {/* Recent audit */}
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Actividad reciente</h3>
                                    <div className="bg-slate-900 rounded-xl overflow-hidden">
                                        {stats.recentAudit.length === 0 ? (
                                            <p className="text-slate-500 text-sm p-4 text-center">Sin actividad registrada aún</p>
                                        ) : stats.recentAudit.map(entry => (
                                            <AuditRow key={entry.id} entry={entry} />
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* ── ORGANIZACIONES ────────────────────────────────────────── */}
                {tab === "orgs" && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                            <h2 className="text-xl font-bold text-white">Organizaciones</h2>
                            <div className="flex items-center gap-2">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        value={orgSearch}
                                        onChange={e => setOrgSearch(e.target.value)}
                                        placeholder="Buscar..."
                                        className="bg-slate-800 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 w-48"
                                    />
                                </div>
                                <button
                                    onClick={() => setShowCreateOrg(true)}
                                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                                >
                                    <Plus className="w-4 h-4" /> Nueva org
                                </button>
                            </div>
                        </div>

                        {orgsLoading ? (
                            <div className="space-y-3">
                                {[...Array(3)].map((_, i) => (
                                    <div key={i} className="h-20 bg-slate-800 rounded-xl animate-pulse" />
                                ))}
                            </div>
                        ) : filteredOrgs.length === 0 ? (
                            <p className="text-slate-500 text-sm text-center py-12">No hay organizaciones</p>
                        ) : (
                            <div className="space-y-3">
                                {filteredOrgs.map(org => {
                                    const Icon = ORG_TYPE_ICON[org.type] ?? Globe;
                                    return (
                                        <div key={org.id} className={`bg-slate-900 rounded-xl p-4 border ${org.active ? "border-slate-800" : "border-slate-700 opacity-60"}`}>
                                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${org.active ? "bg-indigo-900/50" : "bg-slate-800"}`}>
                                                        <Icon className={`w-5 h-5 ${org.active ? "text-indigo-400" : "text-slate-500"}`} />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold text-white">{org.name}</span>
                                                            <span className="text-xs text-slate-500 font-mono">/{org.slug}</span>
                                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_COLOR[org.plan] ?? PLAN_COLOR.free}`}>{org.plan}</span>
                                                            {!org.active && <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 font-medium">Inactiva</span>}
                                                        </div>
                                                        <p className="text-xs text-slate-400 mt-0.5">{ORG_TYPE_LABEL[org.type] ?? org.type} · Creada {fmtDate(org.createdAt)}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex gap-4 text-center">
                                                        <div><p className="text-lg font-bold text-white">{org._count.users}</p><p className="text-xs text-slate-500">usuarios</p></div>
                                                        <div><p className="text-lg font-bold text-white">{org._count.specialists}</p><p className="text-xs text-slate-500">especialistas</p></div>
                                                        <div><p className="text-lg font-bold text-white">{org._count.appointments}</p><p className="text-xs text-slate-500">citas</p></div>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => { setDesignOrg(org); setAdminForm({ name: "", email: "", password: "" }); }}
                                                            className="text-xs px-3 py-1.5 rounded-lg bg-teal-900/40 text-teal-400 hover:bg-teal-900/70 transition-colors font-medium"
                                                        >
                                                            Designar admin
                                                        </button>
                                                        <button
                                                            onClick={() => openConfigFields(org)}
                                                            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors font-medium"
                                                            title="Configurar campos de registro"
                                                        >
                                                            Campos
                                                        </button>
                                                        <button
                                                            onClick={() => { setEditOrg(org); setEditForm({ name: org.name, type: org.type, plan: org.plan, userRoleLabel: org.userRoleLabel ?? "Usuario" }); setLogoFile(null); }}
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-indigo-900/20 transition-colors"
                                                            title="Editar"
                                                        >
                                                            <Pencil className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => toggleOrgActive(org)}
                                                            className={`p-1.5 rounded-lg transition-colors ${org.active ? "text-slate-400 hover:text-red-400 hover:bg-red-900/20" : "text-green-400 hover:bg-green-900/20"}`}
                                                            title={org.active ? "Desactivar" : "Activar"}
                                                        >
                                                            {org.active ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* ── USUARIOS ──────────────────────────────────────────────── */}
                {tab === "users" && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                            <h2 className="text-xl font-bold text-white">Usuarios globales <span className="text-slate-500 text-base font-normal">({usersTotal})</span></h2>
                            <div className="flex items-center gap-2 flex-wrap">
                                <select
                                    value={userOrgFilter}
                                    onChange={e => { setUserOrgFilter(e.target.value); setUsersPage(1); fetchUsers(1, e.target.value, true); }}
                                    className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                                >
                                    <option value="">Todas las orgs</option>
                                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </select>
                                <button
                                    onClick={() => { setCreateUserForm({ name: "", email: "", password: "", role: "alumno", organizationId: "" }); setShowCreateUser(true); }}
                                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                                >
                                    <Plus className="w-4 h-4" /> Nuevo usuario
                                </button>
                                <button onClick={() => fetchUsers(usersPage, userOrgFilter, true)} className="text-slate-400 hover:text-white transition-colors">
                                    <RefreshCw className={`w-4 h-4 ${usersLoading ? "animate-spin" : ""}`} />
                                </button>
                            </div>
                        </div>

                        <div className="bg-slate-900 rounded-xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-800">
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Usuario</th>
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3">Rol</th>
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 hidden md:table-cell">Organización</th>
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 hidden lg:table-cell">Registrado</th>
                                        <th className="px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {usersLoading ? (
                                        <tr><td colSpan={5} className="text-center py-8 text-slate-500">Cargando...</td></tr>
                                    ) : users.length === 0 ? (
                                        <tr><td colSpan={5} className="text-center py-8 text-slate-500">Sin usuarios</td></tr>
                                    ) : users.map(u => (
                                        <tr key={u.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-white">{u.name}</p>
                                                <p className="text-xs text-slate-500">{u.email}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLOR[u.role] ?? "bg-slate-100 text-slate-600"}`}>{u.role}</span>
                                            </td>
                                            <td className="px-4 py-3 hidden md:table-cell">
                                                <span className="text-slate-300">{u.organization?.name ?? <span className="text-slate-600 italic">Sin org</span>}</span>
                                            </td>
                                            <td className="px-4 py-3 hidden lg:table-cell text-slate-400 text-xs">{fmtDate(u.createdAt)}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-1 justify-end">
                                                    <button
                                                        onClick={() => { setEditUser(u); setEditUserForm({ name: u.name, email: u.email, role: u.role, organizationId: u.organizationId ?? "", password: "" }); }}
                                                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-indigo-900/20 transition-colors"
                                                        title="Editar"
                                                    ><Pencil className="w-3.5 h-3.5" /></button>
                                                    {u.role !== "superadmin" && (
                                                        <button
                                                            onClick={() => setDeleteUserId(u.id)}
                                                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                                                            title="Eliminar"
                                                        ><PowerOff className="w-3.5 h-3.5" /></button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {usersTotal > 50 && (
                                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 text-xs text-slate-400">
                                    <span>{(usersPage - 1) * 50 + 1}–{Math.min(usersPage * 50, usersTotal)} de {usersTotal}</span>
                                    <div className="flex gap-2">
                                        <button disabled={usersPage <= 1} onClick={() => { setUsersPage(p => p - 1); fetchUsers(usersPage - 1, userOrgFilter); }} className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40">Anterior</button>
                                        <button disabled={usersPage * 50 >= usersTotal} onClick={() => { setUsersPage(p => p + 1); fetchUsers(usersPage + 1, userOrgFilter); }} className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40">Siguiente</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── AUDITORÍA ─────────────────────────────────────────────── */}
                {tab === "audit" && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-bold text-white">Registro de auditoría <span className="text-slate-500 text-base font-normal">({auditTotal})</span></h2>
                            <button onClick={() => fetchAudit(auditPage, true)} className="text-slate-400 hover:text-white transition-colors">
                                <RefreshCw className={`w-4 h-4 ${auditLoading ? "animate-spin" : ""}`} />
                            </button>
                        </div>
                        <div className="bg-slate-900 rounded-xl overflow-hidden">
                            {auditLoading ? (
                                <p className="text-center py-8 text-slate-500">Cargando...</p>
                            ) : audit.length === 0 ? (
                                <p className="text-center py-8 text-slate-500">Sin entradas de auditoría</p>
                            ) : audit.map(entry => (
                                <AuditRow key={entry.id} entry={entry} verbose />
                            ))}
                            {auditTotal > 100 && (
                                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-800 text-xs text-slate-400">
                                    <span>Página {auditPage}</span>
                                    <div className="flex gap-2">
                                        <button disabled={auditPage <= 1} onClick={() => { setAuditPage(p => p - 1); fetchAudit(auditPage - 1); }} className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40">Anterior</button>
                                        <button disabled={auditPage * 100 >= auditTotal} onClick={() => { setAuditPage(p => p + 1); fetchAudit(auditPage + 1); }} className="px-2 py-1 rounded bg-slate-800 disabled:opacity-40">Siguiente</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Modal: Crear org ─────────────────────────────────────────── */}
            {showCreateOrg && (
                <Modal title="Nueva organización" onClose={() => setShowCreateOrg(false)}>
                    <div className="space-y-4">
                        <Field label="Nombre" value={createForm.name} onChange={v => setCreateForm(f => ({ ...f, name: v, slug: v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') }))} placeholder="TECNL" />
                        <Field label="Slug (URL)" value={createForm.slug} onChange={v => setCreateForm(f => ({ ...f, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} placeholder="tecnl" mono />
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Tipo</label>
                            <select value={createForm.type} onChange={e => setCreateForm(f => ({ ...f, type: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                                <option value="school">Institución Educativa</option>
                                <option value="hospital">Hospital / Clínica</option>
                                <option value="company">Empresa</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Plan</label>
                            <select value={createForm.plan} onChange={e => setCreateForm(f => ({ ...f, plan: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                                <option value="free">Free</option>
                                <option value="basic">Basic</option>
                                <option value="enterprise">Enterprise</option>
                            </select>
                        </div>
                        <Field label="Cómo se llaman los usuarios" value={createForm.userRoleLabel} onChange={v => setCreateForm(f => ({ ...f, userRoleLabel: v }))} placeholder="Alumno / Paciente / Empleado" />
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setShowCreateOrg(false)} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors">Cancelar</button>
                            <button onClick={createOrg} disabled={creating} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors">
                                {creating ? "Creando..." : "Crear organización"}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* ── Modal: Crear usuario ─────────────────────────────────────── */}
            {showCreateUser && (
                <Modal title="Nuevo usuario" onClose={() => setShowCreateUser(false)}>
                    <div className="space-y-4">
                        <div className="flex items-start gap-2 p-3 bg-teal-900/20 border border-teal-800/40 rounded-lg text-xs text-teal-300">
                            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>El usuario recibirá un correo para activar su cuenta y elegir su contraseña.</span>
                        </div>
                        <Field label="Nombre completo" value={createUserForm.name} onChange={v => setCreateUserForm(f => ({ ...f, name: v }))} placeholder="Ana García" />
                        <Field label="Correo" value={createUserForm.email} onChange={v => setCreateUserForm(f => ({ ...f, email: v }))} placeholder="usuario@org.com" type="email" />
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Rol</label>
                            <select value={createUserForm.role} onChange={e => setCreateUserForm(f => ({ ...f, role: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                                <option value="alumno">Alumno (escuela)</option>
                                <option value="usuario">Usuario (empresa / hospital)</option>
                                <option value="especialista">Especialista</option>
                                <option value="admin">Admin</option>
                                <option value="superadmin">SuperAdmin</option>
                            </select>
                        </div>
                        {createUserForm.role !== "superadmin" && (
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-1">Organización</label>
                                <select value={createUserForm.organizationId} onChange={e => setCreateUserForm(f => ({ ...f, organizationId: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                                    <option value="">Seleccionar...</option>
                                    {orgs.filter(o => o.active).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </select>
                            </div>
                        )}
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setShowCreateUser(false)} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors">Cancelar</button>
                            <button onClick={saveCreateUser} disabled={userActionLoading} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors">
                                {userActionLoading ? "Creando..." : "Crear usuario"}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* ── Modal: Editar usuario ─────────────────────────────────────── */}
            {editUser && (
                <Modal title={`Editar — ${editUser.name}`} onClose={() => setEditUser(null)}>
                    <div className="space-y-4">
                        <Field label="Nombre completo" value={editUserForm.name} onChange={v => setEditUserForm(f => ({ ...f, name: v }))} placeholder="Ana García" />
                        <Field label="Correo" value={editUserForm.email} onChange={v => setEditUserForm(f => ({ ...f, email: v }))} type="email" placeholder="usuario@org.com" />
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Rol</label>
                            <select value={editUserForm.role} onChange={e => setEditUserForm(f => ({ ...f, role: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                                <option value="alumno">Alumno (escuela)</option>
                                <option value="usuario">Usuario (empresa / hospital)</option>
                                <option value="especialista">Especialista</option>
                                <option value="admin">Admin</option>
                                <option value="superadmin">SuperAdmin</option>
                            </select>
                        </div>
                        {editUserForm.role !== "superadmin" && (
                            <div>
                                <label className="block text-xs font-medium text-slate-400 mb-1">Organización</label>
                                <select value={editUserForm.organizationId} onChange={e => setEditUserForm(f => ({ ...f, organizationId: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                                    <option value="">Sin organización</option>
                                    {orgs.filter(o => o.active).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </select>
                            </div>
                        )}
                        <Field label="Nueva contraseña (opcional)" value={editUserForm.password} onChange={v => setEditUserForm(f => ({ ...f, password: v }))} placeholder="Dejar vacío para no cambiar" type="password" />
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setEditUser(null)} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors">Cancelar</button>
                            <button onClick={saveEditUser} disabled={userActionLoading} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors">
                                {userActionLoading ? "Guardando..." : "Guardar cambios"}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* ── Modal: Confirmar eliminación ──────────────────────────────── */}
            {deleteUserId && (
                <Modal title="Confirmar eliminación" onClose={() => setDeleteUserId(null)}>
                    <div className="space-y-4">
                        <div className="flex items-start gap-2 p-3 bg-red-900/20 border border-red-800/40 rounded-lg text-xs text-red-300">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>Esta acción es irreversible. Se eliminarán todos los datos asociados al usuario.</span>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setDeleteUserId(null)} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors">Cancelar</button>
                            <button onClick={confirmDeleteUser} disabled={userActionLoading} className="px-4 py-2 rounded-lg text-sm font-medium bg-red-700 hover:bg-red-600 text-white disabled:opacity-50 transition-colors">
                                {userActionLoading ? "Eliminando..." : "Sí, eliminar"}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* ── Modal: Configurar campos de registro ─────────────────────── */}
            {configFieldsOrg && (
                <Modal title={`Campos de registro — ${configFieldsOrg.name}`} onClose={() => { setConfigFieldsOrg(null); setShowAddField(false); setEditingField(null); }}>
                    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">

                        {/* Lista de campos existentes */}
                        {orgFieldsLoading ? (
                            <p className="text-sm text-slate-400 text-center py-4">Cargando...</p>
                        ) : orgFields.length === 0 && !showAddField ? (
                            <p className="text-sm text-slate-500 text-center py-4">Sin campos configurados aún.</p>
                        ) : (
                            <div className="space-y-2">
                                {orgFields.map(field => (
                                    <div key={field.id} className={`flex items-center justify-between gap-2 p-3 rounded-lg border ${editingField?.id === field.id ? "border-indigo-500 bg-indigo-900/10" : "border-slate-700 bg-slate-800/50"}`}>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium text-white">{field.label}</span>
                                                <span className="text-xs font-mono text-slate-500">{field.key}</span>
                                                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{field.type}</span>
                                                {field.required && <span className="text-xs text-rose-400">requerido</span>}
                                            </div>
                                            {Array.isArray(field.options) && field.options.length > 0 && (
                                                <p className="text-xs text-slate-500 mt-0.5 truncate">{field.options.join(", ")}</p>
                                            )}
                                        </div>
                                        <div className="flex gap-1.5 shrink-0">
                                            <button onClick={() => openEditField(field)} className="p-1.5 rounded text-slate-400 hover:text-indigo-400 hover:bg-indigo-900/20 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                                            <button onClick={() => deleteField(field)} className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-red-900/20 transition-colors"><PowerOff className="w-3.5 h-3.5" /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Formulario agregar / editar campo */}
                        {(showAddField || editingField) && (
                            <div className="border border-slate-600 rounded-xl p-4 space-y-3 bg-slate-800/40">
                                <p className="text-xs font-semibold text-slate-300 uppercase tracking-wider">{editingField ? "Editar campo" : "Nuevo campo"}</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Label <span className="text-rose-400">*</span></label>
                                        <input value={fieldForm.label} onChange={e => {
                                            const label = e.target.value;
                                            setFieldForm(f => ({
                                                ...f, label,
                                                key: editingField ? f.key : label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
                                            }));
                                        }} placeholder="Número de Control" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Identificador <span className="text-rose-400">*</span></label>
                                        <input value={fieldForm.key} onChange={e => setFieldForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))} placeholder="numero_control" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white font-mono placeholder:text-slate-500 focus:outline-none focus:border-indigo-500" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Tipo</label>
                                        <select value={fieldForm.type} onChange={e => setFieldForm(f => ({ ...f, type: e.target.value }))} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500">
                                            <option value="text">Texto</option>
                                            <option value="number">Número</option>
                                            <option value="select">Select</option>
                                            <option value="date">Fecha</option>
                                            <option value="radio">Radio</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Placeholder</label>
                                        <input value={fieldForm.placeholder} onChange={e => setFieldForm(f => ({ ...f, placeholder: e.target.value }))} placeholder="Ej. L20123456" className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500" />
                                    </div>
                                </div>
                                {(fieldForm.type === "select" || fieldForm.type === "radio") && (
                                    <div>
                                        <label className="block text-xs text-slate-400 mb-1">Opciones <span className="text-slate-500">(una por línea)</span></label>
                                        <textarea value={fieldForm.options} onChange={e => setFieldForm(f => ({ ...f, options: e.target.value }))} rows={4} placeholder={"Opción 1\nOpción 2\nOpción 3"} className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 resize-none" />
                                    </div>
                                )}
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={fieldForm.required} onChange={e => setFieldForm(f => ({ ...f, required: e.target.checked }))} className="w-4 h-4 rounded accent-indigo-500" />
                                    <span className="text-sm text-slate-300">Campo requerido</span>
                                </label>
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => { setShowAddField(false); setEditingField(null); }} className="px-3 py-1.5 text-sm text-slate-400 hover:text-white transition-colors">Cancelar</button>
                                    <button onClick={saveField} disabled={fieldSaving} className="px-4 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50 transition-colors">
                                        {fieldSaving ? "Guardando..." : editingField ? "Guardar cambios" : "Agregar campo"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {!showAddField && !editingField && (
                            <button onClick={openAddField} className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-slate-600 rounded-xl text-sm text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
                                <Plus className="w-4 h-4" /> Agregar campo
                            </button>
                        )}
                    </div>
                </Modal>
            )}

            {/* ── Modal: Editar org ────────────────────────────────────────── */}
            {editOrg && (
                <Modal title={`Editar — ${editOrg.name}`} onClose={() => { setEditOrg(null); setLogoFile(null); }}>
                    <div className="space-y-4">
                        <Field label="Nombre" value={editForm.name} onChange={v => setEditForm(f => ({ ...f, name: v }))} placeholder="TECNL" />
                        <Field label="Cómo se llaman los usuarios" value={editForm.userRoleLabel} onChange={v => setEditForm(f => ({ ...f, userRoleLabel: v }))} placeholder="Alumno / Paciente / Empleado" />
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Tipo</label>
                            <select value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                                <option value="school">Institución Educativa</option>
                                <option value="hospital">Hospital / Clínica</option>
                                <option value="company">Empresa</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Plan</label>
                            <select value={editForm.plan} onChange={e => setEditForm(f => ({ ...f, plan: e.target.value }))} className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                                <option value="free">Free</option>
                                <option value="basic">Basic</option>
                                <option value="enterprise">Enterprise</option>
                            </select>
                        </div>

                        {/* Logo upload */}
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-2">Logo de la organización</label>
                            <div className="flex items-center gap-3">
                                {(() => {
                                    const logoSrc = logoFile
                                        ? URL.createObjectURL(logoFile)
                                        : getImageUrl(editOrg.logoUrl?.startsWith('/uploads/') ? editOrg.logoUrl : undefined);
                                    return logoSrc ? (
                                        <img
                                            src={logoSrc}
                                            alt="Logo"
                                            className="w-14 h-14 rounded-xl object-contain bg-slate-800 border border-slate-700 p-1"
                                        />
                                    ) : (
                                        <div className="w-14 h-14 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-500 text-xs">Sin logo</div>
                                    );
                                })()}
                                <div className="flex-1 space-y-1.5">
                                    <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={e => setLogoFile(e.target.files?.[0] ?? null)} />
                                    <button onClick={() => logoInputRef.current?.click()} className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors">
                                        {logoFile ? logoFile.name : "Seleccionar imagen"}
                                    </button>
                                    {logoFile && (
                                        <button onClick={uploadLogo} disabled={logoUploading} className="w-full px-3 py-1.5 rounded-lg text-xs bg-teal-700 hover:bg-teal-600 text-white disabled:opacity-50 transition-colors">
                                            {logoUploading ? "Subiendo..." : "Subir logo"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => { setEditOrg(null); setLogoFile(null); }} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors">Cancelar</button>
                            <button onClick={saveEditOrg} disabled={saving} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors">
                                {saving ? "Guardando..." : "Guardar cambios"}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* ── Modal: Designar admin ────────────────────────────────────── */}
            {designOrg && (
                <Modal title={`Designar admin — ${designOrg.name}`} onClose={() => setDesignOrg(null)}>
                    <div className="space-y-4">
                        <div className="flex items-start gap-2 p-3 bg-amber-900/20 border border-amber-800/40 rounded-lg text-xs text-amber-300">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>Se creará una cuenta de administrador y se enviarán las credenciales al correo indicado.</span>
                        </div>
                        <div className="flex items-start gap-2 p-3 bg-teal-900/20 border border-teal-800/40 rounded-lg text-xs text-teal-300">
                            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>El administrador recibirá un correo para activar su cuenta y elegir su contraseña.</span>
                        </div>
                        <Field label="Nombre completo" value={adminForm.name} onChange={v => setAdminForm(f => ({ ...f, name: v }))} placeholder="Director TECNL" />
                        <Field label="Correo" value={adminForm.email} onChange={v => setAdminForm(f => ({ ...f, email: v }))} placeholder="admin@org.com" type="email" />
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setDesignOrg(null)} className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors">Cancelar</button>
                            <button onClick={designateAdmin} disabled={designating} className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 transition-colors">
                                {designating ? "Creando..." : "Designar administrador"}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatTile({ icon: Icon, label, value, sub, color }: {
    icon: React.ElementType; label: string; value: number; sub?: string; color: string;
}) {
    const colors: Record<string, string> = {
        indigo: "bg-indigo-900/30 text-indigo-400",
        teal:   "bg-teal-900/30 text-teal-400",
        blue:   "bg-blue-900/30 text-blue-400",
        rose:   "bg-rose-900/30 text-rose-400",
    };
    return (
        <div className="bg-slate-900 rounded-xl p-4">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${colors[color]}`}>
                <Icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-white">{value.toLocaleString()}</p>
            <p className="text-xs text-slate-400 mt-0.5">{label}</p>
            {sub && <p className="text-xs text-slate-600 mt-0.5">{sub}</p>}
        </div>
    );
}

const ACTION_COLOR: Record<string, string> = {
    CREATE_ORGANIZATION:  "text-teal-400",
    UPDATE_ORGANIZATION:  "text-blue-400",
    DEACTIVATE_ORGANIZATION: "text-amber-400",
    DELETE_ORGANIZATION:  "text-red-400",
    CREATE_ORG_ADMIN:     "text-indigo-400",
};

function AuditRow({ entry, verbose = false }: { entry: AuditEntry; verbose?: boolean }) {
    return (
        <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
            <Clock className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-mono font-semibold ${ACTION_COLOR[entry.action] ?? "text-slate-300"}`}>{entry.action}</span>
                    <span className="text-xs text-slate-500">{entry.targetEntity} · {entry.targetId.slice(0, 8)}…</span>
                </div>
                {verbose && entry.metadata && (
                    <p className="text-xs text-slate-600 mt-0.5 truncate">{JSON.stringify(entry.metadata)}</p>
                )}
            </div>
            <div className="text-right shrink-0">
                <p className="text-xs text-slate-500">{fmtDateTime(entry.createdAt)}</p>
                {verbose && entry.ipAddress && <p className="text-xs text-slate-700 font-mono">{entry.ipAddress}</p>}
            </div>
        </div>
    );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
                    <h3 className="font-semibold text-white">{title}</h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors text-xl leading-none">×</button>
                </div>
                <div className="px-6 py-5">{children}</div>
            </div>
        </div>
    );
}

function Field({ label, value, onChange, placeholder, type = "text", mono = false }: {
    label: string; value: string; onChange: (v: string) => void;
    placeholder?: string; type?: string; mono?: boolean;
}) {
    return (
        <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
            <input
                type={type}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                className={`w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 ${mono ? "font-mono" : ""}`}
            />
        </div>
    );
}
