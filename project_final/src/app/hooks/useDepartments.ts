import { useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { ALL_DEPARTMENTS } from "../../constants";

/**
 * Departamentos que la organización del usuario tiene contratados.
 *
 * `/api/auth/me` ya devuelve el objeto completo de la organización, así que la
 * lista llega sin ninguna petición extra.
 *
 * Ocultar aquí un departamento es solo presentación: el servidor valida por su
 * cuenta al agendar y al crear especialistas, porque el cliente nunca es la
 * autoridad sobre lo que está contratado.
 *
 * Respaldo a los tres departamentos cuando no hay organización (datos legacy
 * previos al modelo multi-tenant): quedarse sin ninguno dejaría la pantalla en
 * blanco, que es peor que mostrar de más.
 */
export function useDepartments(): string[] {
  const { user } = useAuth();
  const contracted = user?.organization?.departments;

  return useMemo(() => {
    if (!Array.isArray(contracted) || contracted.length === 0) return [...ALL_DEPARTMENTS];
    // Se respeta el orden del catálogo para que los selectores no bailen
    // según cómo se hayan guardado en la base de datos.
    return ALL_DEPARTMENTS.filter(d => contracted.includes(d));
  }, [contracted]);
}
