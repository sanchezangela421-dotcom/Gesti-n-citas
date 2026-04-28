import { useState, useRef, useEffect } from "react";
import { Bell, LogOut, X, Menu, Trash2, Moon, Sun, KeyRound, Eye, EyeOff, RefreshCw, ChevronDown, Camera, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../context/AuthContext";
import { useStore } from "../../../context/StoreContext";
import { useTheme } from "../../hooks/useTheme";
import { Avatar, NotifIcon } from "../ui";
import { API_BASE } from "../../../lib/api";

interface SidebarTab {
    key: string;
    label: string;
    icon: React.ElementType;
}

interface SidebarConfig {
    tabs: SidebarTab[];
    active: string;
    onSelect: (k: string) => void;
    badges?: Record<string, number>;
}

interface AppShellProps {
    children: React.ReactNode;
    sidebar?: SidebarConfig;
}

const ROLE_LABELS: Record<string, string> = {
    alumno: "Alumno",
    especialista: "Especialista",
    admin: "Administrador",
};

export function AppShell({ children, sidebar }: AppShellProps) {
    const { user, logout, refreshUser } = useAuth();
    const { notifications, markNotificationsRead, deleteNotification, clearAllNotifications, isOnline } = useStore();

    const [showNotif, setShowNotif] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const { dark, toggle: toggleDark } = useTheme();

    // Change password modal
    const [showPwModal, setShowPwModal] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [currentPw, setCurrentPw] = useState("");
    const [newPw, setNewPw] = useState("");
    const [confirmPw, setConfirmPw] = useState("");
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [pwLoading, setPwLoading] = useState(false);
    const userMenuRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!showUserMenu) return;
        const handler = (e: MouseEvent) => {
            if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
                setShowUserMenu(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [showUserMenu]);

    if (!user) return null;

    const roleLabel = ROLE_LABELS[user.role] ?? user.role;
    const notifs = notifications[user.id] ?? [];
    const unread = notifs.filter(n => !n.read).length;

    const handleToggleNotif = () => {
        if (!showNotif && unread > 0) markNotificationsRead(user.id);
        setShowNotif(v => !v);
    };

    const openPwModal = () => { setShowUserMenu(false); setShowPwModal(true); };
    const closePwModal = () => { setShowPwModal(false); setCurrentPw(""); setNewPw(""); setConfirmPw(""); };

    const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const formData = new FormData();
        formData.append("avatar", file);
        const token = localStorage.getItem("token");
        try {
            const res = await fetch(`${API_BASE}/api/auth/avatar`, {
                method: "PATCH",
                headers: { Authorization: `Bearer ${token}` },
                body: formData,
            });
            if (res.ok) {
                await refreshUser();
                toast.success("Foto actualizada.");
            } else {
                toast.error("No se pudo actualizar la foto.");
            }
        } catch {
            toast.error("Error de conexión.");
        }
        e.target.value = "";
    };

    const handleChangePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPw !== confirmPw) { toast.error("Las contraseñas nuevas no coinciden."); return; }
        if (newPw.length < 6) { toast.error("La contraseña debe tener al menos 6 caracteres."); return; }
        setPwLoading(true);
        try {
            const token = localStorage.getItem("token");
            const res = await fetch(`${API_BASE}/api/auth/change-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error || "No se pudo cambiar la contraseña.");
            } else {
                toast.success("Contraseña actualizada correctamente.");
                closePwModal();
            }
        } catch {
            toast.error("Error de conexión. Intenta más tarde.");
        }
        setPwLoading(false);
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex font-sans transition-colors duration-300">

            {/* ── Change password modal ── */}
            {showPwModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl w-full max-w-md p-8 relative">
                        <button onClick={closePwModal} className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
                            <X className="w-5 h-5" />
                        </button>

                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                                <KeyRound className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Cambiar contraseña</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400">Actualiza tu contraseña de acceso</p>
                            </div>
                        </div>

                        <form onSubmit={handleChangePassword} className="space-y-4">
                            {/* Current password */}
                            <div className="space-y-1.5">
                                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Contraseña actual</label>
                                <div className="relative rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 focus-within:border-blue-600">
                                    <input
                                        type={showCurrent ? "text" : "password"} value={currentPw} required
                                        onChange={e => setCurrentPw(e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full pl-4 pr-11 py-3 bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none text-sm"
                                    />
                                    <button type="button" onClick={() => setShowCurrent(v => !v)} className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer">
                                        {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* New password */}
                            <div className="space-y-1.5">
                                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Nueva contraseña</label>
                                <div className="relative rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 focus-within:border-blue-600">
                                    <input
                                        type={showNew ? "text" : "password"} value={newPw} required minLength={6}
                                        onChange={e => setNewPw(e.target.value)}
                                        placeholder="Mínimo 6 caracteres"
                                        className="w-full pl-4 pr-11 py-3 bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none text-sm"
                                    />
                                    <button type="button" onClick={() => setShowNew(v => !v)} className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer">
                                        {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {/* Confirm password */}
                            <div className="space-y-1.5">
                                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300">Confirmar nueva contraseña</label>
                                <div className={`relative rounded-xl border-2 bg-slate-50 dark:bg-slate-700 focus-within:border-blue-600 ${confirmPw && newPw !== confirmPw ? "border-red-400" : "border-slate-200 dark:border-slate-600"}`}>
                                    <input
                                        type="password" value={confirmPw} required minLength={6}
                                        onChange={e => setConfirmPw(e.target.value)}
                                        placeholder="Repite la nueva contraseña"
                                        className="w-full pl-4 pr-4 py-3 bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none text-sm"
                                    />
                                </div>
                                {confirmPw && newPw !== confirmPw && (
                                    <p className="text-red-500 text-xs ml-1">Las contraseñas no coinciden</p>
                                )}
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={closePwModal}
                                    className="flex-1 py-3 rounded-xl border-2 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-semibold text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all cursor-pointer">
                                    Cancelar
                                </button>
                                <button type="submit" disabled={pwLoading}
                                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-700 to-teal-600 text-white font-semibold text-sm shadow-md hover:-translate-y-0.5 transition-all disabled:opacity-70 cursor-pointer flex justify-center items-center">
                                    {pwLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Guardar"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── Sidebar desktop ── */}
            {sidebar && (
                <aside className="hidden md:flex w-64 bg-slate-900 dark:bg-slate-950 flex-col shrink-0 sticky top-0 h-screen">
                    <div className="h-24 border-b border-white/10 flex items-center justify-center ">
                        <img
                            src="/logo-dark.png"
                            className="w-[60%] max-w-none object-cover object-center"
                        />
                    </div>
                    <nav className="p-4 space-y-1.5 overflow-y-auto flex-1">
                        {sidebar.tabs.map(t => {
                            const isActive = sidebar.active === t.key;
                            const badge = sidebar.badges?.[t.key];
                            return (
                                <button key={t.key} onClick={() => sidebar.onSelect(t.key)}
                                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer group ${isActive ? "bg-blue-600 text-white shadow-md shadow-blue-500/20" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>
                                    <t.icon className={`w-5 h-5 transition-colors ${isActive ? "text-white" : "text-slate-400 group-hover:text-white"}`} />
                                    <span className="font-medium text-sm">{t.label}</span>
                                    {badge !== undefined && badge > 0 && (
                                        <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-bold ${isActive ? "bg-white text-blue-600" : "bg-blue-500/30 text-white"}`}>
                                            {badge}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </nav>
                </aside>
            )}

            {/* ── Sidebar mobile overlay ── */}
            {sidebar && sidebarOpen && (
                <>
                    <div className="fixed inset-0 bg-slate-900/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
                    <aside className="fixed left-0 top-0 bottom-0 w-72 bg-slate-900 z-50 flex flex-col md:hidden">
                        <div className="h-26 relative overflow-hidden border-b border-white/10 flex items-center justify-end px-5">
                            <img src="/logo-dark.png" alt="" style={{ width: '68%', marginLeft: '-11px', marginTop: '-7px', maxWidth: 'none' }} />
                            <button onClick={() => setSidebarOpen(false)} className="text-slate-400 hover:text-white p-2 cursor-pointer">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <nav className="p-4 space-y-1.5 overflow-y-auto flex-1">
                            {sidebar.tabs.map(t => {
                                const isActive = sidebar.active === t.key;
                                const badge = sidebar.badges?.[t.key];
                                return (
                                    <button key={t.key} onClick={() => { sidebar.onSelect(t.key); setSidebarOpen(false); }}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer group ${isActive ? "bg-blue-600 text-white shadow-md shadow-blue-500/20" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}>
                                        <t.icon className={`w-5 h-5 ${isActive ? "text-white" : "text-slate-400 group-hover:text-white"}`} />
                                        <span className="font-medium text-sm">{t.label}</span>
                                        {badge !== undefined && badge > 0 && (
                                            <span className={`ml-auto px-2 py-0.5 rounded-full text-xs font-bold ${isActive ? "bg-white text-blue-600" : "bg-blue-500/30 text-white"}`}>
                                                {badge}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </nav>
                    </aside>
                </>
            )}

            {/* ── Main ── */}
            <div className="flex-1 flex flex-col min-w-0 h-[100dvh] overflow-hidden">

                {/* Header */}
                <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between px-4 sm:px-6 shrink-0 z-30">

                    {/* Left */}
                    <div className="flex items-center gap-2 sm:gap-3">
                        {sidebar ? (
                            <button onClick={() => setSidebarOpen(true)}
                                className="md:hidden p-2 -ml-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-xl cursor-pointer transition-colors shrink-0">
                                <Menu className="w-6 h-6" />
                            </button>
                        ) : (
                            <div className="relative overflow-hidden" style={{ width: '191px', height: '40px' }}>
                                <img src="/logo-light.png" alt="Synkros" className="dark:hidden" style={{ width: '168%', marginLeft: '-11px', marginTop: '-7px', maxWidth: 'none' }} />
                                <img src="/logo-dark.png" alt="Synkros" className="hidden dark:block" style={{ width: '168%', marginLeft: '-11px', marginTop: '-7px', maxWidth: 'none' }} />
                            </div>
                        )}
                    </div>

                    {/* Right */}
                    <div className="flex items-center gap-2 sm:gap-6">

                        {/* ── Dark mode toggle ── */}
                        <button
                            onClick={toggleDark}
                            title={dark ? "Modo claro" : "Modo oscuro"}
                            className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer">
                            {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                        </button>

                        {/* ── Bell ── */}
                        <div className="relative">
                            <button onClick={handleToggleNotif}
                                className="relative p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer">
                                <Bell className="w-5 h-5" />
                                {unread > 0 && (
                                    <span className="absolute top-1.5 right-1.5 min-w-[1rem] h-4 px-1 bg-rose-500 border-2 border-white text-white rounded-full flex items-center justify-center text-[0.55rem] font-black animate-pulse">
                                        {unread > 9 ? "9+" : unread}
                                    </span>
                                )}
                            </button>

                            {/* ── Panel ── */}
                            {showNotif && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowNotif(false)} />
                                    <div className="fixed inset-x-2 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-3 w-auto sm:w-[24rem] bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl shadow-xl shadow-slate-200/50 dark:shadow-slate-950/80 z-50 overflow-hidden animate-in fade-in slide-in-from-top-4 duration-200">

                                        {/* Panel header */}
                                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800">
                                            <div>
                                                <h4 className="text-slate-900 dark:text-white font-semibold text-sm">Notificaciones</h4>
                                                <p className="text-slate-500 dark:text-slate-400 text-xs font-medium">
                                                    {notifs.length === 0
                                                        ? "Sin notificaciones"
                                                        : unread > 0 ? `${unread} sin leer` : "Todo al día"}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {/* Clear all */}
                                                {notifs.length > 0 && (
                                                    <button
                                                        onClick={() => clearAllNotifications(user.id)}
                                                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                                                        title="Eliminar todas">
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                        Limpiar todo
                                                    </button>
                                                )}
                                                <button onClick={() => setShowNotif(false)}
                                                    className="text-slate-400 hover:text-slate-900 cursor-pointer p-1.5 rounded-lg hover:bg-slate-200/50 transition-colors ml-1">
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* List */}
                                        <div className="overflow-y-auto max-h-[calc(100vh-8rem)] sm:max-h-[28rem] select-none">
                                            {notifs.length === 0 ? (
                                                <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                                                    <div className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
                                                        <Bell className="w-6 h-6 text-slate-300" />
                                                    </div>
                                                    <p className="text-slate-500 font-medium text-sm">Sin notificaciones</p>
                                                    <p className="text-slate-400 text-xs mt-1">Aquí aparecerán tus alertas y avisos</p>
                                                </div>
                                            ) : (
                                                notifs.map(n => (
                                                    <div key={n.id}
                                                        className={`group px-5 py-4 border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50/80 dark:hover:bg-slate-700/50 transition-colors ${!n.read ? "bg-blue-50/40 dark:bg-blue-900/20" : ""}`}>
                                                        <div className="flex items-start gap-3">
                                                            <div className="mt-0.5 shrink-0">
                                                                <NotifIcon type={n.type} />
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center justify-between gap-2 mb-1">
                                                                    <p className={`text-sm truncate ${!n.read ? "font-semibold text-slate-900 dark:text-white" : "font-medium text-slate-700 dark:text-slate-200"}`}>
                                                                        {n.title}
                                                                    </p>
                                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                                        {!n.read && (
                                                                            <span className="w-2 h-2 bg-blue-600 rounded-full" />
                                                                        )}
                                                                        {/* Delete single */}
                                                                        <button
                                                                            onClick={() => deleteNotification(user.id, n.id)}
                                                                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-all cursor-pointer"
                                                                            title="Eliminar">
                                                                            <X className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <p className="text-slate-500 dark:text-slate-300 text-xs leading-relaxed">{n.message}</p>
                                                                <p className="text-slate-400 dark:text-slate-500 text-[0.65rem] font-medium mt-1.5 uppercase tracking-wider">{n.time}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="h-8 w-px bg-slate-200 hidden sm:block" />

                        {/* User chip */}
                        <div className="flex items-center gap-3">
                            <div className="text-right hidden sm:block">
                                <p className="text-slate-900 dark:text-white font-semibold text-sm leading-tight">{user.name}</p>
                                <p className="text-slate-500 dark:text-slate-400 text-xs font-medium">
                                    {roleLabel}{user.department ? ` - ${user.department}` : ""}
                                </p>
                            </div>

                            {/* Avatar with dropdown */}
                            <div className="relative" ref={userMenuRef}>
                                {/* Hidden file input for avatar */}
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    className="hidden"
                                    onChange={handleAvatarChange}
                                />

                                <button
                                    onClick={() => setShowUserMenu(v => !v)}
                                    className="flex items-center gap-1.5 cursor-pointer rounded-full focus:outline-none"
                                >
                                    <Avatar name={user.name} size="md" avatarUrl={user.avatarUrl} />
                                    <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${showUserMenu ? "rotate-180" : ""}`} />
                                </button>

                                {showUserMenu && (
                                    <div className="absolute right-0 top-12 w-52 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 py-1.5 z-50">
                                        <button
                                            onClick={() => { setShowUserMenu(false); fileInputRef.current?.click(); }}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                        >
                                            <Camera className="w-4 h-4 text-slate-400" />
                                            Cambiar foto
                                        </button>
                                        <button
                                            onClick={openPwModal}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                                        >
                                            <KeyRound className="w-4 h-4 text-slate-400" />
                                            Cambiar contraseña
                                        </button>
                                        <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                                        <button
                                            onClick={logout}
                                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors cursor-pointer"
                                        >
                                            <LogOut className="w-4 h-4" />
                                            Cerrar sesión
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </header>

                {/* Offline banner */}
                {!isOnline && (
                    <div className="flex items-center justify-center gap-2 bg-amber-500 text-white text-sm font-semibold px-4 py-2">
                        <WifiOff className="w-4 h-4 shrink-0" />
                        Sin conexión — los datos mostrados pueden estar desactualizados
                    </div>
                )}

                {/* Page content */}
                <main className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8">
                    <div className="max-w-7xl mx-auto space-y-6">{children}</div>
                </main>
            </div>
        </div>
    );
}
