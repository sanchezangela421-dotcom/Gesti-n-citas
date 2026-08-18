import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
    Building2, Users, CalendarCheck, ShieldCheck, Plus,
    Power, PowerOff, Search, RefreshCw, Pencil,
    Globe, Stethoscope, GraduationCap, Briefcase,
    AlertTriangle, Clock, LogOut, Trash2, Sun, Moon,
} from "lucide-react";
import { API, superAdminHeaders, getUploadUrl } from "../../../lib/api";
import { useTheme } from "../../hooks/useTheme";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Org {
    id: string;
    name: string;
    slug: string;
    type: string;
    plan: string;
    active: boolean;
    userRoleLabel: string;
    departments: string[];
    logoUrl?: string | null;
    createdAt: string;
    _count: { users: number; specialists: number; appointments: number };
}

interface OrgDept {
    id: string;
    name: string;
    color: string;
    icon: string;
    requiresNote: boolean;
    active: boolean;
    order: number;
}

/** Iconos ofrecidos al crear un departamento. El servidor guarda el NOMBRE. */
const DEPT_ICON_CHOICES = [
    'Stethoscope', 'Brain', 'GraduationCap', 'Apple', 'HeartHandshake',
    'Heart', 'Activity', 'BookOpen', 'Users', 'Scale', 'Smile', 'Briefcase',
];

const DEPT_COLOR_CHOICES = [
    '#2563EB', '#16A34A', '#EA580C', '#7C3AED',
    '#DB2777', '#0891B2', '#CA8A04', '#64748B',
];

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
    basic:      "bg-blue-100 text-blue-700 dark:bg-blue-100 dark:text-blue-700",
    enterprise: "bg-amber-100 text-amber-700 dark:bg-amber-100 dark:text-amber-700",
};

