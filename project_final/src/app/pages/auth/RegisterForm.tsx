import { useState } from "react";
import { toast } from "sonner";
import { CalendarCheck, GraduationCap, UserPlus, ShieldCheck, Users, FileText, Clock, RefreshCw } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { CAREERS } from "../../../constants";

const FEATURES = [
    { title: "Seguro y Privado", desc: "Información tratada con total confidencialidad institucional.", icon: ShieldCheck },
    { title: "Rápido y Accesible", desc: "Agenda citas en segundos para cualquier departamento.", icon: Clock },
    { title: "Personalizado", desc: "Accede a recursos específicos para tu carrera y semestre.", icon: Users },
    { title: "Historial Completo", desc: "Lleva el control de todas tus asistencias y evaluaciones.", icon: FileText },
];

const INPUT_BASE = "w-full px-3.5 py-2.5 rounded-xl border-2 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none transition-all text-sm font-medium";

const INIT_FORM = {
    name: "", email: "", carrera: "", semestre: "", edad: "",
    matricula: "", genero: "Masculino", password: "", confirmPassword: "",
};

export function RegisterForm({ onSwitchToLogin }: { onSwitchToLogin: () => void }) {
    const { register } = useAuth();
    const [form, setForm] = useState<Record<string, string>>(INIT_FORM);
    const [loading, setLoading] = useState(false);

    const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (form.password !== form.confirmPassword) { toast.error("Las contraseñas no coinciden"); return; }
        setLoading(true);
        const result = await register({
            name: form.name,
            email: form.email,
            password: form.password,
            carrera: form.carrera,
            semestre: form.semestre ? parseInt(form.semestre) : undefined,
            edad: form.edad ? parseInt(form.edad) : undefined,
            matricula: form.matricula,
            genero: form.genero,
        });
        setLoading(false);
        if (result.ok) {
            toast.success("¡Registro exitoso! Revisa tu correo para verificar tu cuenta.");
            onSwitchToLogin();
        } else {
            toast.error(result.error || "No se pudo completar el registro.");
        }
    };

    return (
        <div className="min-h-screen flex bg-slate-50 relative overflow-hidden font-sans">

            {/* ── Left panel ── */}
            <div className="hidden lg:flex w-[52%] flex-col justify-between p-12 relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-900 to-emerald-700">
                <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-emerald-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob" />
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4yIi8+PC9zdmc+')] opacity-5" />

                <div className="relative z-10">
                    <div className="flex items-center gap-4 mb-10">
                        <div className="w-14 h-14 bg-white/10 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/20 shadow-xl">
                            <CalendarCheck className="w-7 h-7 text-white" />
                        </div>
                        <div>
                            <h1 className="text-white text-2xl font-bold tracking-tight">Sistema de Citas</h1>
                            <p className="text-emerald-200 text-sm font-medium tracking-wide">NUEVA CUENTA</p>
                        </div>
                    </div>

                    <h2 className="text-4xl text-white font-bold leading-tight mb-8">Empieza a cuidar de ti.</h2>

                    <div className="space-y-6">
                        {FEATURES.map(f => (
                            <div key={f.title} className="flex gap-4">
                                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                                    <f.icon className="w-5 h-5 text-emerald-300" />
                                </div>
                                <div>
                                    <h4 className="text-white font-semibold mb-0.5">{f.title}</h4>
                                    <p className="text-white/60 text-sm max-w-sm">{f.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Right panel ── */}
            <div className="flex-1 flex flex-col justify-center items-center py-8 px-4 sm:px-8 relative overflow-y-auto">
                <div className="w-full max-w-xl mx-auto my-auto">
                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8 sm:p-10">
                        <div className="text-center mb-8">
                            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Crear Cuenta</h2>
                            <p className="text-slate-500 mt-2 text-sm">Completa tus datos para registrarte</p>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Personal data */}
                            <div className="bg-blue-50/50 border border-blue-100 p-5 rounded-2xl space-y-4">
                                <h3 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <UserPlus className="w-3.5 h-3.5" /> Datos Personales
                                </h3>
                                <div>
                                    <label className="block mb-1.5 text-slate-700 text-sm font-semibold ml-1">Nombre completo</label>
                                    <input type="text" value={form.name} required placeholder="Tu nombre completo"
                                        onChange={e => set("name", e.target.value)}
                                        className={`${INPUT_BASE} border-blue-200 focus:border-blue-600 focus:bg-white`} />
                                </div>
                                <div>
                                    <label className="block mb-1.5 text-slate-700 text-sm font-semibold ml-1">Correo institucional</label>
                                    <input type="email" value={form.email} required placeholder="usuario@instituto.edu.mx"
                                        onChange={e => set("email", e.target.value)}
                                        className={`${INPUT_BASE} border-blue-200 focus:border-blue-600 focus:bg-white`} />
                                </div>
                            </div>

                            {/* Academic data */}
                            <div className="bg-emerald-50/50 border border-emerald-100 p-5 rounded-2xl space-y-4">
                                <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <GraduationCap className="w-3.5 h-3.5" /> Datos Académicos y Demográficos
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block mb-1.5 text-slate-700 text-sm font-semibold ml-1">Carrera</label>
                                        <select value={form.carrera} required onChange={e => set("carrera", e.target.value)}
                                            className={`${INPUT_BASE} border-emerald-200 focus:border-emerald-600 focus:bg-white appearance-none cursor-pointer`}>
                                            <option value="" disabled>Selecciona tu carrera</option>
                                            {CAREERS.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block mb-1.5 text-slate-700 text-sm font-semibold ml-1">Número de control</label>
                                        <input type="text" value={form.matricula} placeholder="Ej. 20210001"
                                            onChange={e => set("matricula", e.target.value)}
                                            className={`${INPUT_BASE} border-emerald-200 focus:border-emerald-600 focus:bg-white`} />
                                    </div>
                                    <div>
                                        <label className="block mb-1.5 text-slate-700 text-sm font-semibold ml-1">Semestre</label>
                                        <input type="number" value={form.semestre} placeholder="Ej. 5" min="1" max="12"
                                            onChange={e => set("semestre", e.target.value)}
                                            className={`${INPUT_BASE} border-emerald-200 focus:border-emerald-600 focus:bg-white`} />
                                    </div>
                                    <div>
                                        <label className="block mb-1.5 text-slate-700 text-sm font-semibold ml-1">Edad</label>
                                        <input type="number" value={form.edad} placeholder="Ej. 21" min="15" max="60"
                                            onChange={e => set("edad", e.target.value)}
                                            className={`${INPUT_BASE} border-emerald-200 focus:border-emerald-600 focus:bg-white`} />
                                    </div>
                                </div>

                                <div className="pt-2">
                                    <label className="block mb-2 text-slate-700 text-sm font-semibold ml-1">Género</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {["Masculino", "Femenino"].map(g => (
                                            <button key={g} type="button" onClick={() => set("genero", g)}
                                                className={`py-2.5 rounded-xl border-2 font-medium transition-all active:scale-[0.98] cursor-pointer ${form.genero === g ? "border-emerald-600 bg-emerald-600 text-white shadow-md shadow-emerald-600/20" : "border-emerald-200 bg-white text-slate-600 hover:border-emerald-300"}`}>
                                                {g}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Security */}
                            <div className="bg-violet-50/50 border border-violet-100 p-5 rounded-2xl space-y-4">
                                <h3 className="text-xs font-bold text-violet-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <ShieldCheck className="w-3.5 h-3.5" /> Seguridad
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block mb-1.5 text-slate-700 text-sm font-semibold ml-1">Contraseña</label>
                                        <input type="password" value={form.password} required minLength={6} placeholder="Mínimo 6 caracteres"
                                            onChange={e => set("password", e.target.value)}
                                            className={`${INPUT_BASE} border-violet-200 focus:border-violet-600 focus:bg-white`} />
                                    </div>
                                    <div>
                                        <label className="block mb-1.5 text-slate-700 text-sm font-semibold ml-1">Confirmar</label>
                                        <input type="password" value={form.confirmPassword} required minLength={6} placeholder="Repite contraseña"
                                            onChange={e => set("confirmPassword", e.target.value)}
                                            className={`${INPUT_BASE} border-violet-200 focus:border-violet-600 focus:bg-white`} />
                                    </div>
                                </div>
                            </div>

                            <button type="submit" disabled={loading}
                                className="w-full py-4 mt-6 bg-gradient-to-r from-emerald-600 to-teal-500 text-white rounded-xl font-semibold shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-0.5 transition-all text-base cursor-pointer flex justify-center items-center gap-2">
                                {loading ? <><RefreshCw className="w-5 h-5 animate-spin" /> Registrando...</> : "Registrarse y Entrar"}
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
