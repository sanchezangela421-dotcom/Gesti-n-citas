export interface AvailableSlot {
  start: string;
  end: string;
}

export interface ScheduleSlot {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  available: boolean;
  week?: number; // 0: current, 1: next, undefined: both
  specificDate?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  type: string;
  userRoleLabel?: string;
  logoUrl?: string | null;
}

export interface User {
  id: string;
  email: string;
  password?: string;
  name: string;
  role: string;
  matricula?: string;
  carrera?: string;
  semestre?: number;
  fechaNacimiento?: string;
  genero?: string;
  department?: string;
  avatarUrl?: string | null;
  organizationId?: string | null;
  organization?: Organization | null;
  metadata?: Record<string, string> | null;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  organizationId?: string;
  metadata?: Record<string, string>;
  // Legacy — solo TECNL los usa, se populan desde metadata
  carrera?: string;
  semestre?: number;
  fechaNacimiento?: string;
  matricula?: string;
  genero?: string;
}

export interface Specialist {
  id: string;
  userId: string;
  name: string;
  department: string;
  email: string;
  active: boolean;
  shift?: string;
  meetingUrl?: string | null;
  schedule: ScheduleSlot[];
  avatarUrl?: string | null;
}

export interface Appointment {
  id: string;
  studentId: string;
  studentName: string;
  specialistId: string;
  specialistName: string;
  department: string;
  date: string;
  time: string;
  status: string;
  modality: string;
  motivo: string;
  cancellationReason?: string | null; // motivo de cancelación (no confidencial)
  meetingUrl?: string | null;
  isFollowUp?: boolean;
  parentId?: string | null;
  periodId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

// ── Expediente clínico ───────────────────────────────────
export interface PatientSummary {
  studentId: string;
  studentName: string;
  lastSession: string;
  total: number;
}

export interface RecordNote {
  id: string;
  body: string;
  authoredByMe: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecordSession {
  id: string;
  date: string;
  time: string;
  status: string;
  modality: string;
  motivo: string;
  specialistId: string;
  specialistName: string;
  isFollowUp?: boolean;
  parentId?: string | null;
  note: RecordNote | null;
}

export interface PatientRecord {
  studentId: string;
  department: string;
  timeline: RecordSession[];
}

export interface ReportPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  status: "activo" | "cerrado";
  closedAt: string | null;
  createdAt: string;
  _count?: { appointments: number };
}

export interface AppEvent {
  id: string;
  title: string;
  description: string;
  department: string;
  date: string;
  time: string;
  type: string;
  imageUrl?: string;
  registrationUrl?: string;
}

export interface Resource {
  id: string;
  department: string;
  type: string;
  title: string;
  description: string;
  url: string;
  imageUrl?: string;
  fileUrl?: string;
  fileName?: string;
}

/** Datos para crear o actualizar un especialista. */
export interface SpecialistInput {
  name: string;
  department: string;
  email: string;
  active?: boolean;
  shift?: string;
  meetingUrl?: string | null;
  // Campos del usuario asociado (solo en creación)
  password?: string;
  role?: string;
}

export interface AppointmentFilters {
  studentId?: string;
  specialistId?: string;
  department?: string;
  status?: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  type: string;
}

export interface StoreContextType {
  users: User[];
  specialistsLoaded: boolean;
  getUserById: (id: string) => User | null;
  specialists: Specialist[];
  getSpecialists: (dept?: string) => Specialist[];
  getSpecialistById: (id: string) => Specialist | null;
  addSpecialist: (data: SpecialistInput) => Promise<void>;
  updateSpecialist: (id: string, data: Partial<SpecialistInput>) => Promise<void>;
  removeSpecialist: (id: string) => Promise<void>;
  appointments: Appointment[];
  getAppointments: (filters?: AppointmentFilters) => Appointment[];
  createAppointment: (req: { studentId: string; studentName?: string; specialistId: string; department: string; motivo: string; modality: string; preferredDate: string; preferredTime: string; isFollowUp?: boolean; parentId?: string }) => Promise<boolean>;
  updateAppointmentStatus: (id: string, status: string, notes?: string, byStudent?: boolean, meetingUrl?: string) => void;
  rescheduleAppointment: (id: string, newDate: string, newTime: string, byRole?: 'specialist' | 'student', modality?: string) => void;
  getAvailableSlots: (specialistId: string, dateStr: string) => Promise<AvailableSlot[]>;
  getAvailableDays: (specialistId: string, year: number, month: number) => Promise<Date[]>;
  addScheduleSlot: (specialistId: string, slot: Omit<ScheduleSlot, "id">) => void;
  removeScheduleSlot: (specialistId: string, slotId: string) => void;
  updateMeetingUrl: (specialistId: string, meetingUrl: string | null) => Promise<void>;
  events: AppEvent[];
  addEvent: (ev: Omit<AppEvent, "id">, file?: File) => Promise<void>;
  updateEvent: (id: string, data: Partial<Omit<AppEvent, "id">>, file?: File) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  resources: Resource[];
  addResource: (r: Omit<Resource, "id">, file?: File) => Promise<void>;
  updateResource: (id: string, data: Partial<Omit<Resource, "id">>, file?: File) => Promise<void>;
  deleteResource: (id: string) => Promise<void>;
  getStats: () => {
    summary: { total: number; pendientes: number; confirmadas: number; completadas: number; canceladas: number; byDept: Record<string, number> };
    charts: {
      monthly: any[];
      motivos: any[];
      modalidad: any[];
      carrera: any[];
    }
  };
  activePeriod: ReportPeriod | null;
  notifications: Record<string, AppNotification[]>;
  addNotification: (userId: string, notif: Omit<AppNotification, "id" | "time" | "read">) => void;
  markNotificationsRead: (userId: string) => void;
  deleteNotification: (userId: string, notifId: string) => void;
  clearAllNotifications: (userId: string) => void;
  deleteUser: (id: string) => Promise<void>;
  fetchAll: () => Promise<void>;
  isOnline: boolean;
}

export interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; unverified?: boolean; error?: string }>;
  register: (data: RegisterPayload) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}
