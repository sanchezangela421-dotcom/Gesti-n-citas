// ─── useAppointmentWizard ────────────────────────────────
// Encapsula todo el estado del wizard de nueva cita del alumno

import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "../../context/StoreContext";
import { useAuth } from "../../context/AuthContext";
import { localISODate } from "../../utils/date";
import type { AvailableSlot } from "../../types";

export function useAppointmentWizard() {
    const { user } = useAuth();
    const { createAppointment, getSpecialists, getAvailableSlots, getAvailableDays } = useStore();

    const [show, setShow] = useState(false);
    const [step, setStep] = useState(1);
    const [selDept, setSelDept] = useState<string | null>(null);
    const [selSpecId, setSelSpecId] = useState<string | null>(null);
    const [selDate, setSelDate] = useState<Date | null>(null);
    const [selSlot, setSelSlot] = useState<string | null>(null);
    const [selReason, setSelReason] = useState("");
    const [selModality, setSelModality] = useState("Presencial");
    const [confidentialityAccepted, setConfidentialityAccepted] = useState(false);
    const [availDates, setAvailDates] = useState<Date[]>([]);
    const [slotsForDate, setSlotsForDate] = useState<AvailableSlot[]>([]);
    const loadedMonths = useRef<Set<string>>(new Set());

    const reset = () => {
        setStep(1); setSelDept(null); setSelSpecId(null); setSelDate(null);
        setSelSlot(null); setSelReason(""); setSelModality("Presencial");
        setConfidentialityAccepted(false);
    };

    useEffect(() => {
        if (!selSpecId) { setAvailDates([]); loadedMonths.current.clear(); return; }
        loadedMonths.current.clear();
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth();
        // getAvailableDays fetches 2 consecutive months — pre-mark both as loaded
        loadedMonths.current.add(`${y}-${m}`);
        loadedMonths.current.add(`${m === 11 ? y + 1 : y}-${m === 11 ? 0 : m + 1}`);
        getAvailableDays(selSpecId, y, m).then(setAvailDates);
    }, [selSpecId]);

    const handleMonthChange = useCallback(async (year: number, month: number) => {
        if (!selSpecId) return;
        const key = `${year}-${month}`;
        if (loadedMonths.current.has(key)) return;
        // Mark this and next month to avoid duplicate fetches
        loadedMonths.current.add(key);
        loadedMonths.current.add(`${month === 11 ? year + 1 : year}-${month === 11 ? 0 : month + 1}`);
        const newDates = await getAvailableDays(selSpecId, year, month);
        setAvailDates(prev => {
            const seen = new Set<string>();
            return [...prev, ...newDates].filter(d => {
                const k = localISODate(d);
                return seen.has(k) ? false : (seen.add(k), true);
            });
        });
    }, [selSpecId, getAvailableDays]);

    useEffect(() => {
        if (!selDate || !selSpecId) { setSlotsForDate([]); return; }
        getAvailableSlots(selSpecId, localISODate(selDate)).then(setSlotsForDate);
    }, [selDate, selSpecId]);

    const confirm = () => {
        createAppointment({
            studentId: user!.id,
            studentName: user!.name,
            specialistId: selSpecId!,
            department: selDept!,
            motivo: selReason,
            modality: selModality,
            preferredDate: localISODate(selDate!),
            preferredTime: selSlot!,
        });
        setStep(4);
    };

    const deptSpecialists = selDept ? getSpecialists(selDept) : [];
    const selSpec = deptSpecialists.find(s => s.id === selSpecId);

    return {
        show, setShow, step, setStep,
        selDept, setSelDept, selSpecId, setSelSpecId,
        selDate, setSelDate, selSlot, setSelSlot,
        selReason, setSelReason, selModality, setSelModality,
        confidentialityAccepted, setConfidentialityAccepted,
        availDates, slotsForDate,
        deptSpecialists, selSpec,
        reset, confirm, handleMonthChange,
    };
}

// ─── useReschedule ───────────────────────────────────────
// Encapsula el estado del modal de reagendamiento (alumno y especialista)

