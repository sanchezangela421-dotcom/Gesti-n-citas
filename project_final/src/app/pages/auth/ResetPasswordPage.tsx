import { useState } from "react";
import { ShieldCheck, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { API_BASE } from "../../../lib/api";

interface Props {
  token: string;
  onDone: () => void; // vuelve al login
}

export function ResetPasswordPage({ token, onDone }: Props) {
  const [password, setPassword]     = useState("");
  const [confirm, setConfirm]       = useState("");
  const [showPw, setShowPw]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [success, setSuccess]       = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres."); return; }
    if (password !== confirm) { setError("Las contraseñas no coinciden."); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al activar cuenta");
      setSuccess(true);
      // Limpiar el token de la URL sin recargar la página
      window.history.replaceState({}, "", "/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-teal-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-teal-100 dark:bg-teal-900/40 flex items-center justify-center mb-4">
            <ShieldCheck className="w-7 h-7 text-teal-600 dark:text-teal-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white text-center">
            {success ? "¡Cuenta activada!" : "Activa tu cuenta"}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center mt-1">
            {success
              ? "Tu contraseña fue establecida. Ya puedes iniciar sesión."
              : "Elige una contraseña segura para acceder a la plataforma."}
          </p>
        </div>

        {success ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-xl bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800">
              <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0" />
              <p className="text-sm text-teal-700 dark:text-teal-300">Contraseña establecida correctamente.</p>
            </div>
            <button
              onClick={onDone}
              className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold transition-colors"
            >
              Ir al inicio de sesión
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Nueva contraseña
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  required
                  className="w-full px-4 py-2.5 pr-10 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-teal-500 transition-colors text-sm"
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Confirmar contraseña
              </label>
              <input
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Repite tu contraseña"
                required
                className="w-full px-4 py-2.5 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-teal-500 transition-colors text-sm"
              />
            </div>

            {error && (
              <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-xl px-4 py-2.5">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold transition-colors mt-2"
            >
              {loading ? "Activando cuenta..." : "Activar cuenta"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
