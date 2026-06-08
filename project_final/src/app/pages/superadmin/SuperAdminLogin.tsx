import { useState } from "react";
import { ShieldCheck, Eye, EyeOff, Lock } from "lucide-react";
import { API } from "../../../lib/api";

interface Props {
    onLogin: (token: string, user: { id: string; email: string; name: string }) => void;
}

export function SuperAdminLogin({ onLogin }: Props) {
    const [email, setEmail]       = useState("");
    const [password, setPassword] = useState("");
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState("");

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const res = await fetch(`${API}/superadmin/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error ?? "Credenciales inválidas");
                return;
            }

            // Verificación explícita en cliente — el backend también lo verifica en cada ruta
            if (data.user?.role !== "superadmin") {
                setError("Acceso denegado. Esta área es exclusiva del Super Admin.");
                return;
            }

            onLogin(data.token, data.user);
        } catch {
            setError("Error de conexión. Verifica que el servidor esté activo.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
            <div className="w-full max-w-sm space-y-8">

                {/* Logo / header */}
                <div className="text-center space-y-3">
                    <div className="w-14 h-14 bg-rose-900/30 border border-rose-800/50 rounded-2xl flex items-center justify-center mx-auto">
                        <ShieldCheck className="w-7 h-7 text-rose-400" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-white">Panel de SuperAdmin</h1>
                        <p className="text-sm text-slate-500 mt-1">Acceso restringido — solo personal autorizado</p>
                    </div>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">Correo</label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoComplete="username"
                            placeholder="superadmin@dominio.com"
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-600 transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">Contraseña</label>
                        <div className="relative">
                            <input
                                type={showPass ? "text" : "password"}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                                autoComplete="current-password"
                                placeholder="••••••••"
                                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-2.5 pr-10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-rose-600 transition-colors"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPass(v => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                            >
                                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-start gap-2 p-3 bg-rose-900/20 border border-rose-800/40 rounded-xl text-xs text-rose-300">
                            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
                    >
                        {loading ? "Verificando..." : "Acceder"}
                    </button>
                </form>

                <p className="text-center text-xs text-slate-700">
                    Esta sesión es auditada y monitoreada
                </p>
            </div>
        </div>
    );
}
