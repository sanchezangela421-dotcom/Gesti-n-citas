import { useState, useCallback, type Dispatch, type SetStateAction } from "react";
import { API, authHeaders } from "../lib/api";
import type { Specialist, ScheduleSlot, SpecialistInput, User } from "../types";
import { toast } from "sonner";

export function useSpecialistsStore(setUsers: Dispatch<SetStateAction<User[]>>) {
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [specialistsLoaded, setSpecialistsLoaded] = useState(false);

  const loadSpecialists = useCallback(async (headers: Record<string, string>) => {
    const res = await fetch(`${API}/specialists`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    setSpecialists(data.map((s: any) => ({ ...s, schedule: s.schedules ?? [] })));
    setSpecialistsLoaded(true);
  }, []);

  const refreshUsers = useCallback(() => {
    fetch(`${API}/users`, { headers: authHeaders() })
      .then(r => r.json())
      .then(setUsers)
      .catch(() => { });
  }, [setUsers]);

  const getSpecialists = useCallback(
    (dept?: string) => dept ? specialists.filter(s => s.department === dept) : [...specialists],
    [specialists]
  );

  const getSpecialistById = useCallback(
    (id: string) => specialists.find(s => s.id === id) ?? null,
    [specialists]
  );

  const addSpecialist = useCallback(async (data: SpecialistInput) => {
    try {
      const res = await fetch(`${API}/specialists`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "No se pudo crear el especialista.");
        return;
      }
      const newSpec = await res.json();
      setSpecialists(p => [...p, { ...newSpec, schedule: newSpec.schedules ?? [] }]);
      refreshUsers();
    } catch (err) {
      console.error("Error adding specialist:", err);
      toast.error("No se pudo crear el especialista.");
    }
  }, [refreshUsers]);

  const updateSpecialist = useCallback(async (id: string, data: Partial<SpecialistInput>) => {
    try {
      const res = await fetch(`${API}/specialists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      setSpecialists(p => p.map(s => s.id === id ? { ...updated, schedule: updated.schedules ?? [] } : s));
      refreshUsers();
    } catch (err) {
      console.error("Error updating specialist:", err);
      toast.error("No se pudo actualizar el especialista.");
    }
  }, [refreshUsers]);

  const removeSpecialist = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API}/specialists/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
      setSpecialists(p => p.filter(s => s.id !== id));
      refreshUsers();
    } catch (err) {
      console.error("Error removing specialist:", err);
      toast.error("No se pudo eliminar el especialista.");
    }
  }, [refreshUsers]);

  const addScheduleSlot = useCallback((specialistId: string, slot: Omit<ScheduleSlot, "id">) => {
    fetch(`${API}/specialists/${specialistId}/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(slot),
    })
      .then(res => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(newSlot => {
        setSpecialists(p =>
          p.map(s => s.id === specialistId ? { ...s, schedule: [...s.schedule, newSlot] } : s)
        );
      })
      .catch(err => {
        console.error("Error adding schedule slot:", err);
        toast.error("No se pudo agregar el horario.");
      });
  }, []);

  const updateMeetingUrl = useCallback(async (specialistId: string, meetingUrl: string | null) => {
    try {
      const res = await fetch(`${API}/specialists/${specialistId}/meeting-url`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ meetingUrl }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      setSpecialists(p => p.map(s => s.id === specialistId ? { ...updated, schedule: updated.schedules ?? [] } : s));
      toast.success("Enlace de videoconferencia actualizado");
    } catch (err) {
      console.error("Error updating meeting URL:", err);
      toast.error("No se pudo actualizar el enlace.");
    }
  }, []);

  const removeScheduleSlot = useCallback((specialistId: string, slotId: string) => {
    // Optimistic update
    setSpecialists(p =>
      p.map(s => s.id === specialistId ? { ...s, schedule: s.schedule.filter(sl => sl.id !== slotId) } : s)
    );
    fetch(`${API}/specialists/${specialistId}/schedules/${slotId}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).catch(err => {
      console.error("Error removing schedule slot:", err);
      toast.error("No se pudo eliminar el horario.");
    });
  }, []);

  return {
    specialists,
    specialistsLoaded,
    setSpecialistsLoaded,
    loadSpecialists,
    getSpecialists,
    getSpecialistById,
    addSpecialist,
    updateSpecialist,
    removeSpecialist,
    addScheduleSlot,
    removeScheduleSlot,
    updateMeetingUrl,
  };
}
