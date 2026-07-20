import { useState, useCallback } from "react";
import { API, authHeaders, authOnlyHeaders, getImageUrl } from "../lib/api";
import type { AppEvent, Resource } from "../types";
import { toast } from "sonner";

export function useContentStore() {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);

  const loadEvents = useCallback(async (headers: Record<string, string>) => {
    const res = await fetch(`${API}/events`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    setEvents(data.map((e: any) => ({ ...e, imageUrl: getImageUrl(e.imageUrl) })));
  }, []);

  const loadResources = useCallback(async (headers: Record<string, string>) => {
    const res = await fetch(`${API}/resources`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    setResources(data.map((r: any) => ({
      ...r,
      imageUrl: getImageUrl(r.imageUrl),
      fileUrl: getImageUrl(r.fileUrl),
    })));
  }, []);

  const addEvent = useCallback(async (ev: Omit<AppEvent, "id">, file?: File) => {
    try {
      const formData = new FormData();
      Object.entries(ev).forEach(([key, value]) => {
        if (value !== undefined) formData.append(key, value as string);
      });
      if (file) formData.append("image", file);

      const res = await fetch(`${API}/events`, {
        method: "POST",
        headers: authOnlyHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const newEv = await res.json();
      setEvents(p => [{ ...newEv, imageUrl: getImageUrl(newEv.imageUrl) }, ...p]);
      toast.success("Evento publicado exitosamente");
      // La notificación in-app a los alumnos la crea el backend (una sola operación)
    } catch (err) {
      console.error("Error adding event:", err);
      toast.error("No se pudo publicar el evento.");
    }
  }, []);

  const addResource = useCallback(async (r: Omit<Resource, "id">, file?: File) => {
    try {
      const formData = new FormData();
      Object.entries(r).forEach(([key, value]) => {
        if (value !== undefined) formData.append(key, value as string);
      });
      if (file) formData.append("file", file);

      const res = await fetch(`${API}/resources`, {
        method: "POST",
        headers: authOnlyHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const newRes = await res.json();
      setResources(p => [...p, {
        ...newRes,
        imageUrl: getImageUrl(newRes.imageUrl),
        fileUrl: getImageUrl(newRes.fileUrl),
      }]);
      toast.success("Material educativo publicado");
    } catch (err) {
      console.error("Error adding resource:", err);
      toast.error("No se pudo publicar el recurso.");
    }
  }, []);

  const updateEvent = useCallback(async (id: string, data: Partial<Omit<AppEvent, "id">>, file?: File) => {
    try {
      const formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined) formData.append(key, value as string);
      });
      if (file) formData.append("image", file);

      const res = await fetch(`${API}/events/${id}`, {
        method: "PATCH",
        headers: authOnlyHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      setEvents(p => p.map(e => e.id === id ? { ...updated, imageUrl: getImageUrl(updated.imageUrl) } : e));
    } catch (err) {
      console.error("Error updating event:", err);
      toast.error("No se pudo actualizar el evento.");
    }
  }, []);

  const updateResource = useCallback(async (id: string, data: Partial<Omit<Resource, "id">>, file?: File) => {
    try {
      const formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        if (value !== undefined) formData.append(key, value as string);
      });
      if (file) formData.append("file", file);

      const res = await fetch(`${API}/resources/${id}`, {
        method: "PATCH",
        headers: authOnlyHeaders(),
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      setResources(p => p.map(r => r.id === id ? {
        ...updated,
        imageUrl: getImageUrl(updated.imageUrl),
        fileUrl: getImageUrl(updated.fileUrl),
      } : r));
    } catch (err) {
      console.error("Error updating resource:", err);
      toast.error("No se pudo actualizar el recurso.");
    }
  }, []);

  const deleteEvent = useCallback(async (id: string) => {
    setEvents(p => p.filter(e => e.id !== id));
    try {
      const res = await fetch(`${API}/events/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error("Error deleting event:", err);
      toast.error("No se pudo eliminar el evento.");
    }
  }, []);

  const deleteResource = useCallback(async (id: string) => {
    setResources(p => p.filter(r => r.id !== id));
    try {
      const res = await fetch(`${API}/resources/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.error("Error deleting resource:", err);
      toast.error("No se pudo eliminar el recurso.");
    }
  }, []);

  return { events, resources, loadEvents, loadResources, addEvent, updateEvent, addResource, updateResource, deleteEvent, deleteResource };
}
