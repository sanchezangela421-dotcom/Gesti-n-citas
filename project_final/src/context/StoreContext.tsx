import React, { useState, useCallback, createContext, useContext, useRef } from "react";
import { localISODate } from "../utils/date";
import { API, API_BASE, authHeaders, getImageUrl } from "../lib/api";
import type { StoreContextType } from "../types";

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
  const contentStore = useContentStore({
    users:           usersStore.users,
    addNotification: notificationsStore.addNotification,
  });

  // ── Stats (derived from appointments, fetched from backend) ──
  const [realStats, setRealStats] = useState<any>(null);

  const fetchStats = useCallback(async () => {
    if (!localStorage.getItem("token")) return;
    try {
      const res = await fetch(`${API}/stats`, { headers: authHeaders() });
      if (res.ok) setRealStats(await res.json());
    } catch { /* use local fallback */ }
  }, []);

  React.useEffect(() => { fetchStats(); }, [appointmentsStore.appointments, fetchStats]);

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
        byDept: {
          Psicología: a.filter(x => x.department === "Psicología").length,
          Tutorías:   a.filter(x => x.department === "Tutorías").length,
          Nutrición:  a.filter(x => x.department === "Nutrición").length,
        },
      },
      charts: { monthly: [], motivos: [], modalidad: [], carrera: [] },
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

  const getAvailableDays = useCallback(async (specialistId: string, year: number, month: number): Promise<Date[]> => {
    const spec = specialistsStore.getSpecialistById(specialistId);
    if (!spec) return [];

    const recurringDows = [...new Set(spec.schedule.filter(s => s.available && !s.specificDate).map(s => s.dayOfWeek))];
    const specificDates = [...new Set(spec.schedule.filter(s => s.available && s.specificDate).map(s => s.specificDate as string))];

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dayChecks: { date: Date; promise: Promise<string[]> }[] = [];

    for (let m = 0; m < 2; m++) {
      const targetMonth = month + m;
      const targetYear  = targetMonth > 11 ? year + 1 : year;
      const normMonth   = targetMonth % 12;
      for (
        let d = new Date(targetYear, normMonth, 1), end = new Date(targetYear, normMonth + 1, 0);
        d <= end;
        d.setDate(d.getDate() + 1)
      ) {
        if (d < today) continue;
        const ds = localISODate(d);
        if (recurringDows.includes(d.getDay()) || specificDates.includes(ds)) {
          dayChecks.push({ date: new Date(d), promise: getAvailableSlots(specialistId, ds) });
        }
      }
    }

    const days: Date[] = [];
    for (const check of dayChecks) {
      const slots = await check.promise;
      if (slots.length > 0) days.push(check.date);
    }
    return days;
  }, [specialistsStore.getSpecialistById, getAvailableSlots]);

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
    ]);
  }, [
    specialistsStore.loadSpecialists,
    appointmentsStore.loadAppointments,
    usersStore.loadUsers,
    contentStore.loadEvents,
    contentStore.loadResources,
    notificationsStore.loadNotifications,
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

  return (
    <StoreContext.Provider value={{
      // users
      users: usersStore.users,
      getUserById: usersStore.getUserById,
      deleteUser: usersStore.deleteUser,
      // specialists
      specialists: specialistsStore.specialists,
      specialistsLoaded: specialistsStore.specialistsLoaded,
      getSpecialists: specialistsStore.getSpecialists,
      getSpecialistById: specialistsStore.getSpecialistById,
      addSpecialist: specialistsStore.addSpecialist,
      updateSpecialist: specialistsStore.updateSpecialist,
      removeSpecialist: specialistsStore.removeSpecialist,
      addScheduleSlot: specialistsStore.addScheduleSlot,
      removeScheduleSlot: specialistsStore.removeScheduleSlot,
      updateMeetingUrl: specialistsStore.updateMeetingUrl,
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
      // notifications
      notifications: notificationsStore.notifications,
      addNotification: notificationsStore.addNotification,
      markNotificationsRead: notificationsStore.markNotificationsRead,
      deleteNotification: notificationsStore.deleteNotification,
      clearAllNotifications: notificationsStore.clearAllNotifications,
      // global
      fetchAll,
      isOnline,
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = (): StoreContextType => {
  const c = useContext(StoreContext);
  if (!c) throw new Error("useStore must be inside StoreProvider");
  return c;
};
