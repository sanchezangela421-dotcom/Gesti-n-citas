import { useState, useCallback } from "react";
import { API, authHeaders, errorMessage } from "../lib/api";
import type { User } from "../types";
import { toast } from "sonner";

export function useUsersStore() {
  const [users, setUsers] = useState<User[]>([]);

  const loadUsers = useCallback(async (headers: Record<string, string>) => {
    const res = await fetch(`${API}/users?t=${Date.now()}`, { headers });
    if (!res.ok) return;
    setUsers(await res.json());
  }, []);

  const getUserById = useCallback(
    (id: string): User | null => users.find(u => u.id === id) ?? null,
    [users]
  );

  /**
   * Da de BAJA al usuario (no lo borra: su expediente clínico y su historial de
   * citas se conservan por retención legal). El servidor cancela sus citas
   * abiertas y avisa a los especialistas.
   */
  const deleteUser = useCallback(async (id: string, reason?: string) => {
    try {
      const res = await fetch(`${API}/users/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "No se pudo dar de baja al usuario.");
      }
      const { cancelledAppointments = 0 } = await res.json().catch(() => ({}));
      setUsers(p => p.filter(u => u.id !== id));
      toast.success(
        cancelledAppointments > 0
          ? `Cuenta dada de baja. Se cancelaron ${cancelledAppointments} cita${cancelledAppointments === 1 ? "" : "s"} y se avisó a los especialistas.`
          : "Cuenta dada de baja."
      );
    } catch (err) {
      console.error("Error deactivating user:", err);
      toast.error(errorMessage(err, "No se pudo dar de baja al usuario."));
    }
  }, []);

  /** Revierte la baja. Las citas canceladas NO se reabren. */
  const restoreUser = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${API}/users/${id}/restore`, { method: "POST", headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "No se pudo reactivar la cuenta.");
      }
      const restored = await res.json();
      setUsers(p => p.map(u => u.id === id ? { ...u, ...restored } : u));
      toast.success("Cuenta reactivada.");
    } catch (err) {
      console.error("Error restoring user:", err);
      toast.error(errorMessage(err, "No se pudo reactivar la cuenta."));
    }
  }, []);

  return { users, setUsers, loadUsers, getUserById, deleteUser, restoreUser };
}
