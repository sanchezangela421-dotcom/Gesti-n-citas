import React, { useState, useCallback, useMemo, createContext, useContext } from "react";
import { localISODate } from "../utils/date";
import { API, API_BASE, authHeaders, getImageUrl } from "../lib/api";
import type { StoreContextType, ReportPeriod } from "../types";
import { MISSED_STATUS } from "../constants";

// ── Domain stores ──────────────────────────────────────────
import { useUsersStore }        from "../store/useUsersStore";
import { useSpecialistsStore }  from "../store/useSpecialistsStore";
import { useNotificationsStore } from "../store/useNotificationsStore";
import { useAppointmentsStore } from "../store/useAppointmentsStore";
import { useContentStore }      from "../store/useContentStore";

export { API_BASE, getImageUrl };

export const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  // ── Domain slices ───────────────────────────────────────
  const usersStore         = useUsersStore();
  const specialistsStore   = useSpecialistsStore(usersStore.setUsers);
  const notificationsStore = useNotificationsStore();
  const appointmentsStore  = useAppointmentsStore({
    specialists:     specialistsStore.specialists,
    users:           usersStore.users,
    addNotification: notificationsStore.addNotification,
  });
  const contentStore = useContentStore();

  // ── Período activo ─────────────────────────────────────
  const [activePeriod, setActivePeriod] = useState<ReportPeriod | null>(null);

  const fetchActivePeriod = useCallback(async () => {
    if (!localStorage.getItem("token")) return;
    try {
      const res = await fetch(`${API}/periods/active`, { headers: authHeaders() });
      if (res.ok) setActivePeriod(await res.json());
    } catch { /* silencioso */ }
  }, []);

  // ── Stats (derived from appointments, fetched from backend) ──
  const [realStats, setRealStats] = useState<any>(null);

  const fetchStats = useCallback(async () => {
    if (!localStorage.getItem("token")) return;
    try {
      const res = await fetch(`${API}/stats`, { headers: authHeaders() });
      if (res.ok) setRealStats(await res.json());
    } catch { /* use local fallback */ }
  }, []);

  const getStats = useCallback(() => {
    if (realStats) return realStats;
    const a = appointmentsStore.appointments;
    return {
      summary: {
        total: a.length,
        pendientes:  a.filter(x => x.status === "Pendiente").length,
        confirmadas: a.filter(x => x.status === "Confirmada").length,
        completadas: a.filter(x => x.status === "Completada").length,
        canceladas:  a.filter(x => x.status === "Cancelada").length,
        noAsistio:   a.filter(x => x.status === MISSED_STATUS).length,
        seguimientos: a.filter(x => x.isFollowUp).length,
        byDept: {
          Psicología: a.filter(x => x.department === "Psicología").length,
          Tutorías:   a.filter(x => x.department === "Tutorías").length,
          Nutrición:  a.filter(x => x.department === "Nutrición").length,
        },
      },
      // Misma forma que /api/stats: si el panel cae aquí porque la petición falló,
      // debe poder pintar sin claves ausentes que revienten al leerlas.
      charts: {
        monthly: [], motivos: [], modalidad: [], carrera: [],
        genero: [], semestre: [], edad: [], byField: [],
      },
      byDepartment: {},
    };
  }, [appointmentsStore.appointments, realStats]);

  // ── Available slots / days (backend) ───────────────────
  const getAvailableSlots = useCallback(async (specialistId: string, dateStr: string): Promise<{ start: string; end: string }[]> => {
    try {
      const res = await fetch(`${API}/specialists/${specialistId}/available-slots?date=${dateStr}`, { headers: authHeaders() });
      if (res.ok) return await res.json();
    } catch { /* fall through */ }
    return [];
  }, []);

  /**
   * Días con hueco del mes indicado y el siguiente.
   *
   * Antes esto se resolvía en el navegador: por cada día candidato se pedía
   * `available-slots`, ~60 peticiones por especialista para pintar el
   * calendario. Con el límite de 500 cada 15 minutos, un alumno comparando
   * especialistas agotaba su propia cuota y la aplicación se le rompía sin
   * explicación. Ahora el servidor lo resuelve en una consulta y esto es UNA
   * petición.
   */
  const getAvailableDays = useCallback(async (specialistId: string, year: number, month: number): Promise<Date[]> => {
    // Desde hoy (el pasado no se agenda) hasta el fin del mes siguiente.
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const firstOfMonth = new Date(year, month, 1);
    const from = localISODate(firstOfMonth < today ? today : firstOfMonth);
    const to   = localISODate(new Date(year, month + 2, 0));

    try {
      const res = await fetch(
        `${API}/specialists/${specialistId}/available-days?from=${from}&to=${to}`,
        { headers: authHeaders() },
      );
      if (!res.ok) return [];
      const dates: string[] = await res.json();
      // El servidor responde "YYYY-MM-DD"; el calendario espera objetos Date.
      // El mediodía evita que el desfase de zona horaria corra la fecha un día.
      return dates.map(d => new Date(d + "T12:00:00"));
    } catch {
      return [];
    }
  }, []);

  // ── #25 Smart polling ──────────────────────────────────
  // fetchAll: loads everything (called on login / visibility / slow poll)
  const fetchAll = useCallback(async () => {
    if (!localStorage.getItem("token")) return;
    const headers = authHeaders();
    await Promise.all([
      specialistsStore.loadSpecialists(headers),
      appointmentsStore.loadAppointments(headers),
      usersStore.loadUsers(headers),
      contentStore.loadEvents(headers),
      contentStore.loadResources(headers),
      notificationsStore.loadNotifications(headers),
      fetchActivePeriod(),
      fetchStats(),
    ]);
  }, [
    specialistsStore.loadSpecialists,
    appointmentsStore.loadAppointments,
    usersStore.loadUsers,
    contentStore.loadEvents,
    contentStore.loadResources,
    notificationsStore.loadNotifications,
    fetchActivePeriod,
    fetchStats,
  ]);

  // fetchVolatile: only appointments + notifications (runs on the fast 30s poll)
  const fetchVolatile = useCallback(async () => {
    if (!localStorage.getItem("token")) return;
    const headers = authHeaders();
    await Promise.all([
      appointmentsStore.loadAppointments(headers),
      notificationsStore.loadNotifications(headers),
    ]);
  }, [appointmentsStore.loadAppointments, notificationsStore.loadNotifications]);

  // Initial load
  React.useEffect(() => { fetchAll(); }, [fetchAll]);

  // Fast poll — only volatile data (appointments + notifications) every 30s
  React.useEffect(() => {
    const interval = setInterval(fetchVolatile, 30_000);
    return () => clearInterval(interval);
  }, [fetchVolatile]);

  // Slow poll — everything (specialists, content, users) every 5 minutes
  React.useEffect(() => {
    const interval = setInterval(fetchAll, 300_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Refetch on tab focus
  React.useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchVolatile(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchVolatile]);

  // Online / offline detection
  const [isOnline, setIsOnline] = React.useState(navigator.onLine);
  React.useEffect(() => {
    const onOnline  = () => { setIsOnline(true);  fetchAll(); };
    const onOffline = () => { setIsOnline(false); };
    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [fetchAll]);

  const storeValue = useMemo(() => ({
    // users
    users: usersStore.users,
    getUserById: usersStore.getUserById,
    deleteUser: usersStore.deleteUser,
    restoreUser: usersStore.restoreUser,
    // specialists
    specialists: specialistsStore.specialists,
    specialistsLoaded: specialistsStore.specialistsLoaded,
    getSpecialists: specialistsStore.getSpecialists,
    getSpecialistById: specialistsStore.getSpecialistById,
    addSpecialist: specialistsStore.addSpecialist,
    updateSpecialist: specialistsStore.updateSpecialist,
    removeSpecialist: specialistsStore.removeSpecialist,
    restoreSpecialist: specialistsStore.restoreSpecialist,
    addScheduleSlot: specialistsStore.addScheduleSlot,
    removeScheduleSlot: specialistsStore.removeScheduleSlot,
    updateMeetingUrl: specialistsStore.updateMeetingUrl,
    updateSpecialistLocation: specialistsStore.updateSpecialistLocation,
    // appointments
    appointments: appointmentsStore.appointments,
    getAppointments: appointmentsStore.getAppointments,
    createAppointment: appointmentsStore.createAppointment,
    updateAppointmentStatus: appointmentsStore.updateAppointmentStatus,
    rescheduleAppointment: appointmentsStore.rescheduleAppointment,
    getAvailableSlots,
    getAvailableDays,
    // content
    events: contentStore.events,
    addEvent: contentStore.addEvent,
    updateEvent: contentStore.updateEvent,
    deleteEvent: contentStore.deleteEvent,
    resources: contentStore.resources,
    addResource: contentStore.addResource,
    updateResource: contentStore.updateResource,
    deleteResource: contentStore.deleteResource,
    // stats
    getStats,
    activePeriod,
    // notifications
    notifications: notificationsStore.notifications,
    addNotification: notificationsStore.addNotification,
    markNotificationsRead: notificationsStore.markNotificationsRead,
    deleteNotification: notificationsStore.deleteNotification,
    clearAllNotifications: notificationsStore.clearAllNotifications,
    // global
    fetchAll,
    isOnline,
  }), [
    usersStore.users, usersStore.getUserById, usersStore.deleteUser, usersStore.restoreUser,
    specialistsStore.specialists, specialistsStore.specialistsLoaded,
    specialistsStore.getSpecialists, specialistsStore.getSpecialistById,
    specialistsStore.addSpecialist, specialistsStore.updateSpecialist,
    specialistsStore.removeSpecialist, specialistsStore.restoreSpecialist,
    specialistsStore.addScheduleSlot,
    specialistsStore.removeScheduleSlot, specialistsStore.updateMeetingUrl,
    specialistsStore.updateSpecialistLocation,
    appointmentsStore.appointments, appointmentsStore.getAppointments,
    appointmentsStore.createAppointment, appointmentsStore.updateAppointmentStatus,
    appointmentsStore.rescheduleAppointment,
    getAvailableSlots, getAvailableDays,
    contentStore.events, contentStore.addEvent, contentStore.updateEvent, contentStore.deleteEvent,
    contentStore.resources, contentStore.addResource, contentStore.updateResource, contentStore.deleteResource,
    getStats, activePeriod,
    notificationsStore.notifications, notificationsStore.addNotification,
    notificationsStore.markNotificationsRead, notificationsStore.deleteNotification,
    notificationsStore.clearAllNotifications,
    fetchAll, isOnline,
  ]);

  return (
    <StoreContext.Provider value={storeValue}>
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = (): StoreContextType => {
  const c = useContext(StoreContext);
  if (!c) throw new Error("useStore must be inside StoreProvider");
  return c;
};
