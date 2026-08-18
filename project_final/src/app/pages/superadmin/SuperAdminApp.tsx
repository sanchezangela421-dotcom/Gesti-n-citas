import { useState, useEffect } from "react";
import { Toaster } from "sonner";
import { SuperAdminLogin } from "./SuperAdminLogin";
import { SuperAdminDashboard } from "./SuperAdminDashboard";

interface SAUser {
    id: string;
    email: string;
    name: string;
}

function LoadingScreen() {
    return (
        <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-rose-600 border-t-transparent rounded-full animate-spin" />
        </div>
    );
}

export function SuperAdminApp() {
    const [user, setUser]       = useState<SAUser | null>(null);
    const [loading, setLoading] = useState(true);

    // Rehydrate session from sa_token on mount
    useEffect(() => {
        const token = localStorage.getItem("sa_token");
        if (!token) { setLoading(false); return; }

        // Decode payload to check expiry without a round-trip
        try {
            const payload = JSON.parse(atob(token.split(".")[1]));
            if (payload.exp * 1000 < Date.now()) {
                localStorage.removeItem("sa_token");
                setLoading(false);
                return;
            }
            if (payload.role !== "superadmin") {
                localStorage.removeItem("sa_token");
                setLoading(false);
                return;
            }
            setUser({ id: payload.id, email: payload.email, name: payload.name ?? payload.email });
        } catch {
            localStorage.removeItem("sa_token");
        } finally {
            setLoading(false);
        }
    }, []);

    function handleLogin(token: string, userData: SAUser) {
        localStorage.setItem("sa_token", token);
        setUser(userData);
    }

    function handleLogout() {
        localStorage.removeItem("sa_token");
        setUser(null);
    }

    if (loading) return <LoadingScreen />;

    return (
        <>
            {user
                ? <SuperAdminDashboard user={user} onLogout={handleLogout} />
                : <SuperAdminLogin onLogin={handleLogin} />
            }
            <Toaster position="top-right" richColors />
        </>
    );
}
