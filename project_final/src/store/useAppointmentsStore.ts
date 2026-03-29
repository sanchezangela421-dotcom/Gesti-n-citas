import { useState, useCallback, useMemo } from "react";
import { API, authHeaders } from "../lib/api";
import type { Appointment, AppointmentFilters, Specialist, User, AppNotification } from "../types";
import { toast } from "sonner";

interface AppointmentsStoreDeps {
  specialists: Specialist[];
  users: User[];
  addNotification: (userId: string, notif: Omit<AppNotification, "id" | "time" | "read">) => void;
}

export function useAppointmentsStore({ specialists, users, addNotification }: AppointmentsStoreDeps) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  const loadAppointments = useCallback(async (headers: Record<string, string>) => {
    const res = await fetch(`${API}/appointments`, { headers });
    if (!res.ok) return;
    setAppointments(await res.json());
  }, []);

  // #26 — memoized resolved appointments (names synced from latest state)
  const resolvedAppointments = useMemo(() =>
    appointments.map(appt => {
      const student = users.find(u => u.id === appt.studentId);
      const specialist = specialists.find(s => s.id === appt.specialistId);
      return {
        ...appt,
        studentName: student?.name ?? appt.studentName,
        specialistName: specialist?.name ?? appt.specialistName,
      };
    }),
    [appointments, users, specialists]
  );

  const getAppointments = useCallback((filters: AppointmentFilters = {}): Appointment[] => {
    let r = resolvedAppointments;
    if (filters.studentId)    r = r.filter(a => a.studentId    === filters.studentId);
    if (filters.specialistId) r = r.filter(a => a.specialistId === filters.specialistId);
    if (filters.department)   r = r.filter(a => a.department   === filters.department);
    if (filters.status)       r = r.filter(a => a.status       === filters.status);
    return r.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [resolvedAppointments]);

  const createAppointment = useCallback((req: {
    studentId: string; studentName?: string; specialistId: string;
    department: string; motivo: string; modality: string;
    preferredDate: string; preferredTime: string;
    isFollowUp?: boolean; parentId?: string;
  }): Appointment => {
    const spec = specialists.find(s => s.id === req.specialistId);
    const student = users.find(u => u.id === req.studentId);
    const payload = {
      studentId: req.studentId,
      studentName: req.studentName ?? student?.name ?? "Alumno",
      specialistId: req.specialistId,
      specialistName: spec?.name ?? "Especialista",
      department: req.department,
      date: req.preferredDate,
      time: req.preferredTime,
      modality: req.modality,
      motivo: req.motivo,
      isFollowUp: req.isFollowUp ?? false,
      parentId: req.parentId ?? null,
    };
    const tempId = `temp-${Date.now()}`;
    const tempAppt = { ...payload, id: tempId, status: "Pendiente", createdAt: new Date().toISOString() } as Appointment;

    setAppointments(p => [tempAppt, ...p]);

    fetch(`${API}/appointments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Error al crear la cita");
        }
        return res.json();
      })
      .then(newAppt => {
        setAppointments(p => [newAppt, ...p.filter(a => a.id !== tempId)]);
        toast.success("Cita creada exitosamente");
      })
      .catch(err => {
        console.error("Error creating appointment:", err);
        setAppointments(p => p.filter(a => a.id !== tempId));
        toast.error(err.message || "No se pudo crear la cita. Intenta de nuevo.");
      });

    return tempAppt;
  }, [specialists, users]);

  const updateAppointmentStatus = useCallback((id: string, status: string, notes?: string, byStudent?: boolean) => {
    let originalStatus: string | null = null;
    let capturedAppt: Appointment | null = null;

    // Optimistic update — only state, NO notifications yet
    setAppointments(p => {
      const appt = p.find(a => a.id === id);
      if (appt) {
        originalStatus = appt.status;
        capturedAppt = appt;
      }
      return p.map(a => a.id === id ? { ...a, status, ...(notes ? { notes } : {}) } : a);
    });

    fetch(`${API}/appointments/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ status, notes }),
    }).then(async res => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Error al actualizar la cita");
      }
      // Notify ONLY after server confirms the change
      if (!capturedAppt) return;
      const appt = capturedAppt;
      if (status === "Confirmada") {
        const spec = specialists.find(s => s.id === appt.specialistId);
        const virtualInfo = appt.modality === "Virtual"
          ? spec?.meetingUrl
            ? ` Enlace de videollamada: ${spec.meetingUrl}`
            : " Tu especialista compartirá el enlace de videollamada."
          : "";
        addNotification(appt.studentId, {
          title: "Cita Confirmada",
          message: `Tu cita con ${appt.specialistName} de ${appt.department} el ${new Date(appt.date + "T12:00:00").toLocaleDateString()} a las ${appt.time} ha sido confirmada.${virtualInfo}`,
          type: "confirmed",
        });
      } else if (status === "Completada") {
        addNotification(appt.studentId, {
          title: "Cita Completada",
          message: `Tu cita con ${appt.specialistName} del ${new Date(appt.date + "T12:00:00").toLocaleDateString()} a las ${appt.time} fue marcada como completada.`,
          type: "completed",
        });
      } else if (status === "Cancelada") {
        if (!byStudent) {
          const motivoInfo = notes ? ` Motivo: ${notes}` : "";
          addNotification(appt.studentId, {
            title: "Cita Cancelada",
            message: `El especialista ${appt.specialistName} canceló la cita de ${appt.department} del ${new Date(appt.date + "T12:00:00").toLocaleDateString()} a las ${appt.time}.${motivoInfo}`,
            type: "cancelled",
          });
        } else {
          addNotification(appt.specialistId, {
            title: "Cita Cancelada por Alumno",
            message: `${appt.studentName} canceló la cita del ${new Date(appt.date + "T12:00:00").toLocaleDateString()} a las ${appt.time}. Motivo: ${notes ?? "Sin especificar"}`,
            type: "cancelled",
          });
        }
      }
    }).catch(err => {
      console.error("Error updating appointment status:", err);
      toast.error(err.message || "No se pudo actualizar el estado de la cita.");
      // Revert optimistic update on failure
      if (originalStatus) {
        setAppointments(p => p.map(a => a.id === id ? { ...a, status: originalStatus! } : a));
      }
    });
  }, [addNotification, specialists]);

  const rescheduleAppointment = useCallback((
    id: string, newDate: string, newTime: string,
    byRole?: "specialist" | "student", modality?: string
  ) => {
    // Capture original values before optimistic update for rollback
    let original: { date: string; time: string; modality: string; status: string } | null = null;

    setAppointments(p => {
      const appt = p.find(a => a.id === id);
      if (appt) {
        original = { date: appt.date, time: appt.time, modality: appt.modality, status: appt.status };
        const newModality = modality ?? appt.modality;
        const modalityChanged = modality && modality !== appt.modality;
        if (byRole === "specialist") {
          addNotification(appt.studentId, {
            title: "Cita Reagendada",
            message: `Tu cita con ${appt.specialistName} fue reagendada para el ${new Date(newDate + "T12:00:00").toLocaleDateString()} a las ${newTime}.`,
            type: "reschedule",
          });
        } else if (byRole === "student") {
          addNotification(appt.specialistId, {
            title: "Cita Reagendada por Alumno",
            message: `${appt.studentName} reagendó su cita para el ${new Date(newDate + "T12:00:00").toLocaleDateString()} a las ${newTime}.${modalityChanged ? ` Modalidad: ${newModality}.` : ""}`,
            type: "reschedule",
          });
        }
      }
      return p.map(a => a.id === id ? { ...a, date: newDate, time: newTime, ...(byRole === "student" && { status: "Pendiente" }), ...(modality && { modality }) } : a);
    });

    fetch(`${API}/appointments/${id}/reschedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ date: newDate, time: newTime, modality, byRole }),
    }).then(async res => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Error al reagendar la cita");
      }
    }).catch(err => {
      console.error("Error rescheduling appointment:", err);
      toast.error(err.message || "No se pudo reagendar la cita.");
      if (original) {
        setAppointments(p => p.map(a => a.id === id ? { ...a, ...original! } : a));
      }
    });
  }, [addNotification]);

  return {
    appointments,
    loadAppointments,
    getAppointments,
    createAppointment,
    updateAppointmentStatus,
    rescheduleAppointment,
  };
}
