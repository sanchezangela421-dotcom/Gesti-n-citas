import React from 'react';
import { Brain, GraduationCap, Apple } from "lucide-react";

/**
 * Catálogo de departamentos de la plataforma. Es FIJO por decisión de producto:
 * son el servicio que ofrece Synkros, no algo que cada organización define.
 *
 * Lo que sí varía es cuáles tiene contratados cada organización
 * (`Organization.departments`). Para pintar selectores usa `useDepartments()`,
 * que devuelve solo los contratados; esta lista es el universo posible.
 */
export const ALL_DEPARTMENTS = ["Psicología", "Tutorías", "Nutrición"] as const;

export const DEPT_CONFIG: Record<string, { color: string; bg: string; border: string; icon: React.ComponentType<any> }> = {
  "Psicología": { color: "#2563EB", bg: "bg-[#dbeafe]", border: "border-[#93c5fd]", icon: Brain },
  "Tutorías": { color: "#16A34A", bg: "bg-[#dcfce7]", border: "border-[#86efac]", icon: GraduationCap },
  "Nutrición": { color: "#EA580C", bg: "bg-[#fff7ed]", border: "border-[#fdba74]", icon: Apple },
};

export const DEPT_REASONS: Record<string, string[]> = {
  "Psicología": ["Situaciones académicas", "Situaciones emocionales", "Situaciones de salud física o mental", "No estoy seguro del porqué", "Lo sugirió mi maestro o tutor", "Problemas económicos"],
  "Tutorías": ["Dificultades en materias específicas", "Orientación vocacional y profesional", "Técnicas y hábitos de estudio", "Planeación académica del semestre", "Asesoría para servicio social o residencias", "Bajo rendimiento académico"],
  "Nutrición": ["Valoración nutricional inicial", "Plan de alimentación personalizado", "Trastornos de la conducta alimentaria", "Control de peso", "Alimentación deportiva", "Educación nutricional general"],
};

export const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const DAYS_FULL = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export const STATUS_BADGE_CONFIG: Record<string, { cls: string }> = {
  Pendiente: { cls: "bg-[#fef3c7] text-[#d97706]" },
  Confirmada: { cls: "bg-[#dbeafe] text-[#2563EB]" },
  Completada: { cls: "bg-[#dcfce7] text-[#16A34A]" },
  Cancelada: { cls: "bg-[#fef2f2] text-[#dc2626]" },
};

// La lista de carreras vivía aquí fija a TECNL. Ya no se usa: cada organización
// define sus campos de registro (RegistrationField) y el formulario los pinta
// dinámicamente. El seed conserva su propia copia para poblar los de TECNL.
