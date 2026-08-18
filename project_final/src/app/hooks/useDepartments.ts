import { useMemo } from "react";
import { useAuth } from "../../context/AuthContext";
import { ALL_DEPARTMENTS, resolveDeptStyle } from "../../constants";
import type { OrgDepartment } from "../../types";

/**
 * Catálogo de departamentos contratados por la organización del usuario.
 *
 * `/api/auth/me` ya devuelve la organización con su catálogo, así que la lista
 * llega sin ninguna petición extra.
 *
 * Ocultar aquí un departamento es solo presentación: el servidor valida por su
 * cuenta al agendar y al crear especialistas, porque el cliente nunca es la
 * autoridad sobre lo que está contratado.
 *
 * Respaldo a los tres originales cuando la organización todavía no tiene
 * catálogo (datos previos a la migración): quedarse sin ninguno dejaría la
 * pantalla en blanco, que es peor que mostrar de más.
 */
export function useDepartmentCatalog(): OrgDepartment[] {
    const { user } = useAuth();
    const catalog = user?.organization?.orgDepartments;
    const contracted = user?.organization?.departments;

    return useMemo(() => {
        if (Array.isArray(catalog) && catalog.length > 0) {
            return [...catalog].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
        }

        // Sin catálogo: se reconstruye desde los nombres contratados, y si
        // tampoco hay, desde los tres originales.
        const names = Array.isArray(contracted) && contracted.length > 0
            ? contracted
            : [...ALL_DEPARTMENTS];

        return names.map((name, i) => {
            const style = resolveDeptStyle(name);
            return {
                id: `fallback-${name}`,
                name,
                color: style.color,
                icon: "Stethoscope",
                // El servidor es quien decide de verdad si exige nota; este
                // respaldo solo pinta, nunca autoriza.
                requiresNote: false,
                order: i,
            };
        });
    }, [catalog, contracted]);
}

/** Solo los nombres. Para selectores y filtros que no necesitan presentación. */
export function useDepartments(): string[] {
    const catalog = useDepartmentCatalog();
    return useMemo(() => catalog.map(d => d.name), [catalog]);
}