export function useReschedule(role: "student" | "specialist") {
    const { rescheduleAppointment, getAvailableDays, getAvailableSlots, getAppointments } = useStore();
    const { user } = useAuth();

    const [show, setShow] = useState(false);
    const [apptId, setApptId] = useState<string | null>(null);
    const [date, setDate] = useState<Date | null>(null);
    const [slot, setSlot] = useState<string | null>(null);
    const [availDates, setAvailDates] = useState<Date[]>([]);
    const [slots, setSlots] = useState<AvailableSlot[]>([]);
    const [selModality, setSelModality] = useState("Presencial");
    const loadedMonths = useRef<Set<string>>(new Set());

    const appointments = getAppointments(
        role === "student" ? { studentId: user?.id } : { specialistId: user?.id }
    );

    useEffect(() => {
        if (!apptId) { setAvailDates([]); loadedMonths.current.clear(); return; }
        const appt = appointments.find(a => a.id === apptId);
        if (!appt) return;
        loadedMonths.current.clear();
        const now = new Date();
        const y = now.getFullYear(), m = now.getMonth();
        loadedMonths.current.add(`${y}-${m}`);
        loadedMonths.current.add(`${m === 11 ? y + 1 : y}-${m === 11 ? 0 : m + 1}`);
        getAvailableDays(appt.specialistId, y, m).then(setAvailDates);
    }, [apptId]);

    const handleMonthChange = useCallback(async (year: number, month: number) => {
        if (!apptId) return;
        const key = `${year}-${month}`;
        if (loadedMonths.current.has(key)) return;
        loadedMonths.current.add(key);
        loadedMonths.current.add(`${month === 11 ? year + 1 : year}-${month === 11 ? 0 : month + 1}`);
        const appt = appointments.find(a => a.id === apptId);
        if (!appt) return;
        const newDates = await getAvailableDays(appt.specialistId, year, month);
        setAvailDates(prev => {
            const seen = new Set<string>();
            return [...prev, ...newDates].filter(d => {
                const k = localISODate(d);
                return seen.has(k) ? false : (seen.add(k), true);
            });
        });
    }, [apptId, appointments, getAvailableDays]);

    useEffect(() => {
        if (!date || !apptId) { setSlots([]); return; }
        const appt = appointments.find(a => a.id === apptId);
        if (!appt) return;
        getAvailableSlots(appt.specialistId, localISODate(date)).then(setSlots);
    }, [date, apptId]);

    const open = (id: string) => {
        setApptId(id); setDate(null); setSlot(null); setShow(true);
    };

    const confirm = () => {
        if (!apptId || !date || !slot) return;
        rescheduleAppointment(apptId, localISODate(date), slot, role, selModality);
        setShow(false); setApptId(null); setDate(null); setSlot(null);
    };

    return {
        show, setShow, apptId, date, setDate, slot, setSlot,
        availDates, slots, selModality, setSelModality,
        open, confirm, handleMonthChange,
    };
}

// ─── useCancelAppointment ────────────────────────────────
// Encapsula la lógica del modal de cancelación del alumno

export function useCancelAppointment() {
    const { updateAppointmentStatus } = useStore();

    const [show, setShow] = useState(false);
    const [apptId, setApptId] = useState<string | null>(null);
    const [reason, setReason] = useState("");

    const open = (id: string) => { setApptId(id); setReason(""); setShow(true); };
    const close = () => setShow(false);

    const confirm = () => {
        if (!apptId) return;
        updateAppointmentStatus(apptId, "Cancelada", reason, true);
        setShow(false); setApptId(null); setReason("");
    };

    return { show, open, close, apptId, reason, setReason, confirm };
}

// ─── useActionModal ──────────────────────────────────────
// Modal genérico de cambio de estado (especialista / admin)

import type { Appointment } from "../../types";

export function useActionModal() {
    const { updateAppointmentStatus } = useStore();

    const [appt, setAppt] = useState<Appointment | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [notes, setNotes] = useState("");

    const open = (a: Appointment, s: string) => { setAppt(a); setStatus(s); setNotes(""); };
    const close = () => { setAppt(null); setStatus(null); };

    const confirm = (notifyStudent = false) => {
        if (!appt || !status) return;
        updateAppointmentStatus(appt.id, status, notes || undefined, notifyStudent);
        close();
    };

    return { appt, status, notes, setNotes, open, close, confirm };
}
