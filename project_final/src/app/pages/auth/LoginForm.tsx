import { useState, useEffect } from "react";
import { toast } from "sonner";
import { CalendarCheck, Brain, GraduationCap, Apple, RefreshCw, ChevronRight, MailCheck, Send, KeyRound, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { API_BASE } from "../../../lib/api";
import { Btn } from "../../components/ui";

const DEPARTMENTS = [
    { name: "Psicología", icon: Brain, gradient: "from-blue-500 to-blue-700" },
    { name: "Tutorías", icon: GraduationCap, gradient: "from-emerald-500 to-teal-600" },
    { name: "Nutrición", icon: Apple, gradient: "from-amber-500 to-orange-500" },
];

const DEMO_ACCOUNTS = [
    { role: "Alumno",       email: "alumno@mail.com",                pass: "alumno123", badge: "bg-blue-100 text-blue-700"     },
    { role: "Especialista", email: "psicologo@instituto.edu.mx",     pass: "esp123",    badge: "bg-emerald-100 text-emerald-700"},
    { role: "Admin",        email: "admin@instituto.edu.mx",         pass: "admin123",  badge: "bg-slate-100 text-slate-600"   },
];

type View = "login" | "forgot" | "reset";

export function LoginForm({ onSwitchToRegister }: { onSwitchToRegister: () => void }) {
    const { login } = useAuth();
    const [view, setView] = useState<View>("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [focused, setFocused] = useState<string | null>(null);
    const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
    const [resending, setResending] = useState(false);

    // Forgot password state
    const [forgotEmail, setForgotEmail] = useState("");
    const [forgotSent, setForgotSent] = useState(false);

    // Reset password state
    const [resetToken, setResetToken] = useState<string | null>(null);
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showNew, setShowNew] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    // Check if user arrived from verification or reset link
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const verified = params.get("verified");
        const token = params.get("reset_token");

        if (verified === "true") {
            toast.success("¡Correo verificado! Ya puedes iniciar sesión.");
            window.history.replaceState({}, "", window.location.pathname);
        } else if (verified === "expired") {
            toast.error("El enlace de verificación expiró. Solicita uno nuevo desde la pantalla de inicio de sesión.");
            window.history.replaceState({}, "", window.location.pathname);
        } else if (verified === "false") {
            toast.error("El enlace de verificación no es válido o ya expiró.");
            window.history.replaceState({}, "", window.location.pathname);
        }

        if (token) {
            setResetToken(token);
            setView("reset");
            window.history.replaceState({}, "", window.location.pathname);
        }
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        const result = await login(email, password);
        setLoading(false);
        if (result.ok) return;
        if (result.unverified) {
            setUnverifiedEmail(email);
        } else {
            toast.error(result.error || "Credenciales incorrectas.");
        }
    };

    const handleResend = async () => {
        if (!unverifiedEmail) return;
        setResending(true);
        try {
            await fetch(`${API_BASE}/api/auth/resend-verification`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: unverifiedEmail }),
            });
            toast.success("Correo de verificación reenviado. Revisa tu bandeja.");
        } catch {
            toast.error("No se pudo reenviar. Intenta más tarde.");
        }
        setResending(false);
    };

    const demoLogin = async (em: string, pw: string) => {
        setEmail(em); setPassword(pw); setLoading(true);
        const result = await login(em, pw);
        if (!result.ok) toast.error(result.error ?? 'Cuenta demo no disponible. Verifica que la BD tenga datos de prueba.');
        setLoading(false);
    };

    const handleForgot = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await fetch(`${API_BASE}/api/auth/forgot-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: forgotEmail }),
            });
            setForgotSent(true);
        } catch {
            toast.error("No se pudo enviar. Intenta más tarde.");
        }
        setLoading(false);
    };

    const handleReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            toast.error("Las contraseñas no coinciden.");
            return;
        }
        if (newPassword.length < 6) {
            toast.error("La contraseña debe tener al menos 6 caracteres.");
            return;
        }
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: resetToken, password: newPassword }),
            });
            const data = await res.json();
            if (!res.ok) {
                if (data.code === "EXPIRED_TOKEN") {
                    toast.error("El enlace ha expirado. Solicita uno nuevo.");
                } else {
                    toast.error(data.error || "No se pudo restablecer la contraseña.");
                }
            } else {
                toast.success("Contraseña actualizada. Ya puedes iniciar sesión.");
                setView("login");
                setResetToken(null);
                setNewPassword("");
                setConfirmPassword("");
            }
        } catch {
            toast.error("No se pudo restablecer. Intenta más tarde.");
        }
        setLoading(false);
    };

    // ── Forgot password view ──────────────────────────────────────────────────
    if (view === "forgot") {
        return (
            <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 relative overflow-hidden font-sans">
                {/* Left panel — reused */}
                <div className="hidden lg:flex w-[52%] flex-col justify-between p-12 relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-teal-700">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob" />
                    <div className="absolute bottom-0 left-0 w-96 h-96 bg-teal-500 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000" />
                    <div className="relative z-10">
                        <div className="flex items-center gap-4 mb-10">
                            <div className="w-14 h-14 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-xl">
                                <CalendarCheck className="w-7 h-7 text-white" />
                            </div>
                            <div>
                                <h1 className="text-white text-2xl font-bold tracking-tight">Synkros</h1>
                                <p className="text-teal-200 text-sm font-medium tracking-wide">PLATAFORMA INSTITUCIONAL</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right panel */}
                <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12">
                    <div className="w-full max-w-md">
                        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-slate-900/60 border border-slate-100 dark:border-slate-700 p-8 sm:p-10">
                            <button
                                onClick={() => { setView("login"); setForgotSent(false); setForgotEmail(""); }}
                                className="flex items-center gap-2 text-slate-400 hover:text-slate-600 text-sm mb-6 cursor-pointer transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" /> Volver al inicio de sesión
                            </button>

                            <div className="text-center mb-8">
                                <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                    <KeyRound className="w-7 h-7 text-blue-600" />
                                </div>
                                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Recuperar contraseña</h2>
                                <p className="text-slate-500 mt-2 text-sm">Te enviaremos un enlace para restablecer tu contraseña</p>
                            </div>

                            {forgotSent ? (
                                <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
                                    <p className="text-emerald-800 font-bold text-sm">¡Correo enviado!</p>
                                    <p className="text-slate-500 text-xs leading-relaxed">
                                        Si <strong>{forgotEmail}</strong> está registrado, recibirás un enlace para restablecer tu contraseña. Revisa también tu carpeta de spam.
                                    </p>
                                    <p className="text-slate-400 text-xs">El enlace expira en 1 hora.</p>
                                </div>
                            ) : (
                                <form onSubmit={handleForgot} className="space-y-5">
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1">Correo institucional</label>
                                        <div className={`relative transition-all duration-300 rounded-xl border-2 ${focused === "forgotEmail" ? "border-blue-600 bg-blue-50/30 dark:bg-blue-900/20" : "border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50"}`}>
                                            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                                <span className={`transition-colors duration-300 ${focused === "forgotEmail" ? "text-blue-600" : "text-slate-400"}`}>@</span>
                                            </div>
                                            <input
                                                type="email" value={forgotEmail} required
                                                onChange={e => setForgotEmail(e.target.value)}
                                                onFocus={() => setFocused("forgotEmail")} onBlur={() => setFocused(null)}
                                                placeholder="usuario@instituto.edu.mx"
                                                className="w-full pl-10 pr-4 py-3 bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none text-sm font-medium"
                                            />
                                        </div>
                                    </div>
                                    <Btn variant="gradient" size="lg" type="submit" disabled={loading} className="w-full mt-2">
                                        {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : "Enviar enlace"}
                                    </Btn>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Reset password view ───────────────────────────────────────────────────
    if (view === "reset") {
        return (
            <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 relative overflow-hidden font-sans">
                <div className="hidden lg:flex w-[52%] flex-col justify-between p-12 relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-teal-700">
                    <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob" />
                    <div className="absolute bottom-0 left-0 w-96 h-96 bg-teal-500 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000" />
                    <div className="relative z-10">
                        <div className="flex items-center gap-4 mb-10">
                            <div className="w-14 h-14 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-xl">
                                <CalendarCheck className="w-7 h-7 text-white" />
                            </div>
                            <div>
                                <h1 className="text-white text-2xl font-bold tracking-tight">Synkros</h1>
                                <p className="text-teal-200 text-sm font-medium tracking-wide">PLATAFORMA INSTITUCIONAL</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12">
                    <div className="w-full max-w-md">
                        <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-slate-900/60 border border-slate-100 dark:border-slate-700 p-8 sm:p-10">
                            <div className="text-center mb-8">
                                <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                    <KeyRound className="w-7 h-7 text-blue-600" />
                                </div>
                                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Nueva contraseña</h2>
                                <p className="text-slate-500 mt-2 text-sm">Elige una contraseña segura para tu cuenta</p>
                            </div>

                            <form onSubmit={handleReset} className="space-y-5">
                                {/* New password */}
                                <div className="space-y-1.5">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1">Nueva contraseña</label>
                                    <div className={`relative transition-all duration-300 rounded-xl border-2 ${focused === "newPw" ? "border-blue-600 bg-blue-50/30 dark:bg-blue-900/20" : "border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50"}`}>
                                        <input
                                            type={showNew ? "text" : "password"} value={newPassword} required minLength={6}
                                            onChange={e => setNewPassword(e.target.value)}
                                            onFocus={() => setFocused("newPw")} onBlur={() => setFocused(null)}
                                            placeholder="Mínimo 6 caracteres"
                                            className="w-full pl-4 pr-11 py-3 bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none text-sm font-medium"
                                        />
                                        <button type="button" onClick={() => setShowNew(v => !v)} className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer">
                                            {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>

                                {/* Confirm password */}
                                <div className="space-y-1.5">
                                    <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1">Confirmar contraseña</label>
                                    <div className={`relative transition-all duration-300 rounded-xl border-2 ${focused === "confirmPw" ? "border-blue-600 bg-blue-50/30 dark:bg-blue-900/20" : "border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50"}`}>
                                        <input
                                            type={showConfirm ? "text" : "password"} value={confirmPassword} required minLength={6}
                                            onChange={e => setConfirmPassword(e.target.value)}
                                            onFocus={() => setFocused("confirmPw")} onBlur={() => setFocused(null)}
                                            placeholder="Repite la contraseña"
                                            className="w-full pl-4 pr-11 py-3 bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none text-sm font-medium"
                                        />
                                        <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer">
                                            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                    {confirmPassword && newPassword !== confirmPassword && (
                                        <p className="text-red-500 text-xs ml-1 mt-1">Las contraseñas no coinciden</p>
                                    )}
                                </div>

                                <Btn variant="gradient" size="lg" type="submit" disabled={loading} className="w-full mt-2">
                                    {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : "Guardar contraseña"}
                                </Btn>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Login view (default) ──────────────────────────────────────────────────
    return (
        <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 relative overflow-hidden font-sans">

            {/* ── Left panel ── */}
            <div className="hidden lg:flex w-[52%] flex-col justify-between p-12 relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-teal-700">
                <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob" />
                <div className="absolute bottom-0 left-0 w-96 h-96 bg-teal-500 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000" />
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4yIi8+PC9zdmc+')] opacity-5" />

                <div className="relative z-10">
                    <div className="flex items-center gap-4 mb-10">
                        <div className="w-14 h-14 overflow-hidden shrink-0">
                            <img src="/logo-dark.png" alt="" style={{ width: '168%', marginLeft: '-11px', marginTop: '-7px', maxWidth: 'none' }} />
                        </div>
                        <div>
                            <h1 className="text-white text-2xl font-bold tracking-tight">Synkros</h1>
                            <p className="text-teal-200 text-sm font-medium tracking-wide">PLATAFORMA INSTITUCIONAL</p>
                        </div>
                    </div>

                    <h2 className="text-4xl text-white font-bold leading-tight mb-6 max-w-lg">
                        Gestión inteligente para tu{" "}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-300 to-emerald-300">
                            bienestar integral
                        </span>.
                    </h2>

                    <div className="space-y-4 max-w-sm mt-12">
                        {DEPARTMENTS.map(d => (
                            <div key={d.name} className="flex items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm transition-all hover:bg-white/10">
                                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${d.gradient} flex items-center justify-center shadow-lg shrink-0`}>
                                    <d.icon className="w-6 h-6 text-white" />
                                </div>
                                <p className="text-white font-medium">{d.name}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Stats row */}
                <div className="relative z-10 grid grid-cols-3 gap-6 pt-10 border-t border-white/10 mt-12">
                    <div><p className="text-3xl font-bold text-white mb-1">500+</p><p className="text-white/60 text-xs font-medium uppercase tracking-wider">Alumnos</p></div>
                    <div><p className="text-3xl font-bold text-white mb-1">3</p><p className="text-white/60 text-xs font-medium uppercase tracking-wider">Departamentos</p></div>
                    <div><p className="text-3xl font-bold text-white mb-1">98%</p><p className="text-white/60 text-xs font-medium uppercase tracking-wider">Satisfacción</p></div>
                </div>
            </div>

            {/* ── Right panel ── */}
            <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-12 relative">
                <div className="w-full max-w-md">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-slate-900/60 border border-slate-100 dark:border-slate-700 p-8 sm:p-10">
                        <div className="text-center mb-6 sm:mb-10">
                            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Iniciar Sesión</h2>
                            <p className="text-slate-500 mt-2 text-sm">Ingresa con tus credenciales institucionales</p>
                        </div>

                        {/* ── Email not verified panel ── */}
                        {unverifiedEmail && (
                            <div className="mb-6 p-5 bg-amber-50 border border-amber-200 rounded-2xl text-center space-y-3">
                                <div className="flex justify-center">
                                    <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
                                        <MailCheck className="w-6 h-6 text-amber-600" />
                                    </div>
                                </div>
                                <p className="text-slate-800 font-bold text-sm">Verifica tu correo</p>
                                <p className="text-slate-500 text-xs leading-relaxed">
                                    Enviamos un enlace de verificación a <strong>{unverifiedEmail}</strong>. Revisa tu bandeja de entrada (y spam) y haz clic en el enlace para activar tu cuenta.
                                </p>
                                <div className="pt-1 border-t border-amber-200">
                                    <p className="text-slate-400 text-xs mb-2">¿No recibiste el correo?</p>
                                    <button
                                        type="button"
                                        onClick={handleResend}
                                        disabled={resending}
                                        className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-60"
                                    >
                                        {resending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                        {resending ? "Reenviando..." : "Reenviar correo"}
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setUnverifiedEmail(null)}
                                    className="block w-full text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                                >
                                    Volver al inicio de sesión
                                </button>
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-5">
                            {/* Email */}
                            <div className="space-y-1.5">
                                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1">Correo institucional</label>
                                <div className={`relative transition-all duration-300 rounded-xl border-2 ${focused === "email" ? "border-blue-600 bg-blue-50/30 dark:bg-blue-900/20" : "border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50"}`}>
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                        <span className={`transition-colors duration-300 ${focused === "email" ? "text-blue-600" : "text-slate-400"}`}>@</span>
                                    </div>
                                    <input
                                        type="email" value={email} required
                                        onChange={e => setEmail(e.target.value)}
                                        onFocus={() => setFocused("email")} onBlur={() => setFocused(null)}
                                        placeholder="usuario@instituto.edu.mx"
                                        className="w-full pl-10 pr-4 py-3 bg-transparent text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none text-sm font-medium"
                                    />
                                </div>
                            </div>

                            {/* Password */}
                            <div className="space-y-1.5">
                                <label className="text-sm font-semibold text-slate-700 dark:text-slate-300 ml-1">Contraseña</label>
                                <div className={`relative transition-all duration-300 rounded-xl border-2 ${focused === "password" ? "border-blue-600 bg-blue-50/30 dark:bg-blue-900/20" : "border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50"}`}>
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                        <span className={`font-bold transition-colors duration-300 ${focused === "password" ? "text-blue-600" : "text-slate-400"}`}>*</span>
                                    </div>
                                    <input
                                        type="password" value={password} required
                                        onChange={e => setPassword(e.target.value)}
                                        onFocus={() => setFocused("password")} onBlur={() => setFocused(null)}
                                        placeholder="••••••••"
                                        className="w-full pl-10 pr-4 py-3 bg-transparent text-slate-900 placeholder:text-slate-400 focus:outline-none text-sm font-medium tracking-widest"
                                    />
                                </div>
                            </div>

                            <Btn variant="gradient" size="lg" type="submit" disabled={loading} className="w-full mt-4">
                                {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : "Ingresar"}
                            </Btn>

                            <div className="text-center mt-3">
                                <button
                                    type="button"
                                    onClick={() => { setView("forgot"); setForgotSent(false); setForgotEmail(""); }}
                                    className="text-xs text-slate-400 hover:text-blue-600 transition-colors cursor-pointer"
                                >
                                    ¿Olvidaste tu contraseña?
                                </button>
                            </div>
                        </form>

                        {/* Demo accounts */}
                        <div className="mt-8 border-t border-slate-100 pt-8">
                            <p className="text-xs font-semibold text-slate-400 text-center uppercase tracking-wider mb-4">Cuentas de acceso rápido</p>
                            <div className="flex flex-col gap-2.5">
                                {DEMO_ACCOUNTS.map(c => (
                                    <button
                                        key={c.role}
                                        onClick={() => demoLogin(c.email, c.pass)}
                                        className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all group cursor-pointer text-left"
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide ${c.badge}`}>{c.role}</span>
                                            <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900 truncate max-w-[180px]">{c.email}</span>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 transition-colors shrink-0" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <p className="text-center mt-8 text-slate-500 text-sm">
                        ¿No tienes cuenta?{" "}
                        <button onClick={onSwitchToRegister} className="text-blue-600 font-semibold hover:text-blue-700 underline underline-offset-4 cursor-pointer">
                            Registrarse
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
}
