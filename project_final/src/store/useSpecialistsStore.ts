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
      .then(r => {
        // Misma trampa que en el registro: sin comprobar el estado, el cuerpo de
        // un error acababa en `users`, y cualquier `users.filter(...)` del panel
        // del admin reventaba la pantalla entera.
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => { if (Array.isArray(data)) setUsers(data); })
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

  /**
   * Da de alta al especialista y devuelve su ficha, o null si no se creó.
   *
   * Devolver algo no es un detalle: antes era void, y AdminDashboard
   * anunciaba "Invitación enviada" justo después de que esta función
   * hubiera mostrado su propio error. El admin veía las dos cosas a la vez
   * y el formulario se vaciaba igual.
   */
  const addSpecialist = useCallback(async (data: SpecialistInput): Promise<Specialist | null> => {
    try {
      const res = await fetch(`${API}/specialists`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "No se pudo crear el especialista.");
        return null;
      }
      const newSpec = await res.json();
      // `pendingActivation` lo calcula el GET de la lista, no el POST. Sin
      // fijarlo aquí, la fila recién creada salía sin el distintivo ni el
      // botón de reenviar hasta recargar — justo lo que el aviso le pide
      // hacer cuando el correo no sale. Recién invitado siempre está
      // pendiente: lo deja de estar al activar la cuenta.
      setSpecialists(p => [...p, { ...newSpec, schedule: newSpec.schedules ?? [], pendingActivation: true }]);
      refreshUsers();
      return newSpec;
    } catch (err) {
      console.error("Error adding specialist:", err);
      toast.error("No se pudo crear el especialista.");
      return null;
    }
  }, [refreshUsers]);

  /**
   * Reenvía la invitación a quien nunca activó su cuenta.
   *
   * Es la salida que faltaba cuando el correo no sale: el especialista no
   * sabe que su cuenta existe, así que no va a pedir "olvidé mi
   * contraseña", y darlo de alta otra vez choca con su correo ya tomado.
   */
  const resendSpecialistInvitation = useCallback(async (id: string): Promise<boolean | null> => {
    try {
      const res = await fetch(`${API}/specialists/${id}/resend-invitation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // null y no false: el fallo ya se avisó aquí. Devolver false haría
        // que quien llama añadiera un segundo aviso encima del primero.
        toast.error(body.error || "No se pudo reenviar la invitación.");
        return null;
      }
      return body.invitationSent === true;
    } catch (err) {
      console.error("Error resending invitation:", err);
      toast.error("No se pudo reenviar la invitación.");
      return null;
    }
  }, []);

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

  /**
   * Publica un horario. Devuelve si el servidor lo ACEPTÓ.
   *
   * Antes no devolvía nada, así que quien la llamaba cantaba "Horario agregado"
   * sin esperar respuesta: con un rango inválido (5pm-1pm) aparecían los dos
   * avisos a la vez, el de éxito y el de error. Ahora el mensaje lo decide el
   * resultado real.
   */
  const addScheduleSlot = useCallback(async (specialistId: string, slot: Omit<ScheduleSlot, "id">): Promise<boolean> => {
    try {
      const res = await fetch(`${API}/specialists/${specialistId}/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(slot),
      });
      if (!res.ok) {
        // El servidor explica el motivo (solape, fecha pasada, rango inválido);
        // mostrarlo evita el genérico "no se pudo" que no dice qué corregir.
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "No se pudo agregar el horario.");
      }
      const newSlot = await res.json();
      setSpecialists(p =>
        p.map(s => s.id === specialistId ? { ...s, schedule: [...s.schedule, newSlot] } : s)
      );
      return true;
    } catch (err) {
      console.error("Error adding schedule slot:", err);
      toast.error(errorMessage(err, "No se pudo agregar el horario."));
      return false;
    }
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

  /**
   * Elimina un horario. Devuelve si el servidor lo aceptó.
   *
   * Si falla, el horario se DEVUELVE a la lista: antes se quitaba de la pantalla
   * de forma optimista y ahí se quedaba, así que el especialista lo veía
   * desaparecer aunque siguiera existiendo en el servidor (reaparecía solo al
   * refrescar). Tampoco se miraba el código de respuesta: un 403 o un 404 se
   * daban por buenos.
   */
  const removeScheduleSlot = useCallback(async (specialistId: string, slotId: string): Promise<boolean> => {
    let removed: ScheduleSlot | undefined;
    // Optimistic update
    setSpecialists(p =>
      p.map(s => {
        if (s.id !== specialistId) return s;
        removed = s.schedule.find(sl => sl.id === slotId);
        return { ...s, schedule: s.schedule.filter(sl => sl.id !== slotId) };
      })
    );
    try {
      const res = await fetch(`${API}/specialists/${specialistId}/schedules/${slotId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "No se pudo eliminar el horario.");
      }
      return true;
    } catch (err) {
      console.error("Error removing schedule slot:", err);
      if (removed) {
        const back = removed;
        setSpecialists(p =>
          p.map(s => s.id === specialistId ? { ...s, schedule: [...s.schedule, back] } : s)
        );
      }
      toast.error(errorMessage(err, "No se pudo eliminar el horario."));
      return false;
    }
  }, []);

  return {
    specialists,
    specialistsLoaded,
    setSpecialistsLoaded,
    loadSpecialists,
    getSpecialists,
    getSpecialistById,
    addSpecialist,
    resendSpecialistInvitation,
    updateSpecialist,
    removeSpecialist,
    restoreSpecialist,
    addScheduleSlot,
    removeScheduleSlot,
    updateMeetingUrl,
    updateSpecialistLocation,
  };
}