const ROLE_COLOR: Record<string, string> = {
    superadmin:  "bg-rose-100 text-rose-700",
    admin:       "bg-indigo-100 text-indigo-700",
    especialista:"bg-teal-100 text-teal-700 dark:text-teal-300",
    alumno:      "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    usuario:     "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
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

    // ── Catálogo de departamentos por org ──
    const [deptOrg, setDeptOrg]             = useState<Org | null>(null);
    const [depts, setDepts]                 = useState<OrgDept[]>([]);
    const [deptsLoading, setDeptsLoading]   = useState(false);
    const [showAddDept, setShowAddDept]     = useState(false);
    const [editingDept, setEditingDept]     = useState<OrgDept | null>(null);
    const [deptForm, setDeptForm]           = useState({
        name: '', color: DEPT_COLOR_CHOICES[0], icon: 'Stethoscope', requiresNote: false,
    });
    const [deptSaving, setDeptSaving]       = useState(false);

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
    // El panel estaba cableado a oscuro y no seguía el tema de la app. Usa el
    // mismo hook, que escribe la clase .dark en el <html> y persiste la elección.
    const { dark, toggle: toggleTheme } = useTheme();

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
                // Sin `departments`: contratar y retirar se hace en el gestor del
                // catálogo, que además valida que el nombre exista en él.
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

    async function loadDepts(org: Org) {
        setDeptsLoading(true);
        try {
            const res = await fetch(`${API}/superadmin/organizations/${org.id}/departments`, { headers: superAdminHeaders() });
            if (res.ok) setDepts(await res.json());
        } catch {
            toast.error('No se pudo cargar el catálogo de departamentos.');
        } finally {
            setDeptsLoading(false);
        }
    }

    function openDepts(org: Org) {
        setDeptOrg(org);
        setDepts([]);
        setShowAddDept(false);
        setEditingDept(null);
        loadDepts(org);
    }

    function startEditDept(dept: OrgDept) {
        setEditingDept(dept);
        setShowAddDept(true);
        setDeptForm({ name: dept.name, color: dept.color, icon: dept.icon, requiresNote: dept.requiresNote });
    }

    function startAddDept() {
        setEditingDept(null);
        setShowAddDept(true);
        setDeptForm({ name: '', color: DEPT_COLOR_CHOICES[0], icon: 'Stethoscope', requiresNote: false });
    }

    async function saveDept() {
        if (!deptOrg) return;
        const name = deptForm.name.trim();
        if (name.length < 2) { toast.error('El nombre debe tener al menos 2 caracteres.'); return; }

        setDeptSaving(true);
        try {
            const base = `${API}/superadmin/organizations/${deptOrg.id}/departments`;
            const res = await fetch(editingDept ? `${base}/${editingDept.id}` : base, {
                method: editingDept ? 'PATCH' : 'POST',
                headers: superAdminHeaders(),
                body: JSON.stringify({ name, color: deptForm.color, icon: deptForm.icon, requiresNote: deptForm.requiresNote }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            toast.success(editingDept ? 'Departamento actualizado' : `Departamento "${name}" creado`);
            setShowAddDept(false);
            setEditingDept(null);
            await loadDepts(deptOrg);
            fetchOrgs(true);
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : 'No se pudo guardar el departamento.');
        } finally {
            setDeptSaving(false);
        }
    }

    /** Contratar o retirar. Retirar NO cancela citas: solo bloquea las nuevas. */
    async function toggleDept(dept: OrgDept) {
        if (!deptOrg) return;
        try {
            const res = await fetch(`${API}/superadmin/organizations/${deptOrg.id}/departments/${dept.id}`, {
                method: 'PATCH',
                headers: superAdminHeaders(),
                body: JSON.stringify({ active: !dept.active }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success(dept.active
                ? `"${dept.name}" retirado. Las citas ya agendadas se respetan.`
                : `"${dept.name}" contratado de nuevo.`);
            await loadDepts(deptOrg);
            fetchOrgs(true);
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : 'No se pudo cambiar el departamento.');
        }
    }

    async function deleteDept(dept: OrgDept) {
        if (!deptOrg) return;
        try {
            const res = await fetch(`${API}/superadmin/organizations/${deptOrg.id}/departments/${dept.id}`, {
                method: 'DELETE',
                headers: superAdminHeaders(),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            toast.success(`Departamento "${dept.name}" eliminado`);
            await loadDepts(deptOrg);
            fetchOrgs(true);
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : 'No se pudo eliminar el departamento.');
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
            toast.success("Usuario dado de baja");
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
        <div className="min-h-screen bg-background text-foreground">

            {/* Top bar */}
            <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <ShieldCheck className="w-5 h-5 text-rose-700" />
                        <span className="font-bold text-foreground tracking-tight">Super Admin</span>
                        <span className="text-muted-foreground">|</span>
                        <span className="text-xs text-muted-foreground font-mono">{user?.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleTheme}
                            title={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                            aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                        >
                            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={onLogout}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-rose-700 transition-colors cursor-pointer"
                        >
                            <LogOut className="w-4 h-4" />
                            Salir
                        </button>
                    </div>

                </div>
            </header>

            <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

                {/* Tab nav */}
                <nav className="flex gap-1 bg-card p-1 rounded-xl w-fit">
                    {TABS.map(({ key, label, icon: Icon }) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                tab === key
                                    ? "bg-card text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
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
                            <h2 className="text-xl font-bold text-foreground">Resumen de plataforma</h2>
                            <button onClick={() => fetchStats(true)} className="text-muted-foreground hover:text-foreground transition-colors">
                                <RefreshCw className={`w-4 h-4 ${statsLoading ? "animate-spin" : ""}`} />
                            </button>
                        </div>

                        {statsLoading ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {[...Array(4)].map((_, i) => (
                                    <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
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
                                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Actividad reciente</h3>
                                    <div className="bg-card rounded-xl overflow-hidden">
                                        {stats.recentAudit.length === 0 ? (
                                            <p className="text-muted-foreground text-sm p-4 text-center">Sin actividad registrada aún</p>
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
                            <h2 className="text-xl font-bold text-foreground">Organizaciones</h2>
                            <div className="flex items-center gap-2">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <input
                                        value={orgSearch}
                                        onChange={e => setOrgSearch(e.target.value)}
                                        placeholder="Buscar..."
                                        className="bg-muted border border-border rounded-lg pl-9 pr-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-indigo-500 w-48"
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
                                    <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />
                                ))}
                            </div>
                        ) : filteredOrgs.length === 0 ? (
                            <p className="text-muted-foreground text-sm text-center py-12">No hay organizaciones</p>
                        ) : (
                            <div className="space-y-3">
                                {filteredOrgs.map(org => {
                                    const Icon = ORG_TYPE_ICON[org.type] ?? Globe;
                                    return (
                                        <div key={org.id} className={`bg-card rounded-xl p-4 border ${org.active ? "border-border" : "border-border opacity-60"}`}>
                                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${org.active ? "bg-indigo-100" : "bg-muted"}`}>
                                                        <Icon className={`w-5 h-5 ${org.active ? "text-indigo-700" : "text-muted-foreground"}`} />
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold text-foreground">{org.name}</span>
                                                            <span className="text-xs text-muted-foreground font-mono">/{org.slug}</span>
                                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${PLAN_COLOR[org.plan] ?? PLAN_COLOR.free}`}>{org.plan}</span>
                                                            {!org.active && <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-medium">Inactiva</span>}
                                                        </div>
                                                        <p className="text-xs text-muted-foreground mt-0.5">{ORG_TYPE_LABEL[org.type] ?? org.type} · Creada {fmtDate(org.createdAt)}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex gap-4 text-center">
                                                        <div><p className="text-lg font-bold text-foreground">{org._count.users}</p><p className="text-xs text-muted-foreground">usuarios</p></div>
                                                        <div><p className="text-lg font-bold text-foreground">{org._count.specialists}</p><p className="text-xs text-muted-foreground">especialistas</p></div>
                                                        <div><p className="text-lg font-bold text-foreground">{org._count.appointments}</p><p className="text-xs text-muted-foreground">citas</p></div>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => { setDesignOrg(org); setAdminForm({ name: "", email: "", password: "" }); }}
                                                            className="text-xs px-3 py-1.5 rounded-lg bg-teal-100 text-teal-700 dark:text-teal-400 hover:bg-teal-200 dark:hover:bg-teal-900/70 transition-colors font-medium"
                                                        >
                                                            Designar admin
                                                        </button>
                                                        <button
                                                            onClick={() => openDepts(org)}
                                                            className="text-xs px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 transition-colors font-medium"
                                                            title="Gestionar departamentos"
                                                        >
                                                            Departamentos
                                                        </button>
                                                        <button
                                                            onClick={() => openConfigFields(org)}
                                                            className="text-xs px-3 py-1.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 transition-colors font-medium"
                                                            title="Configurar campos de registro"
                                                        >
                                                            Campos
                                                        </button>
                                                        <button
                                                            onClick={() => { setEditOrg(org); setEditForm({ name: org.name, type: org.type, plan: org.plan, userRoleLabel: org.userRoleLabel ?? "Usuario" }); setLogoFile(null); }}
                                                            className="p-1.5 rounded-lg text-muted-foreground hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
                                                            title="Editar"
                                                        >
                                                            <Pencil className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => toggleOrgActive(org)}
                                                            className={`p-1.5 rounded-lg transition-colors ${org.active ? "text-muted-foreground hover:text-rose-700 hover:bg-rose-50" : "text-green-700 dark:text-green-400 hover:bg-green-50"}`}
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
                            <h2 className="text-xl font-bold text-foreground">Usuarios globales <span className="text-muted-foreground text-base font-normal">({usersTotal})</span></h2>
                            <div className="flex items-center gap-2 flex-wrap">
                                <select
                                    value={userOrgFilter}
                                    onChange={e => { setUserOrgFilter(e.target.value); setUsersPage(1); fetchUsers(1, e.target.value, true); }}
                                    className="bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-indigo-500"
                                >
                                    <option value="">Todas las orgs</option>
                                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </select>
                                <button
                                    onClick={() => { setCreateUserForm({ name: "", email: "", role: "alumno", organizationId: "" }); setShowCreateUser(true); }}
                                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                                >
                                    <Plus className="w-4 h-4" /> Nuevo usuario
                                </button>
                                <button onClick={() => fetchUsers(usersPage, userOrgFilter, true)} className="text-muted-foreground hover:text-foreground transition-colors">
                                    <RefreshCw className={`w-4 h-4 ${usersLoading ? "animate-spin" : ""}`} />
                                </button>
                            </div>
                        </div>

                        <div className="bg-card rounded-xl overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-border">
                                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">Usuario</th>
                                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3">Rol</th>
                                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3 hidden md:table-cell">Organización</th>
                                        <th className="text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider px-4 py-3 hidden lg:table-cell">Registrado</th>
                                        <th className="px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {usersLoading ? (
                                        <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Cargando...</td></tr>
                                    ) : users.length === 0 ? (
                                        <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Sin usuarios</td></tr>
                                    ) : users.map(u => (
                                        <tr key={u.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-foreground">{u.name}</p>
                                                <p className="text-xs text-muted-foreground">{u.email}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLOR[u.role] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>{u.role}</span>
                                            </td>
                                            <td className="px-4 py-3 hidden md:table-cell">
                                                <span className="text-foreground">{u.organization?.name ?? <span className="text-muted-foreground italic">Sin org</span>}</span>
                                            </td>
                                            <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">{fmtDate(u.createdAt)}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-1 justify-end">
                                                    <button
                                                        onClick={() => { setEditUser(u); setEditUserForm({ name: u.name, email: u.email, role: u.role, organizationId: u.organizationId ?? "", password: "" }); }}
                                                        className="p-1.5 rounded-lg text-muted-foreground hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
                                                        title="Editar"
                                                    ><Pencil className="w-3.5 h-3.5" /></button>
                                                    {u.role !== "superadmin" && (
                                                        <button
                                                            onClick={() => setDeleteUserId(u.id)}
                                                            className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-700 hover:bg-rose-50 transition-colors"
                                                            title="Dar de baja"
                                                        ><PowerOff className="w-3.5 h-3.5" /></button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {usersTotal > 50 && (
                                <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
                                    <span>{(usersPage - 1) * 50 + 1}–{Math.min(usersPage * 50, usersTotal)} de {usersTotal}</span>
                                    <div className="flex gap-2">
                                        <button disabled={usersPage <= 1} onClick={() => { setUsersPage(p => p - 1); fetchUsers(usersPage - 1, userOrgFilter); }} className="px-2 py-1 rounded bg-muted disabled:opacity-40">Anterior</button>
                                        <button disabled={usersPage * 50 >= usersTotal} onClick={() => { setUsersPage(p => p + 1); fetchUsers(usersPage + 1, userOrgFilter); }} className="px-2 py-1 rounded bg-muted disabled:opacity-40">Siguiente</button>
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
                            <h2 className="text-xl font-bold text-foreground">Registro de auditoría <span className="text-muted-foreground text-base font-normal">({auditTotal})</span></h2>
                            <button onClick={() => fetchAudit(auditPage, true)} className="text-muted-foreground hover:text-foreground transition-colors">
                                <RefreshCw className={`w-4 h-4 ${auditLoading ? "animate-spin" : ""}`} />
                            </button>
                        </div>
                        <div className="bg-card rounded-xl overflow-hidden">
                            {auditLoading ? (
                                <p className="text-center py-8 text-muted-foreground">Cargando...</p>
                            ) : audit.length === 0 ? (
                                <p className="text-center py-8 text-muted-foreground">Sin entradas de auditoría</p>
                            ) : audit.map(entry => (
                                <AuditRow key={entry.id} entry={entry} verbose />
                            ))}
                            {auditTotal > 100 && (
                                <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
                                    <span>Página {auditPage}</span>
                                    <div className="flex gap-2">
                                        <button disabled={auditPage <= 1} onClick={() => { setAuditPage(p => p - 1); fetchAudit(auditPage - 1); }} className="px-2 py-1 rounded bg-muted disabled:opacity-40">Anterior</button>
                                        <button disabled={auditPage * 100 >= auditTotal} onClick={() => { setAuditPage(p => p + 1); fetchAudit(auditPage + 1); }} className="px-2 py-1 rounded bg-muted disabled:opacity-40">Siguiente</button>
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
                            <label className="block text-xs font-medium text-muted-foreground mb-1">Tipo</label>
                            <select value={createForm.type} onChange={e => setCreateForm(f => ({ ...f, type: e.target.value }))} className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-indigo-500">
                                <option value="school">Institución Educativa</option>
                                <option value="hospital">Hospital / Clínica</option>
                                <option value="company">Empresa</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">Plan</label>
                            <select value={createForm.plan} onChange={e => setCreateForm(f => ({ ...f, plan: e.target.value }))} className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-indigo-500">
                                <option value="free">Free</option>
                                <option value="basic">Basic</option>
                                <option value="enterprise">Enterprise</option>
                            </select>
                        </div>
                        <Field label="Cómo se llaman los usuarios" value={createForm.userRoleLabel} onChange={v => setCreateForm(f => ({ ...f, userRoleLabel: v }))} placeholder="Alumno / Paciente / Empleado" />
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setShowCreateOrg(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
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
                        <div className="flex items-start gap-2 p-3 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-700 dark:text-teal-300">
                            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>El usuario recibirá un correo para activar su cuenta y elegir su contraseña.</span>
                        </div>
                        <Field label="Nombre completo" value={createUserForm.name} onChange={v => setCreateUserForm(f => ({ ...f, name: v }))} placeholder="Ana García" />
                        <Field label="Correo" value={createUserForm.email} onChange={v => setCreateUserForm(f => ({ ...f, email: v }))} placeholder="usuario@org.com" type="email" />
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">Rol</label>
                            <select value={createUserForm.role} onChange={e => setCreateUserForm(f => ({ ...f, role: e.target.value }))} className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-indigo-500">
                                <option value="alumno">Alumno (escuela)</option>
                                <option value="usuario">Usuario (empresa / hospital)</option>
                                <option value="especialista">Especialista</option>
                                <option value="admin">Admin</option>
                                <option value="superadmin">SuperAdmin</option>
                            </select>
                        </div>
                        {createUserForm.role !== "superadmin" && (
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1">Organización</label>
                                <select value={createUserForm.organizationId} onChange={e => setCreateUserForm(f => ({ ...f, organizationId: e.target.value }))} className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-indigo-500">
                                    <option value="">Seleccionar...</option>
                                    {orgs.filter(o => o.active).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </select>
                            </div>
                        )}
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setShowCreateUser(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
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
                            <label className="block text-xs font-medium text-muted-foreground mb-1">Rol</label>
                            <select value={editUserForm.role} onChange={e => setEditUserForm(f => ({ ...f, role: e.target.value }))} className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-indigo-500">
                                <option value="alumno">Alumno (escuela)</option>
                                <option value="usuario">Usuario (empresa / hospital)</option>
                                <option value="especialista">Especialista</option>
                                <option value="admin">Admin</option>
                                <option value="superadmin">SuperAdmin</option>
                            </select>
                        </div>
                        {editUserForm.role !== "superadmin" && (
                            <div>
                                <label className="block text-xs font-medium text-muted-foreground mb-1">Organización</label>
                                <select value={editUserForm.organizationId} onChange={e => setEditUserForm(f => ({ ...f, organizationId: e.target.value }))} className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-indigo-500">
                                    <option value="">Sin organización</option>
                                    {orgs.filter(o => o.active).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                </select>
                            </div>
                        )}
                        <Field label="Nueva contraseña (opcional)" value={editUserForm.password} onChange={v => setEditUserForm(f => ({ ...f, password: v }))} placeholder="Dejar vacío para no cambiar" type="password" />
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setEditUser(null)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
                            <button onClick={saveEditUser} disabled={userActionLoading} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors">
                                {userActionLoading ? "Guardando..." : "Guardar cambios"}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* ── Modal: Confirmar baja de usuario ───────────────────────────── */}
            {deleteUserId && (
                <Modal title="Dar de baja al usuario" onClose={() => setDeleteUserId(null)}>
                    <div className="space-y-4">
                        <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>La cuenta dejará de tener acceso y sus sesiones abiertas se cerrarán. Los datos NO se eliminan: el expediente clínico debe conservarse (NOM-004). Un administrador puede reactivarla después.</span>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setDeleteUserId(null)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
                            <button onClick={confirmDeleteUser} disabled={userActionLoading} className="px-4 py-2 rounded-lg text-sm font-medium bg-rose-700 hover:bg-rose-600 text-white disabled:opacity-50 transition-colors">
                                {userActionLoading ? "Dando de baja..." : "Sí, dar de baja"}
                            </button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* ── Modal: Departamentos de la organización ───────────────────── */}
            {deptOrg && (
                <Modal title={`Departamentos — ${deptOrg.name}`} onClose={() => { setDeptOrg(null); setShowAddDept(false); setEditingDept(null); }}>
                    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">

                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Retirar un departamento <span className="font-semibold text-foreground">no cancela</span> las citas
                            ya agendadas: solo bloquea las nuevas y avisa por correo a quien tenga una pendiente.
                        </p>

                        {deptsLoading ? (
                            <p className="text-sm text-muted-foreground text-center py-4">Cargando...</p>
                        ) : depts.length === 0 && !showAddDept ? (
                            <p className="text-sm text-muted-foreground text-center py-4">Sin departamentos configurados.</p>
                        ) : (
                            <div className="space-y-2">
                                {depts.map(dept => (
                                    <div key={dept.id}
                                        className={`flex items-start gap-3 p-3 rounded-lg border ${dept.active ? 'bg-muted/40 border-border' : 'bg-muted/20 border-border opacity-60'}`}>
                                        <span className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ backgroundColor: dept.color }} />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-sm font-medium text-foreground">{dept.name}</span>
                                                {dept.requiresNote && (
                                                    <span className="text-[0.65rem] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-semibold uppercase tracking-wide">
                                                        Nota obligatoria
                                                    </span>
                                                )}
                                                {!dept.active && (
                                                    <span className="text-[0.65rem] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300 font-semibold uppercase tracking-wide">
                                                        Retirado
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-0.5">Icono: {dept.icon}</p>
                                        </div>
                                        <div className="flex gap-1.5 shrink-0">
                                            <button onClick={() => startEditDept(dept)} title="Editar"
                                                className="p-1.5 rounded text-muted-foreground hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors">
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                            <button onClick={() => toggleDept(dept)} title={dept.active ? 'Retirar' : 'Contratar'}
                                                className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                                                {dept.active ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                                            </button>
                                            <button onClick={() => deleteDept(dept)} title="Eliminar (solo si nunca se usó)"
                                                className="p-1.5 rounded text-muted-foreground hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {showAddDept ? (
                            <div className="space-y-3 p-3 bg-muted/40 border border-border rounded-lg">
                                <Field
                                    label="Nombre"
                                    value={deptForm.name}
                                    onChange={v => setDeptForm(f => ({ ...f, name: v }))}
                                    placeholder="Ej. Trabajo Social"
                                />
                                {!editingDept && (
                                    <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                                        El nombre no podrá cambiarse una vez que el departamento tenga citas o
                                        especialistas: el expediente lo referencia por nombre. Revísalo bien.
                                    </p>
                                )}

                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Color</label>
                                    <div className="flex flex-wrap gap-2">
                                        {DEPT_COLOR_CHOICES.map(c => (
                                            <button key={c} type="button" onClick={() => setDeptForm(f => ({ ...f, color: c }))}
                                                aria-label={`Color ${c}`}
                                                className={`w-7 h-7 rounded-full border-2 transition-transform ${deptForm.color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                                                style={{ backgroundColor: c }} />
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">Icono</label>
                                    <select value={deptForm.icon}
                                        onChange={e => setDeptForm(f => ({ ...f, icon: e.target.value }))}
                                        className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-indigo-500">
                                        {DEPT_ICON_CHOICES.map(i => <option key={i} value={i}>{i}</option>)}
                                    </select>
                                </div>

                                <label className="flex items-start gap-2.5 cursor-pointer text-sm text-foreground">
                                    <input type="checkbox" checked={deptForm.requiresNote}
                                        onChange={e => setDeptForm(f => ({ ...f, requiresNote: e.target.checked }))}
                                        className="w-4 h-4 mt-0.5 rounded border-border bg-card text-indigo-500 focus:ring-indigo-500 focus:ring-offset-background" />
                                    <span>
                                        Exige nota al cerrar la cita
                                        <span className="block text-xs text-muted-foreground font-normal">
                                            Márcalo si es atención clínica: el especialista no podrá completar la sesión sin dejar constancia.
                                        </span>
                                    </span>
                                </label>

                                <div className="flex justify-end gap-2 pt-1">
                                    <button onClick={() => { setShowAddDept(false); setEditingDept(null); }}
                                        className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">
                                        Cancelar
                                    </button>
                                    <button onClick={saveDept} disabled={deptSaving}
                                        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors">
                                        {deptSaving ? 'Guardando...' : editingDept ? 'Guardar cambios' : 'Crear departamento'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button onClick={startAddDept}
                                className="w-full py-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-indigo-500 transition-colors">
                                + Agregar departamento
                            </button>
                        )}
                    </div>
                </Modal>
            )}

            {/* ── Modal: Configurar campos de registro ─────────────────────── */}
            {configFieldsOrg && (
                <Modal title={`Campos de registro — ${configFieldsOrg.name}`} onClose={() => { setConfigFieldsOrg(null); setShowAddField(false); setEditingField(null); }}>
                    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">

                        {/* Lista de campos existentes */}
                        {orgFieldsLoading ? (
                            <p className="text-sm text-muted-foreground text-center py-4">Cargando...</p>
                        ) : orgFields.length === 0 && !showAddField ? (
                            <p className="text-sm text-muted-foreground text-center py-4">Sin campos configurados aún.</p>
                        ) : (
                            <div className="space-y-2">
                                {orgFields.map(field => (
                                    <div key={field.id} className={`flex items-center justify-between gap-2 p-3 rounded-lg border ${editingField?.id === field.id ? "border-indigo-500 bg-indigo-50" : "border-border bg-muted/50"}`}>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-sm font-medium text-foreground">{field.label}</span>
                                                <span className="text-xs font-mono text-muted-foreground">{field.key}</span>
                                                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">{field.type}</span>
                                                {field.required && <span className="text-xs text-rose-700">requerido</span>}
                                            </div>
                                            {Array.isArray(field.options) && field.options.length > 0 && (
                                                <p className="text-xs text-muted-foreground mt-0.5 truncate">{field.options.join(", ")}</p>
                                            )}
                                        </div>
                                        <div className="flex gap-1.5 shrink-0">
                                            <button onClick={() => openEditField(field)} className="p-1.5 rounded text-muted-foreground hover:text-indigo-700 hover:bg-indigo-50 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                                            <button onClick={() => deleteField(field)} title="Eliminar campo" className="p-1.5 rounded text-muted-foreground hover:text-rose-700 hover:bg-rose-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Formulario agregar / editar campo */}
                        {(showAddField || editingField) && (
                            <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/40">
                                <p className="text-xs font-semibold text-foreground uppercase tracking-wider">{editingField ? "Editar campo" : "Nuevo campo"}</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-1">Label <span className="text-rose-700">*</span></label>
                                        <input value={fieldForm.label} onChange={e => {
                                            const label = e.target.value;
                                            setFieldForm(f => ({
                                                ...f, label,
                                                key: editingField ? f.key : label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
                                            }));
                                        }} placeholder="Número de Control" className="w-full bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-indigo-500" />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-1">Identificador <span className="text-rose-700">*</span></label>
                                        <input value={fieldForm.key} onChange={e => setFieldForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))} placeholder="numero_control" className="w-full bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-indigo-500" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-1">Tipo</label>
                                        <select value={fieldForm.type} onChange={e => setFieldForm(f => ({ ...f, type: e.target.value }))} className="w-full bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-indigo-500">
                                            <option value="text">Texto</option>
                                            <option value="number">Número</option>
                                            <option value="select">Select</option>
                                            <option value="date">Fecha</option>
                                            <option value="radio">Radio</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-1">Placeholder</label>
                                        <input value={fieldForm.placeholder} onChange={e => setFieldForm(f => ({ ...f, placeholder: e.target.value }))} placeholder="Ej. L20123456" className="w-full bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-indigo-500" />
                                    </div>
                                </div>
                                {(fieldForm.type === "select" || fieldForm.type === "radio") && (
                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-1">Opciones <span className="text-muted-foreground">(una por línea)</span></label>
                                        <textarea value={fieldForm.options} onChange={e => setFieldForm(f => ({ ...f, options: e.target.value }))} rows={4} placeholder={"Opción 1\nOpción 2\nOpción 3"} className="w-full bg-muted border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-indigo-500 resize-none" />
                                    </div>
                                )}
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" checked={fieldForm.required} onChange={e => setFieldForm(f => ({ ...f, required: e.target.checked }))} className="w-4 h-4 rounded accent-indigo-500" />
                                    <span className="text-sm text-foreground">Campo requerido</span>
                                </label>
                                <div className="flex justify-end gap-2">
                                    <button onClick={() => { setShowAddField(false); setEditingField(null); }} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
                                    <button onClick={saveField} disabled={fieldSaving} className="px-4 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50 transition-colors">
                                        {fieldSaving ? "Guardando..." : editingField ? "Guardar cambios" : "Agregar campo"}
                                    </button>
                                </div>
                            </div>
                        )}

                        {!showAddField && !editingField && (
                            <button onClick={openAddField} className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:text-foreground hover:border-ring transition-colors">
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

                        {/* Los departamentos dejaron de ser tres casillas fijas: cada
                            organización tiene su catálogo, y se gestiona en su propia
                            pantalla porque ahora llevan color, icono y régimen de nota. */}
                        <div className="bg-muted/60 border border-border rounded-lg p-3">
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Los departamentos de esta organización ({editOrg.departments?.length ?? 0} contratados)
                                se gestionan desde el botón <span className="font-semibold text-foreground">Departamentos</span> de su tarjeta.
                            </p>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">Tipo</label>
                            <select value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))} className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-indigo-500">
                                <option value="school">Institución Educativa</option>
                                <option value="hospital">Hospital / Clínica</option>
                                <option value="company">Empresa</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-1">Plan</label>
                            <select value={editForm.plan} onChange={e => setEditForm(f => ({ ...f, plan: e.target.value }))} className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-indigo-500">
                                <option value="free">Free</option>
                                <option value="basic">Basic</option>
                                <option value="enterprise">Enterprise</option>
                            </select>
                        </div>

                        {/* Logo upload */}
                        <div>
                            <label className="block text-xs font-medium text-muted-foreground mb-2">Logo de la organización</label>
                            <div className="flex items-center gap-3">
                                {getUploadUrl(editOrg.logoUrl) ? (
                                    <img
                                        src={getUploadUrl(editOrg.logoUrl)!}
                                        alt="Logo"
                                        className="w-14 h-14 rounded-xl object-contain bg-muted border border-border p-1"
                                    />
                                ) : (
                                    <div className="w-14 h-14 rounded-xl bg-muted border border-border flex items-center justify-center text-muted-foreground text-xs">{logoFile ? logoFile.name.slice(0, 8) + "…" : "Sin logo"}</div>
                                )}
                                <div className="flex-1 space-y-1.5">
                                    <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={e => setLogoFile(e.target.files?.[0] ?? null)} />
                                    <button onClick={() => logoInputRef.current?.click()} className="w-full px-3 py-1.5 rounded-lg text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-200 transition-colors">
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
                            <button onClick={() => { setEditOrg(null); setLogoFile(null); }} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
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
                        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>Se creará una cuenta de administrador y se enviarán las credenciales al correo indicado.</span>
                        </div>
                        <div className="flex items-start gap-2 p-3 bg-teal-50 border border-teal-200 rounded-lg text-xs text-teal-700 dark:text-teal-300">
                            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>El administrador recibirá un correo para activar su cuenta y elegir su contraseña.</span>
                        </div>
                        <Field label="Nombre completo" value={adminForm.name} onChange={v => setAdminForm(f => ({ ...f, name: v }))} placeholder="Director TECNL" />
                        <Field label="Correo" value={adminForm.email} onChange={v => setAdminForm(f => ({ ...f, email: v }))} placeholder="admin@org.com" type="email" />
                        <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setDesignOrg(null)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
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
        indigo: "bg-indigo-100 text-indigo-700",
        teal:   "bg-teal-100 text-teal-700 dark:text-teal-400",
        blue:   "bg-blue-100 text-blue-700",
        rose:   "bg-rose-100 text-rose-700",
    };
    return (
        <div className="bg-card rounded-xl p-4">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${colors[color]}`}>
                <Icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
    );
}

const ACTION_COLOR: Record<string, string> = {
    CREATE_ORGANIZATION:  "text-teal-700 dark:text-teal-400",
    UPDATE_ORGANIZATION:  "text-blue-700",
    DEACTIVATE_ORGANIZATION: "text-amber-700",
    DELETE_ORGANIZATION:  "text-rose-700",
    CREATE_ORG_ADMIN:     "text-indigo-700",
};

function AuditRow({ entry, verbose = false }: { entry: AuditEntry; verbose?: boolean }) {
    return (
        <div className="flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/20 transition-colors">
            <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs font-mono font-semibold ${ACTION_COLOR[entry.action] ?? "text-foreground"}`}>{entry.action}</span>
                    <span className="text-xs text-muted-foreground">{entry.targetEntity} · {entry.targetId.slice(0, 8)}…</span>
                </div>
                {verbose && entry.metadata && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{JSON.stringify(entry.metadata)}</p>
                )}
            </div>
            <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground">{fmtDateTime(entry.createdAt)}</p>
                {verbose && entry.ipAddress && <p className="text-xs text-foreground font-mono">{entry.ipAddress}</p>}
            </div>
        </div>
    );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h3 className="font-semibold text-foreground">{title}</h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none">×</button>
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
            <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
            <input
                type={type}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                className={`w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-indigo-500 ${mono ? "font-mono" : ""}`}
            />
        </div>
    );
}
