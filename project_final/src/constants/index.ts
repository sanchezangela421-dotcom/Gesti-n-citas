import React from 'react';
import {
  Brain, GraduationCap, Apple, Stethoscope, HeartHandshake, Heart,
  Activity, BookOpen, Users, Scale, Smile, Briefcase,
} from "lucide-react";
import type { OrgDepartment } from "../types";

/**
 * Los tres departamentos con los que nació la plataforma.
 *
 * Ya NO son el catálogo: cada organización define los suyos (`OrgDepartment`).
 * Esta lista queda como respaldo para cuando todavía no llegó el catálogo del
 * servidor, para que ningún selector aparezca vacío.
 */
export const ALL_DEPARTMENTS = ["Psicología", "Tutorías", "Nutrición"] as const;

/**
 * Iconos que un departamento puede elegir. El servidor guarda el NOMBRE; aquí
 * se traduce al componente. Un nombre desconocido cae en `Stethoscope` en vez de
 * romper el render.
 */
export const DEPT_ICONS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  Brain, GraduationCap, Apple, Stethoscope, HeartHandshake, Heart,
  Activity, BookOpen, Users, Scale, Smile, Briefcase,
};

export const DEFAULT_DEPT_COLOR = "#64748b";

/** Presentación de los tres originales, para cuando aún no llegó el catálogo. */
export const DEPT_CONFIG: Record<string, { color: string; bg: string; border: string; icon: React.ComponentType<React.SVGProps<SVGSVGElement>> }> = {
  "Psicología": { color: "#2563EB", bg: "bg-[#dbeafe]", border: "border-[#93c5fd]", icon: Brain },
  "Tutorías": { color: "#16A34A", bg: "bg-[#dcfce7]", border: "border-[#86efac]", icon: GraduationCap },
  "Nutrición": { color: "#EA580C", bg: "bg-[#fff7ed]", border: "border-[#fdba74]", icon: Apple },
};

export interface DeptStyle {
  color: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}

/**
 * Color e icono de un departamento.
 *
 * Prioridad: lo que diga el catálogo de la organización → la presentación de los
 * tres originales → genérico. El último escalón importa: un departamento propio
 * recién creado debe verse bien aunque nadie le haya elegido color.
 */
export function resolveDeptStyle(name: string, catalog?: OrgDepartment[]): DeptStyle {
  const entry = catalog?.find(d => d.name === name);
  if (entry) {
    return { color: entry.color, icon: DEPT_ICONS[entry.icon] ?? Stethoscope };
  }
  const legacy = DEPT_CONFIG[name];
  if (legacy) return { color: legacy.color, icon: legacy.icon };
  return { color: DEFAULT_DEPT_COLOR, icon: Stethoscope };
}

/**
 * Motivos sugeridos. Solo los tres originales los tienen: un departamento propio
 * no puede traer una lista que nadie escribió, así que ahí el motivo se captura
 * como texto libre (ver el asistente de nueva cita).
 */
export function getDeptReasons(name: string | null | undefined): string[] {
  return (name && DEPT_REASONS[name]) || [];
}

export const DEPT_REASONS: Record<string, string[]> = {
  "Psicología": ["Situaciones académicas", "Situaciones emocionales", "Situaciones de salud física o mental", "No estoy seguro del porqué", "Lo sugirió mi maestro o tutor", "Problemas económicos"],
  "Tutorías": ["Dificultades en materias específicas", "Orientación vocacional y profesional", "Técnicas y hábitos de estudio", "Planeación académica del semestre", "Asesoría para servicio social o residencias", "Bajo rendimiento académico"],
  "Nutrición": ["Valoración nutricional inicial", "Plan de alimentación personalizado", "Trastornos de la conducta alimentaria", "Control de peso", "Alimentación deportiva", "Educación nutricional general"],
};

export const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const DAYS_FULL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/**
 * Estado de inasistencia. Vive aquí porque se compara en cinco pantallas y una
 * errata (un acento de menos) no da error de compilación: simplemente deja de
 * coincidir y la cita desaparece de los listados sin que nadie se entere.
 * Debe coincidir con la constante MISSED del servidor (routes/appointments.ts).
 */
export const MISSED_STATUS = "No asistió";

export const STATUS_BADGE_CONFIG: Record<string, { cls: string }> = {
  Pendiente: { cls: "bg-[#fef3c7] text-[#d97706]" },
  Confirmada: { cls: "bg-[#dbeafe] text-[#2563EB]" },
  Completada: { cls: "bg-[#dcfce7] text-[#16A34A]" },
  Cancelada: { cls: "bg-[#fef2f2] text-[#dc2626]" },
};

// La lista de carreras vivía aquí fija a TECNL. Ya no se usa: cada organización
// define sus campos de registro (RegistrationField) y el formulario los pinta
// dinámicamente. El seed conserva su propia copia para poblar los de TECNL.
