import { useState, useCallback, type Dispatch, type SetStateAction } from "react";
import { API, authHeaders, errorMessage } from "../lib/api";
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

  /**
   * Da de BAJA al especialista (no lo borra: sus notas clínicas y su historial de
   * citas se conservan). El servidor cancela sus citas abiertas y avisa a los
   * pacientes; aquí solo se refleja el resultado.
   */
  const removeSpecialist = useCallback(async (id: string, reason?: string) => {
    try {
      const res = await fetch(`${API}/specialists/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "No se pudo dar de baja al especialista.");
      }
      const { cancelledAppointments = 0 } = await res.json().catch(() => ({}));
      setSpecialists(p => p.filter(s => s.id !== id));
      refreshUsers();
      toast.success(
        cancelledAppointments > 0
          ? `Especialista dado de baja. Se cancelaron ${cancelledAppointments} cita${cancelledAppointments === 1 ? "" : "s"} y se avisó a los pacientes.`
          : "Especialista dado de baja."
      );
    } catch (err) {
      console.error("Error deactivating specialist:", err);
      toast.error(errorMessage(err, "No se pudo dar de baja al especialista."));
    }
  }, [refreshUsers]);

  /** Revierte la baja. Las citas canceladas NO se reabren. */
  const restoreSpecialist = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API}/specialists/${id}/restore`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "No se pudo reactivar al especialista.");
      }
      const restored = await res.json();
      setSpecialists(p => {
        const next = { ...restored, schedule: restored.schedules ?? [] };
        return p.some(s => s.id === id) ? p.map(s => s.id === id ? next : s) : [...p, next];
      });
      refreshUsers();
      toast.success("Especialista reactivado.");
    } catch (err) {
      console.error("Error restoring specialist:", err);
      toast.error(errorMessage(err, "No se pudo reactivar al especialista."));
    }
  }, [refreshUsers]);

  const addScheduleSlot = useCallback((specialistId: string, slot: Omit<ScheduleSlot, "id">) => {
    fetch(`${API}/specialists/${specialistId}/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(slot),
    })
      .then(async res => {
        if (!res.ok) {
          // El servidor explica el motivo (solape, fecha pasada, rango inválido);
          // mostrarlo evita el genérico "no se pudo" que no dice qué corregir.
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "No se pudo agregar el horario.");
        }
        return res.json();
      })
      .then(newSlot => {
        setSpecialists(p =>
          p.map(s => s.id === specialistId ? { ...s, schedule: [...s.schedule, newSlot] } : s)
        );
      })
      .catch(err => {
        console.error("Error adding schedule slot:", err);
        toast.error(errorMessage(err, "No se pudo agregar el horario."));
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

  const updateSpecialistLocation = useCallback(async (specialistId: string, locationId: string | null) => {
    try {
      const res = await fetch(`${API}/specialists/${specialistId}/meeting-url`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ locationId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      setSpecialists(p => p.map(s => s.id === specialistId ? { ...updated, schedule: updated.schedules ?? [] } : s));
      toast.success("Sede actualizada");
    } catch (err) {
      console.error("Error updating location:", err);
      toast.error("No se pudo actualizar la sede.");
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
    restoreSpecialist,
    addScheduleSlot,
    removeScheduleSlot,
    updateMeetingUrl,
    updateSpecialistLocation,
  };
}
