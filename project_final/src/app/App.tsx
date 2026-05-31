import { useState, useEffect, lazy, Suspense, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { Toaster } from "sonner";
import { useAuth } from "../context/AuthContext";
import { useStore } from "../context/StoreContext";

// ─── Error Boundary ───────────────────────────────────────
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl shadow-lg p-8 text-center">
            <div className="w-14 h-14 bg-rose-100 dark:bg-rose-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚠</span>
            </div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Algo salió mal</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">
              Ocurrió un error inesperado. Recarga la página para continuar.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-xl transition-colors"
            >
              Recargar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Lazy chunks — cada rol descarga solo su dashboard ───
const LoginForm           = lazy(() => import("./pages/auth/LoginForm").then(m => ({ default: m.LoginForm })));
const RegisterForm        = lazy(() => import("./pages/auth/RegisterForm").then(m => ({ default: m.RegisterForm })));
const StudentDashboard    = lazy(() => import("./pages/student/StudentDashboard").then(m => ({ default: m.StudentDashboard })));
const SpecialistDashboard = lazy(() => import("./pages/specialist/SpecialistDashboard").then(m => ({ default: m.SpecialistDashboard })));
const AdminDashboard      = lazy(() => import("./pages/admin/AdminDashboard").then(m => ({ default: m.AdminDashboard })));

// ─── Spinner compartido para Suspense y loading de auth ──
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-500 dark:text-slate-400 font-bold animate-pulse">Cargando...</p>
      </div>
    </div>
  );
}

// ─── AppRouter ───────────────────────────────────────────
function AppRouter() {
  const { user, isAuthenticated, loading } = useAuth();
  const { fetchAll } = useStore();

  useEffect(() => {
    if (isAuthenticated) fetchAll();
  }, [isAuthenticated, fetchAll]);

  const [view, setView] = useState<"login" | "register">("login");

  if (loading) return <LoadingScreen />;

  if (!isAuthenticated || !user) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        {view === "register"
          ? <RegisterForm onSwitchToLogin={() => setView("login")} />
          : <LoginForm onSwitchToRegister={() => setView("register")} />}
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
      {user.role === "alumno"       && <StudentDashboard />}
      {user.role === "especialista" && <SpecialistDashboard />}
      {user.role === "admin"        && <AdminDashboard />}
    </Suspense>
  );
}

// ─── Root ────────────────────────────────────────────────
export default function App() {
  return (
    <ErrorBoundary>
      <AppRouter />
      <Toaster position="top-right" richColors />
    </ErrorBoundary>
  );
}
