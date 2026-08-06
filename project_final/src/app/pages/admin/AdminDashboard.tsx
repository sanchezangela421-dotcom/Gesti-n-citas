import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
    CalendarCheck, Clock, CheckCircle2, Users, TrendingUp,
    BarChart3, Plus, Pencil, XCircle, Search, Download,
    Clock3, FileText, Megaphone, Brain, GraduationCap, Apple,
    CalendarDays, Trash2,
    Scissors, ChevronDown, MapPin,
} from "lucide-react";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell,
} from "recharts";
import type { DateRange } from "react-day-picker";
import { es } from "date-fns/locale";
import { useStore } from "../../../context/StoreContext";
import { useAuth } from "../../../context/AuthContext";
import { AppShell } from "../../components/layout/AppShell";
import { Btn, StatCard, Avatar, StatusBadge, Modal, inputCls, EmptyState, Reveal } from "../../components/ui";
import { Calendar } from "../../components/ui/calendar";
import { DEPT_CONFIG, ALL_DEPARTMENTS } from "../../../constants";
import { useDepartments } from "../../hooks/useDepartments";

// Presentación de las tarjetas de descarga de reporte, por departamento del
// catálogo. Cuáles se muestran lo decide la lista de contratados.
/** Campo de registro de la organización que sirve para agrupar estadísticas. */
interface GroupableField { key: string; label: string }

/**
 * Claves con gráfica propia hecha a mano, que por eso NO se grafican de forma
 * genérica: duplicarían la que ya existe. Semestre y edad además necesitan un
 * tratamiento que el mecanismo genérico no da (orden numérico y rangos etarios).
 */
const FIELDS_WITH_OWN_CHART = new Set(['carrera', 'genero', 'semestre', 'fechaNacimiento']);

/**
 * Distribución de citas por el valor de un campo de registro de la organización.
 *
 * Sustituye a las gráficas fijas por carrera o género: cada organización define
 * sus propios campos y aquí se agrupa por lo que haya definido. Solo tiene
 * sentido con campos de conjunto cerrado (select y radio); agrupar por un texto
 * libre daría una barra por respuesta.
 *
 * Devuelve null si NADIE tiene valor: la gráfica solo diría "No especificado"
 * para todos, y mostrar eso es peor que no mostrar nada — parece un dato real.
 */
function distributionByField(
    appts: Appointment[],
    usersById: Map<string, { metadata?: Record<string, string> | null }>,
    field: GroupableField,
): { key: string; label: string; data: { name: string; value: number }[] } | null {
    const counts: Record<string, number> = {};
    let withValue = 0;

    for (const a of appts) {
        const raw = usersById.get(a.studentId)?.metadata?.[field.key];
        const value = typeof raw === "string" ? raw.trim() : "";
        if (value) withValue++;
        const name = value || "No especificado";
        counts[name] = (counts[name] || 0) + 1;
    }

    if (withValue === 0) return null;

    return {
        key: field.key,
        label: field.label,
        data: Object.entries(counts)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8),
    };
}

/** true si la gráfica tiene algún dato real y no solo "no especificado"/ceros. */
function hasRealData(rows: { name: string; value: number }[] | undefined): boolean {
    if (!rows?.length) return false;
    return rows.some(r => r.value > 0 && !/^no esp/i.test(r.name));
}

const REPORT_CARD_STYLE: Record<string, { icon: typeof Brain; gradient: string }> = {
    "Psicología": { icon: Brain, gradient: "from-blue-500 to-indigo-600" },
    "Tutorías": { icon: GraduationCap, gradient: "from-emerald-500 to-teal-600" },
    "Nutrición": { icon: Apple, gradient: "from-rose-500 to-orange-500" },
};
import { PIE_COLORS } from "../../../data/mockData";
import { useActionModal } from "../../hooks";
import { useTheme } from "../../hooks/useTheme";
import { API, API_BASE, authHeaders } from "../../../lib/api";
import { calcularEdad } from "../../../utils/date";
import { AdminContentTab } from "./AdminContentTab";
import { AdminEventsTab } from "./AdminEventsTab";
import type { Appointment, Specialist, OrgLocation, User } from "../../../types";

// ─── ReportPeriod type ────────────────────────────────────────────────────────
interface ReportPeriod {
    id: string;
    name: string;
    startDate: string;
    endDate: string | null;
    status: "activo" | "cerrado";
    closedAt: string | null;
    createdAt: string;
    _count?: { appointments: number };
}

// ─── Download chart as styled card image ─────────────────────────────────────
interface LegendItem { label: string; color: string; percent?: number; }

async function downloadChartAsImage(
    ref: React.RefObject<HTMLDivElement | null>,
    filename: string,
    chartTitle: string,
    isDark: boolean,
    legend?: LegendItem[]
) {
    if (!ref.current) { toast.error("No hay datos para esta gráfica"); return; }
    const svgEl = ref.current.querySelector("svg");
    if (!svgEl) { toast.error("No se encontró la gráfica"); return; }

    try {
        const clone = svgEl.cloneNode(true) as SVGElement;
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.querySelectorAll("*").forEach(el => {
            ["fill", "stroke", "color"].forEach(attr => {
                const val = (el as HTMLElement).getAttribute(attr);
                if (val?.includes("oklch")) (el as HTMLElement).setAttribute(attr, "#64748b");
            });
        });

        const serializer = new XMLSerializer();
        const svgStr = serializer.serializeToString(clone);
        const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const img = new Image();
        img.onload = () => {
            const scale = 2;
            const pad = 32;
            const titleH = 52;
            const footerH = 36;
            const chartW = svgEl.clientWidth;
            const chartH = svgEl.clientHeight;

            // Legend panel — measure actual label widths so nothing gets truncated
            const legendGap = 24;
            const sans = `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
            let legendW = 0;
            if (legend && legend.length > 0) {
                const tmp = document.createElement("canvas").getContext("2d")!;
                tmp.font = `500 12px ${sans}`;
                const maxLabelPx = Math.max(...legend.map(l => tmp.measureText(l.label).width));
                const percentW = legend.some(l => l.percent !== undefined) ? 52 : 0;
                legendW = Math.ceil(maxLabelPx) + 20 + 8 + percentW + 8; // swatch+gap+label+gap+percent
            }
            const totalW = chartW + pad * 2 + (legendW > 0 ? legendGap + legendW : 0);
            const totalH = chartH + pad * 2 + titleH + footerH;

            const canvas = document.createElement("canvas");
            canvas.width = totalW * scale;
            canvas.height = totalH * scale;
            const ctx = canvas.getContext("2d")!;
            ctx.scale(scale, scale);

            // ── Helpers ──
            const bg       = isDark ? "#1e293b" : "#ffffff";
            const borderC  = isDark ? "#334155" : "#e2e8f0";
            const titleCol = isDark ? "#f1f5f9" : "#0f172a";
            const subCol   = isDark ? "#94a3b8" : "#64748b";
            const divCol   = isDark ? "#334155" : "#f1f5f9";
            const footCol  = isDark ? "#475569" : "#94a3b8";

            // ── Rounded card background ──
            const r = 20;
            ctx.beginPath();
            ctx.moveTo(r, 0); ctx.lineTo(totalW - r, 0);
            ctx.quadraticCurveTo(totalW, 0, totalW, r);
            ctx.lineTo(totalW, totalH - r);
            ctx.quadraticCurveTo(totalW, totalH, totalW - r, totalH);
            ctx.lineTo(r, totalH);
            ctx.quadraticCurveTo(0, totalH, 0, totalH - r);
            ctx.lineTo(0, r);
            ctx.quadraticCurveTo(0, 0, r, 0);
            ctx.closePath();
            ctx.fillStyle = bg; ctx.fill();
            ctx.strokeStyle = borderC; ctx.lineWidth = 1; ctx.stroke();

            // ── Title ──
            ctx.fillStyle = titleCol;
            ctx.font = `bold 17px ${sans}`;
            ctx.fillText(chartTitle, pad, pad + 22);

            // ── Divider ──
            ctx.strokeStyle = divCol; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pad, pad + titleH - 8);
            ctx.lineTo(totalW - pad, pad + titleH - 8);
            ctx.stroke();

            // ── Chart SVG ──
            ctx.drawImage(img, pad, pad + titleH);
            URL.revokeObjectURL(url);

            // ── Right-side legend ──
            if (legend && legend.length > 0) {
                const lx = pad + chartW + legendGap;
                const itemH = 28;
                const totalItemsH = legend.length * itemH;
                const ly = pad + titleH + (chartH - totalItemsH) / 2;

                // Vertical separator
                ctx.strokeStyle = divCol; ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(lx - 12, pad + titleH + 8);
                ctx.lineTo(lx - 12, pad + titleH + chartH - 8);
                ctx.stroke();

                legend.forEach((item, i) => {
                    const y = ly + i * itemH;
                    // Color swatch
                    ctx.fillStyle = item.color;
                    ctx.beginPath();
                    ctx.roundRect(lx, y, 13, 13, 3);
                    ctx.fill();

                    // Full label (no truncation — canvas was sized to fit)
                    ctx.font = `500 12px ${sans}`;
                    ctx.fillStyle = titleCol;
                    ctx.fillText(item.label, lx + 20, y + 11);

                    // Percentage (right-aligned to legend panel edge)
                    if (item.percent !== undefined) {
                        ctx.font = `bold 12px ${sans}`;
                        ctx.fillStyle = subCol;
                        ctx.textAlign = "right";
                        ctx.fillText(`${item.percent.toFixed(1)}%`, lx + legendW, y + 11);
                        ctx.textAlign = "left";
                    }
                });
            }

            // ── Footer watermark ──
            ctx.fillStyle = footCol;
            ctx.font = `500 11px ${sans}`;
            ctx.fillText("Sistema de Citas TECNL", pad, totalH - 12);
            const dateStr = new Date().toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
            ctx.textAlign = "right";
            ctx.fillText(dateStr, totalW - pad, totalH - 12);
            ctx.textAlign = "left";

            const link = document.createElement("a");
            link.download = `${filename.replace(/\s+/g, "_").toLowerCase()}.png`;
            link.href = canvas.toDataURL("image/png");
            link.click();
            toast.success("Gráfica descargada");
        };
        img.onerror = () => { URL.revokeObjectURL(url); toast.error("Error al exportar la gráfica"); };
        img.src = url;
    } catch {
        toast.error("Error al exportar la gráfica");
    }
}

// ─── Age ranges (shared between PDF and charts) ───────────────────────────────
const AGE_RANGES = [
    { label: "15–17", min: 15, max: 17 },
    { label: "18–20", min: 18, max: 20 },
    { label: "21–23", min: 21, max: 23 },
    { label: "24–26", min: 24, max: 26 },
    { label: "27+",   min: 27, max: 99 },
];

// ─── PDF report (pure jsPDF + autoTable, no canvas capture) ──────────────────
async function generatePDFReport(deptReport: string, allAppts: Appointment[], users: { id: string; carrera?: string; genero?: string; semestre?: number; fechaNacimiento?: string }[], periodName?: string, isSchool?: boolean, userRoleLabel?: string, departments: string[] = [...ALL_DEPARTMENTS]) {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import("jspdf"),
        import("jspdf-autotable"),
    ]);
    const doc = new jsPDF();
    const today = new Date().toLocaleDateString("es-MX");

    const drawHeader = (title: string) => {
        doc.setFontSize(22); doc.setTextColor(30, 41, 59);
        doc.text("Synkros", 105, 15, { align: "center" });
        doc.setFontSize(14);
        doc.text(title, 105, 23, { align: "center" });
        doc.setFontSize(10); doc.setTextColor(100, 116, 139);
        doc.text(`Fecha de generación: ${today}`, 105, 29, { align: "center" });
        if (periodName) {
            doc.setFontSize(9); doc.setTextColor(71, 85, 105);
            doc.text(`Período: ${periodName}`, 105, 34, { align: "center" });
        }
        doc.setDrawColor(226, 232, 240);
        doc.line(20, periodName ? 38 : 35, 190, periodName ? 38 : 35);
    };

    const getDeptStats = (list: Appointment[]) => {
        const motivosMap: Record<string, number> = {};
        const modalidadMap: Record<string, number> = { Presencial: 0, Virtual: 0 };
        const carreraMap: Record<string, number> = {};
        const generoMap: Record<string, number> = {};
        const semestreMap: Record<string, number> = {};
        const edadMap: Record<string, number> = {};
        list.forEach(a => {
            const m = a.motivo || "Consulta General";
            motivosMap[m] = (motivosMap[m] || 0) + 1;
            if (a.modality === "Virtual") modalidadMap.Virtual++; else modalidadMap.Presencial++;
            const student = users.find(u => u.id === a.studentId);
            const c = student?.carrera || "No especificada";
            carreraMap[c] = (carreraMap[c] || 0) + 1;
            const g = student?.genero || "No especificado";
            generoMap[g] = (generoMap[g] || 0) + 1;
            const s = student?.semestre ? `Sem. ${student.semestre}` : "No esp.";
            semestreMap[s] = (semestreMap[s] || 0) + 1;
            if (student?.fechaNacimiento) {
                const edad = calcularEdad(student.fechaNacimiento);
                const rango = AGE_RANGES.find(r => edad >= r.min && edad <= r.max)?.label ?? "Otro";
                edadMap[rango] = (edadMap[rango] || 0) + 1;
            }
        });
        return {
            total: list.length,
            confirmadas: list.filter(a => a.status === "Confirmada").length,
            completadas: list.filter(a => a.status === "Completada").length,
            pendientes: list.filter(a => a.status === "Pendiente").length,
            canceladas: list.filter(a => a.status === "Cancelada").length,
            seguimientos: list.filter(a => a.isFollowUp).length,
            topMotivos: Object.entries(motivosMap).sort(([, a], [, b]) => b - a).slice(0, 5),
            modalidad: Object.entries(modalidadMap),
            topCarreras: Object.entries(carreraMap).sort(([, a], [, b]) => b - a).slice(0, 6),
            genero: Object.entries(generoMap).sort(([, a], [, b]) => b - a),
            semestre: Object.entries(semestreMap).sort(([a], [b]) => {
                const na = parseInt(a.replace("Sem. ", "")) || 99;
                const nb = parseInt(b.replace("Sem. ", "")) || 99;
                return na - nb;
            }),
            edad: AGE_RANGES
                .map(r => [r.label, edadMap[r.label] ?? 0] as [string, number])
                .filter(([, v]) => v > 0),
        };
    };

    const headerBottomY = periodName ? 44 : 41;

    const addStatsPage = (dept: string, list: Appointment[], isFirst: boolean, pageTitle?: string) => {
        if (!isFirst) doc.addPage();
        drawHeader(pageTitle ?? `Reporte de Atención — ${dept}`);
        const stats = getDeptStats(list);

        doc.setFontSize(12); doc.setTextColor(30, 41, 59);
        doc.text("Resumen de Actividad", 20, headerBottomY);
        autoTable(doc, {
            startY: headerBottomY + 5,
            head: [["Métrica", "Cantidad"]],
            body: [
                ["Total de Citas", stats.total],
                ["Confirmadas", stats.confirmadas],
                ["Completadas", stats.completadas],
                ["Pendientes", stats.pendientes],
                ["Canceladas", stats.canceladas],
                ["De las cuales, seguimientos", stats.seguimientos],
            ],
            theme: "grid",
            headStyles: { fillColor: [59, 130, 246] },
            margin: { left: 20, right: 20 },
        });

        const currentY = (doc as any).lastAutoTable.finalY + 12;
        doc.text("Distribución de Motivos y Modalidad", 20, currentY);

        autoTable(doc, {
            startY: currentY + 5,
            head: [["Motivos más frecuentes", "Citas"]],
            body: stats.topMotivos,
            theme: "striped",
            headStyles: { fillColor: [71, 85, 105] },
            margin: { left: 20, right: 105 },
        });
        const motivosEndY = (doc as any).lastAutoTable.finalY;

        autoTable(doc, {
            startY: currentY + 5,
            head: [["Modalidad", "Citas"]],
            body: stats.modalidad,
            theme: "striped",
            headStyles: { fillColor: [71, 85, 105] },
            margin: { left: 110, right: 20 },
        });
        const modalidadEndY = (doc as any).lastAutoTable.finalY;

        const demoY = Math.max(motivosEndY, modalidadEndY) + 12;
        doc.setFontSize(12); doc.setTextColor(30, 41, 59);
        const demoLabel = `${userRoleLabel ?? "Usuario"}s`;
        doc.text(`Perfil Demográfico de ${demoLabel} Atendidos`, 20, demoY);

        let finalNoteY: number;
        if (isSchool !== false) {
            autoTable(doc, {
                startY: demoY + 5,
                head: [["Carrera", "Citas"]],
                body: stats.topCarreras,
                theme: "striped",
                headStyles: { fillColor: [109, 40, 217] },
                margin: { left: 20, right: 105 },
            });
            const carreraEndY = (doc as any).lastAutoTable.finalY;

            autoTable(doc, {
                startY: demoY + 5,
                head: [["Género", "Citas"]],
                body: stats.genero,
                theme: "striped",
                headStyles: { fillColor: [109, 40, 217] },
                margin: { left: 110, right: 20 },
            });
            const generoEndY = (doc as any).lastAutoTable.finalY;

            const semY = Math.max(carreraEndY, generoEndY) + 10;
            autoTable(doc, {
                startY: semY,
                head: [["Semestre", "Citas"]],
                body: stats.semestre,
                theme: "striped",
                headStyles: { fillColor: [109, 40, 217] },
                margin: { left: 20, right: 105 },
            });
            const semestreEndY = (doc as any).lastAutoTable.finalY;

            autoTable(doc, {
                startY: semY,
                head: [["Edad", "Citas"]],
                body: stats.edad.length > 0 ? stats.edad : [["Sin datos", "—"]],
                theme: "striped",
                headStyles: { fillColor: [109, 40, 217] },
                margin: { left: 110, right: 20 },
            });
            finalNoteY = Math.max(semestreEndY, (doc as any).lastAutoTable.finalY);
        } else {
            autoTable(doc, {
                startY: demoY + 5,
                head: [["Género", "Citas"]],
                body: stats.genero,
                theme: "striped",
                headStyles: { fillColor: [109, 40, 217] },
                margin: { left: 20, right: 105 },
            });
            const generoEndY = (doc as any).lastAutoTable.finalY;

            autoTable(doc, {
                startY: demoY + 5,
                head: [["Edad", "Citas"]],
                body: stats.edad.length > 0 ? stats.edad : [["Sin datos", "—"]],
                theme: "striped",
                headStyles: { fillColor: [109, 40, 217] },
                margin: { left: 110, right: 20 },
            });
            finalNoteY = Math.max(generoEndY, (doc as any).lastAutoTable.finalY);
        }

        doc.setFontSize(10); doc.setTextColor(100, 116, 139);
        doc.text(
            "* Las gráficas están disponibles para descarga en la sección de Estadísticas.",
            20, finalNoteY + 12
        );
    };

    if (deptReport === "Reporte Global") {
        const depts = departments;
        depts.forEach((dept, i) => {
            addStatsPage(dept, allAppts.filter(a => a.department === dept), i === 0);
        });

        // Global summary page
        doc.addPage();
        drawHeader("Resumen Institucional Consolidado");
        doc.setFontSize(12); doc.setTextColor(30, 41, 59);
        doc.text("Estadísticas Globales Comparativas", 20, 45);
        autoTable(doc, {
            startY: 50,
            head: [["Departamento", "Total Citas", "Completadas", "Pendientes"]],
            body: depts.map(d => {
                const dl = allAppts.filter(a => a.department === d);
                return [d, dl.length, dl.filter(a => a.status === "Completada").length, dl.filter(a => a.status === "Pendiente").length];
            }),
            theme: "grid",
            headStyles: { fillColor: [30, 41, 59] },
            margin: { left: 20, right: 20 },
        });
    } else {
        addStatsPage(
            deptReport,
            allAppts.filter(a => a.department === deptReport),
            true,
            `Informe de Atención — ${deptReport}`
        );
    }

    // Detailed breakdown (last page)
    doc.addPage();
    doc.setFontSize(12); doc.setTextColor(30, 41, 59);
    doc.text("Desglose Detallado de Citas", 20, 15);
    const finalList = deptReport === "Reporte Global" ? allAppts : allAppts.filter(a => a.department === deptReport);
    autoTable(doc, {
        startY: 20,
        head: [["Departamento", "Especialista", "Fecha", "Hora", "Estado", "Motivo", "Modalidad"]],
        body: finalList.slice(0, 100).map(a => [
            a.department,
            a.specialistName,
            new Date(a.date + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }),
            a.time,
            a.status,
            a.motivo || "—",
            a.modality || "—",
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 41, 59], fontSize: 8 },
        margin: { left: 10, right: 10 },
        columnStyles: {
            1: { cellWidth: 35 },
            5: { cellWidth: 45 },
        },
    });
    if (finalList.length > 100) {
        doc.setFontSize(8);
        doc.text(`* Mostrando los primeros 100 registros de ${finalList.length} totales.`, 20, (doc as any).lastAutoTable.finalY + 10);
    }

    const suffix = periodName
        ? periodName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]/g, "")
        : new Date().toLocaleDateString("es-MX").replace(/\//g, "-");
    doc.save(`reporte_${deptReport.replace(/\s+/g, "_").toLowerCase()}_${suffix}.pdf`);
    toast.success("Reporte generado con éxito.");
}

// ─── Component ───────────────────────────────────────────
export function AdminDashboard() {
    const { dark } = useTheme();
    const { user: authUser } = useAuth();
    // Solo los departamentos que la organización tiene contratados
    const departments = useDepartments();
    const tooltipStyle = dark
        ? { borderRadius: "12px", border: "1px solid #334155", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.4)", backgroundColor: "#1e293b", color: "#f1f5f9" }
        : { borderRadius: "12px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" };
    const cursorStyle = dark ? { fill: "rgba(255,255,255,0.04)" } : { fill: "#f8fafc" };

    const {
        getAppointments, getStats, activePeriod: storeActivePeriod,
        specialists, addSpecialist, updateSpecialist, removeSpecialist,
        users, deleteUser,
    } = useStore();

    const [activeTab, setActiveTab] = useState("citas");
    const [deptFilter, setDeptFilter] = useState("Todos");
    const [statusFilter, setStatusFilter] = useState("Todos");
    const [searchTerm, setSearchTerm] = useState("");
    const [statsView, setStatsView] = useState("Global");

    // Paginación
    const APPT_PAGE_SIZE = 15;
    const STUDENTS_PAGE_SIZE = 20;
    const [apptPage, setApptPage] = useState(0);
    const [studentsPage, setStudentsPage] = useState(0);

    // Filtro de período para la tabla de citas (default: período activo si existe)
    const [apptPeriodFilter, setApptPeriodFilter] = useState<string>("active");

    // ── Períodos ──────────────────────────────────────────────────────────────
    const [periods, setPeriods] = useState<ReportPeriod[]>([]);
    const [selectedPeriodId, setSelectedPeriodId] = useState<string>("all");
    const [periodStats, setPeriodStats] = useState<any>(null);
    const [loadingPeriodStats, setLoadingPeriodStats] = useState(false);

    // Modal de crear/editar período
    const [showPeriodModal, setShowPeriodModal] = useState(false);
    const [periodModalMode, setPeriodModalMode] = useState<"create" | "edit" | "close">("create");
    const [editingPeriod, setEditingPeriod] = useState<ReportPeriod | null>(null);
    const [periodName, setPeriodName] = useState("");
    const [periodDateRange, setPeriodDateRange] = useState<DateRange | undefined>(undefined);
    // Campos del siguiente período (modal de corte)
    const [nextPeriodName, setNextPeriodName] = useState("");
    const [nextPeriodDateRange, setNextPeriodDateRange] = useState<DateRange | undefined>(undefined);
    const [createNextPeriod, setCreateNextPeriod] = useState(true);
    // Absorber citas sin período al crear uno nuevo
    const [absorbUnassigned, setAbsorbUnassigned] = useState(false);
    // Período seleccionado para exportar PDF
    const [pdfPeriodId, setPdfPeriodId] = useState<string>("all");

    const fetchPeriods = useCallback(async () => {
        try {
            const res = await fetch(`${API}/periods`, { headers: authHeaders() });
            if (res.ok) setPeriods(await res.json());
        } catch { /* silencioso */ }
    }, []);

    const fetchPeriodStats = useCallback(async (periodId: string) => {
        setLoadingPeriodStats(true);
        try {
            const url = periodId === "all" ? `${API}/stats` : `${API}/stats?periodId=${periodId}`;
            const res = await fetch(url, { headers: authHeaders() });
            if (res.ok) setPeriodStats(await res.json());
        } catch { /* silencioso */ } finally {
            setLoadingPeriodStats(false);
        }
    }, []);

    useEffect(() => { fetchPeriods(); }, [fetchPeriods]);

    useEffect(() => {
        if (selectedPeriodId !== "all") {
            fetchPeriodStats(selectedPeriodId);
        } else {
            setPeriodStats(null);
        }
    }, [selectedPeriodId, fetchPeriodStats]);

    const openCreatePeriod = () => {
        setPeriodModalMode("create");
        setEditingPeriod(null);
        setPeriodName("");
        setPeriodDateRange(undefined);
        setAbsorbUnassigned(false);
        setShowPeriodModal(true);
    };

    const openEditPeriod = (p: ReportPeriod) => {
        setPeriodModalMode("edit");
        setEditingPeriod(p);
        setPeriodName(p.name);
        setPeriodDateRange(p.startDate ? {
            from: new Date(p.startDate + "T12:00:00"),
            to: p.endDate ? new Date(p.endDate + "T12:00:00") : undefined,
        } : undefined);
        setShowPeriodModal(true);
    };

    const openClosePeriod = (p: ReportPeriod) => {
        setPeriodModalMode("close");
        setEditingPeriod(p);
        setNextPeriodName("");
        setNextPeriodDateRange(undefined);
        setCreateNextPeriod(true);
        setShowPeriodModal(true);
    };

    const handleSavePeriod = async () => {
        if (!periodName.trim()) { toast.error("El nombre del período es obligatorio"); return; }
        if (!periodDateRange?.from) { toast.error("Selecciona al menos la fecha de inicio"); return; }
        const toISO = (d: Date) => d.toISOString().split("T")[0];
        try {
            if (periodModalMode === "create") {
                const res = await fetch(`${API}/periods`, {
                    method: "POST",
                    headers: authHeaders(),
                    body: JSON.stringify({
                        name: periodName,
                        startDate: toISO(periodDateRange.from),
                        endDate: periodDateRange.to ? toISO(periodDateRange.to) : null,
                        absorbUnassigned,
                    }),
                });
                if (!res.ok) { const e = await res.json(); toast.error(e.error); return; }
                const created = await res.json();
                toast.success(created.absorbed > 0
                    ? `Período creado · ${created.absorbed} cita${created.absorbed !== 1 ? "s" : ""} sin período absorbida${created.absorbed !== 1 ? "s" : ""}`
                    : "Período creado");
            } else if (periodModalMode === "edit" && editingPeriod) {
                const res = await fetch(`${API}/periods/${editingPeriod.id}`, {
                    method: "PATCH",
                    headers: authHeaders(),
                    body: JSON.stringify({
                        name: periodName,
                        startDate: toISO(periodDateRange.from),
                        endDate: periodDateRange.to ? toISO(periodDateRange.to) : null,
                    }),
                });
                if (!res.ok) { const e = await res.json(); toast.error(e.error); return; }
                toast.success("Período actualizado");
            }
            setShowPeriodModal(false);
            fetchPeriods();
        } catch { toast.error("Error al guardar el período"); }
    };

    const handleClosePeriod = async () => {
        if (!editingPeriod) return;
        if (createNextPeriod) {
            if (!nextPeriodName.trim()) { toast.error("El nombre del nuevo período es obligatorio"); return; }
            if (!nextPeriodDateRange?.from) { toast.error("Selecciona la fecha de inicio del nuevo período"); return; }
        }
        const toISO = (d: Date) => d.toISOString().split("T")[0];
        try {
            const body: any = {};
            if (createNextPeriod && nextPeriodDateRange?.from) {
                body.nextPeriod = {
                    name: nextPeriodName,
                    startDate: toISO(nextPeriodDateRange.from),
                    endDate: nextPeriodDateRange.to ? toISO(nextPeriodDateRange.to) : null,
                };
            }
            const res = await fetch(`${API}/periods/${editingPeriod.id}/close`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify(body),
            });
            if (!res.ok) { const e = await res.json(); toast.error(e.error); return; }
            toast.success("Corte realizado exitosamente");
            setShowPeriodModal(false);
            fetchPeriods();
        } catch { toast.error("Error al realizar el corte"); }
    };

    const action = useActionModal();

    // Specialist form
    const [newName, setNewName] = useState("");
    const [newDept, setNewDept] = useState(departments[0] ?? "Psicología");
    const [newEmail, setNewEmail] = useState("");
    const [, setNewSched] = useState("");
    const [newShift, setNewShift] = useState("Matutino");
    const [editingSpec, setEditingSpec] = useState<Specialist | null>(null);
    const [editPass, setEditPass] = useState("");

    // Bajas: nunca se borra a nadie, así que la confirmación lo explica y pide motivo
    const [deactivatingSpec, setDeactivatingSpec] = useState<Specialist | null>(null);
    const [deactivatingUser, setDeactivatingUser] = useState<User | null>(null);
    const [deactivateReason, setDeactivateReason] = useState("");

    // Campos de registro de la organización que sirven para agrupar: solo los de
    // conjunto cerrado (select/radio). De aquí salen las gráficas demográficas,
    // que antes estaban fijas a los campos de una escuela.
    const [groupableFields, setGroupableFields] = useState<GroupableField[]>([]);
    useEffect(() => {
        const slug = authUser?.organization?.slug;
        if (!slug) return;
        fetch(`${API_BASE}/api/public/organizations/${slug}/fields`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                const fields: Array<{ key: string; label: string; type: string }> = data?.registrationFields ?? [];
                setGroupableFields(
                    fields
                        .filter(f => (f.type === "select" || f.type === "radio") && !FIELDS_WITH_OWN_CHART.has(f.key))
                        .map(f => ({ key: f.key, label: f.label }))
                );
            })
            .catch(() => { /* sin campos dinámicos: se muestran solo las gráficas de la cita */ });
    }, [authUser?.organization?.slug]);

    // Sedes de la organización (catálogo) — solo el admin las da de alta
    const [orgLocations, setOrgLocations] = useState<OrgLocation[]>([]);
    const [newLocName, setNewLocName] = useState("");
    const [newLocAddress, setNewLocAddress] = useState("");

    const loadLocations = useCallback(async () => {
        try {
            const res = await fetch(`${API}/locations?all=1`, { headers: authHeaders() });
            if (res.ok) setOrgLocations(await res.json());
        } catch { /* silencioso */ }
    }, []);
    useEffect(() => { loadLocations(); }, [loadLocations]);

    const addLocation = async () => {
        const name = newLocName.trim();
        if (!name) { toast.error("El nombre de la sede es requerido"); return; }
        try {
            const res = await fetch(`${API}/locations`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ name, address: newLocAddress.trim() || null }),
            });
            if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || "Error"); }
            setNewLocName(""); setNewLocAddress("");
            await loadLocations();
            toast.success("Sede agregada");
        } catch (e: any) {
            toast.error(e.message || "No se pudo agregar la sede.");
        }
    };

    const deleteLocation = async (id: string) => {
        try {
            const res = await fetch(`${API}/locations/${id}`, { method: "DELETE", headers: authHeaders() });
            if (!res.ok) throw new Error();
            await loadLocations();
            toast.success("Sede eliminada");
        } catch {
            toast.error("No se pudo eliminar la sede.");
        }
    };

    // Chart refs (used for downloadChartAsImage)
    const chartGlobal = { monthly: useRef<HTMLDivElement>(null), motivos: useRef<HTMLDivElement>(null), modalidad: useRef<HTMLDivElement>(null), carrera: useRef<HTMLDivElement>(null), genero: useRef<HTMLDivElement>(null), semestre: useRef<HTMLDivElement>(null), edad: useRef<HTMLDivElement>(null) };
    const chartPsicologia = { monthly: useRef<HTMLDivElement>(null), motivos: useRef<HTMLDivElement>(null), modalidad: useRef<HTMLDivElement>(null), carrera: useRef<HTMLDivElement>(null), genero: useRef<HTMLDivElement>(null), semestre: useRef<HTMLDivElement>(null), edad: useRef<HTMLDivElement>(null) };
    const chartTutorias = { monthly: useRef<HTMLDivElement>(null), motivos: useRef<HTMLDivElement>(null), modalidad: useRef<HTMLDivElement>(null), carrera: useRef<HTMLDivElement>(null), genero: useRef<HTMLDivElement>(null), semestre: useRef<HTMLDivElement>(null), edad: useRef<HTMLDivElement>(null) };
    const chartNutricion = { monthly: useRef<HTMLDivElement>(null), motivos: useRef<HTMLDivElement>(null), modalidad: useRef<HTMLDivElement>(null), carrera: useRef<HTMLDivElement>(null), genero: useRef<HTMLDivElement>(null), semestre: useRef<HTMLDivElement>(null), edad: useRef<HTMLDivElement>(null) };

    const deptRefs: Record<string, typeof chartGlobal> = {
        Global: chartGlobal,
        "Psicología": chartPsicologia,
        "Tutorías": chartTutorias,
        "Nutrición": chartNutricion,
    };

    // Data — usa periodStats si hay un período seleccionado, si no los stats globales
    const fullStats = periodStats ?? getStats();
    const summary = fullStats.summary;
    const charts = fullStats.charts;
    const allAppts = getAppointments();
    const todayStr = new Date().toISOString().split("T")[0];
    const activePeriod = periods.find(
        p => p.status === "activo" && (!p.endDate || p.endDate >= todayStr)
    ) ?? null;
    const unassignedCount = allAppts.filter(a => !a.periodId).length;

    // Medianoche de hoy — fijada una vez por montaje (estable para deps de useMemo).
    const todayMidnightAdmin = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
    const sinCerrarCount = allAppts.filter(a =>
        (a.status === "Pendiente" || a.status === "Confirmada") &&
        new Date(a.date + "T12:00:00") < todayMidnightAdmin
    ).length;

    // Índice por id: las gráficas recorren miles de citas y buscar el alumno con
    // un find() por cada una convierte el cálculo en cuadrático.
    const usersById = useMemo(
        () => new Map(users.map(u => [u.id, u as { metadata?: Record<string, string> | null }])),
        [users]
    );

    const deptChartData = useMemo(() => {
        const depts = departments;
        const result: Record<string, any> = {};
        depts.forEach(d => {
            const dAppts = allAppts.filter(a => a.department === d);
            const monMap: Record<string, any> = {};
            dAppts.forEach(a => {
                const mon = new Date(a.date + "T12:00:00").toLocaleString("es-MX", { month: "short" });
                if (!monMap[mon]) monMap[mon] = { month: mon, [d]: 0 };
                monMap[mon][d]++;
            });
            const motMap: Record<string, number> = {};
            const modMap: Record<string, number> = { Presencial: 0, Virtual: 0 };
            const carMap: Record<string, number> = {};
            const genMap: Record<string, number> = {};
            const semMap: Record<string, number> = {};
            const edaMap: Record<string, number> = {};
            dAppts.forEach(a => {
                const m = a.motivo || "Consulta General";
                motMap[m] = (motMap[m] || 0) + 1;
                if (a.modality === "Virtual") modMap.Virtual++; else modMap.Presencial++;
                const student = users.find((u: any) => u.id === a.studentId);
                const c = student?.carrera || "No especificada";
                carMap[c] = (carMap[c] || 0) + 1;
                const g = student?.genero || "No especificado";
                genMap[g] = (genMap[g] || 0) + 1;
                const s = student?.semestre ? `Sem. ${student.semestre}` : "No esp.";
                semMap[s] = (semMap[s] || 0) + 1;
                if (student?.fechaNacimiento) {
                    const edad = calcularEdad(student.fechaNacimiento);
                    const rango = AGE_RANGES.find(r => edad >= r.min && edad <= r.max)?.label ?? "Otro";
                    edaMap[rango] = (edaMap[rango] || 0) + 1;
                }
            });
            result[d] = {
                monthly: Object.values(monMap),
                motivos: Object.entries(motMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
                modalidad: Object.entries(modMap).map(([name, value]) => ({ name, value })),
                carrera: Object.entries(carMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8),
                genero: Object.entries(genMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
                semestre: Object.entries(semMap).map(([name, value]) => ({ name, value })).sort((a, b) => {
                    const na = parseInt(a.name.replace("Sem. ", "")) || 99;
                    const nb = parseInt(b.name.replace("Sem. ", "")) || 99;
                    return na - nb;
                }),
                edad: AGE_RANGES.map(r => ({ name: r.label, value: edaMap[r.label] ?? 0 })),
                // Distribuciones por los campos que definio la organizacion
                byField: groupableFields
                    .map(f => distributionByField(dAppts, usersById, f))
                    .filter((x): x is NonNullable<typeof x> => x !== null),
            };
        });
        return result;
    }, [allAppts, users, usersById, departments, groupableFields]);

    // Demographic data for Global view (computed client-side)
    const globalDemoData = useMemo(() => {
        const genMap: Record<string, number> = {};
        const semMap: Record<string, number> = {};
        const edaMap: Record<string, number> = {};
        allAppts.forEach(a => {
            const student = users.find((u: any) => u.id === a.studentId);
            const g = student?.genero || "No especificado";
            genMap[g] = (genMap[g] || 0) + 1;
            const s = student?.semestre ? `Sem. ${student.semestre}` : "No esp.";
            semMap[s] = (semMap[s] || 0) + 1;
            if (student?.fechaNacimiento) {
                const edad = calcularEdad(student.fechaNacimiento);
                const rango = AGE_RANGES.find(r => edad >= r.min && edad <= r.max)?.label ?? "Otro";
                edaMap[rango] = (edaMap[rango] || 0) + 1;
            }
        });
        return {
            genero: Object.entries(genMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
            semestre: Object.entries(semMap).map(([name, value]) => ({ name, value })).sort((a, b) => {
                const na = parseInt(a.name.replace("Sem. ", "")) || 99;
                const nb = parseInt(b.name.replace("Sem. ", "")) || 99;
                return na - nb;
            }),
            edad: AGE_RANGES.map(r => ({ name: r.label, value: edaMap[r.label] ?? 0 })),
            // Distribuciones por los campos que definió la organización
            byField: groupableFields
                .map(f => distributionByField(allAppts, usersById, f))
                .filter((x): x is NonNullable<typeof x> => x !== null),
        };
    }, [allAppts, users, usersById, groupableFields]);

    const filteredAppts = useMemo(() => allAppts.filter(a => {
        // Filtro por período
        if (apptPeriodFilter === "active") {
            if (storeActivePeriod) {
                if (a.periodId !== storeActivePeriod.id) return false;
            }
        } else if (apptPeriodFilter === "unassigned") {
            if (a.periodId) return false;
        } else if (apptPeriodFilter !== "all") {
            if (a.periodId !== apptPeriodFilter) return false;
        }
        if (deptFilter !== "Todos" && a.department !== deptFilter) return false;
        if (statusFilter === "Sin cerrar") {
            const apptD = new Date(a.date + "T12:00:00");
            if (!((a.status === "Pendiente" || a.status === "Confirmada") && apptD < todayMidnightAdmin)) return false;
        } else if (statusFilter !== "Todos" && a.status !== statusFilter) return false;
        if (searchTerm) {
            const q = searchTerm.toLowerCase();
            if (!a.studentName.toLowerCase().includes(q) && !a.specialistName.toLowerCase().includes(q)) return false;
        }
        return true;
    }), [allAppts, apptPeriodFilter, storeActivePeriod, deptFilter, statusFilter, searchTerm, todayMidnightAdmin]);

    // Reset de página cuando cambian los filtros
    useEffect(() => { setApptPage(0); }, [apptPeriodFilter, deptFilter, statusFilter, searchTerm]);

    const apptTotalPages = Math.ceil(filteredAppts.length / APPT_PAGE_SIZE);
    const pagedAppts = filteredAppts.slice(apptPage * APPT_PAGE_SIZE, (apptPage + 1) * APPT_PAGE_SIZE);

    const handleAddSpec = async () => {
        if (!newName || !newEmail) { toast.error("Nombre y correo son obligatorios"); return; }
        await addSpecialist({ name: newName, department: newDept, email: newEmail, shift: newShift });
        toast.success(`Invitación enviada a ${newEmail}`);
        setNewName(""); setNewEmail(""); setNewSched("");
    };

    const handleUpdateSpec = async () => {
        if (!editingSpec) return;
        await updateSpecialist(editingSpec.id, {
            name: editingSpec.name, department: editingSpec.department,
            email: editingSpec.email, active: editingSpec.active,
            ...(editPass && { password: editPass }),
        });
        toast.success("Especialista actualizado");
        setEditingSpec(null); setEditPass("");
    };

    const adminStats = [
        { label: "Total Institucional", value: summary.total, icon: BarChart3, gradient: "from-slate-700 to-slate-900" },
        { label: "Pendientes Global", value: summary.pendientes, icon: Clock, gradient: "from-amber-500 to-amber-600" },
        { label: "Confirmadas", value: summary.confirmadas, icon: CalendarCheck, gradient: "from-blue-600 to-indigo-600" },
        { label: "Completadas", value: summary.completadas, icon: CheckCircle2, gradient: "from-emerald-500 to-emerald-600" },
        { label: "Canceladas / Faltas", value: summary.canceladas, icon: XCircle, gradient: "from-rose-500 to-rose-600" },
    ];

    const endUserTabLabel = `${authUser?.organization?.userRoleLabel ?? "Usuario"}s`;
    const endUserLabel = authUser?.organization?.userRoleLabel ?? "Usuario";
    const isSchool = authUser?.organization?.type === "school";

    const sidebarTabs = [
        { key: "citas", label: "Gestión de Citas", icon: CalendarDays },
        { key: "especialistas", label: "Especialistas", icon: Users },
        { key: "sedes", label: "Sedes", icon: MapPin },
        { key: "estudiantes", label: endUserTabLabel, icon: Users },
        { key: "estadisticas", label: "Estadísticas", icon: BarChart3 },
        { key: "reportes", label: "Reportes", icon: FileText },
        { key: "contenido", label: "Publicar Contenido", icon: FileText },
        { key: "eventos", label: "Publicar Evento", icon: Megaphone },
    ];

    return (
        <AppShell sidebar={{ tabs: sidebarTabs, active: activeTab, onSelect: setActiveTab, badges: { citas: summary.pendientes + sinCerrarCount } }}>
            <div className="space-y-8 max-w-7xl mx-auto w-full pb-12">

                {/* Header */}
                <div>
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Panel de Administración</h1>
                        {authUser?.organization && (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700">
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
                                {authUser.organization.name}
                            </span>
                        )}
                    </div>
                    <p className="text-slate-500 mt-1 font-medium">Control global del sistema de citas institucionales y personal</p>
                </div>

                {/* Stats row */}
                <div className="space-y-3">
                    {periodStats && selectedPeriodId !== "all" && (() => {
                        const filteredPeriodName = periods.find(p => p.id === selectedPeriodId)?.name;
                        return filteredPeriodName ? (
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block" />
                                    Estadísticas filtradas por período: {filteredPeriodName}
                                </span>
                                <span className="text-xs text-slate-400">— Los reportes siempre muestran todas las citas</span>
                            </div>
                        ) : null;
                    })()}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                        {adminStats.map((s, i) => <StatCard key={s.label} index={i} {...s} />)}
                    </div>
                </div>

                {/* Dept cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {Object.entries(DEPT_CONFIG).map(([name, cfg]) => (
                        <div key={name} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm flex items-center justify-between hover:shadow-md hover:border-blue-200 dark:hover:border-blue-600 transition-all">
                            <div className="flex items-center gap-4">
                                <div className={`w-12 h-12 ${cfg.bg} rounded-xl flex items-center justify-center`}>
                                    <cfg.icon className="w-5 h-5" style={{ color: cfg.color }} />
                                </div>
                                <div>
                                    <p className="text-slate-500 text-xs font-bold uppercase tracking-wider">{name}</p>
                                    <p className="text-slate-900 text-2xl font-black mt-0.5 leading-none">
                                        {summary.byDept?.[name] ?? 0} <span className="text-slate-400 font-medium text-sm">citas</span>
                                    </p>
                                </div>
                            </div>
                            <TrendingUp className="w-5 h-5 text-slate-300" />
                        </div>
                    ))}
                </div>

                <Reveal key={activeTab}>
                <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden min-h-[500px]">

                    {/* ─── Citas Tab ─── */}
                    {activeTab === "citas" && (
                        <div className="flex flex-col h-full">
                            <div className="p-6 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/30 flex flex-col gap-3">
                                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-900 dark:text-white">Registro Global de Citas</h3>
                                        <p className="text-slate-500 font-medium text-sm mt-0.5">
                                            {filteredAppts.length} cita{filteredAppts.length !== 1 ? "s" : ""} · {storeActivePeriod ? `Período: ${storeActivePeriod.name}` : "Sin período activo"}
                                        </p>
                                    </div>
                                    <div className="relative w-full md:w-64">
                                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input type="text" placeholder="Buscar alumno o especialista..." value={searchTerm}
                                            onChange={e => setSearchTerm(e.target.value)}
                                            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-700 dark:text-white dark:border-slate-600 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600" />
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <select value={apptPeriodFilter} onChange={e => setApptPeriodFilter(e.target.value)} className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-medium text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/20">
                                        <option value="active">{storeActivePeriod ? `${storeActivePeriod.name} (activo)` : "Período actual"}</option>
                                        <option value="all">Todos los períodos</option>
                                        {unassignedCount > 0 && (
                                            <option value="unassigned">Sin período asignado ({unassignedCount})</option>
                                        )}
                                        {periods.filter(p => p.status === "cerrado").map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                    <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-medium text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/20">
                                        <option>Todos</option>{departments.map(d => <option key={d}>{d}</option>)}
                                    </select>
                                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-3 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-sm font-medium text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600/20">
                                        <option>Todos</option><option>Pendiente</option><option>Confirmada</option><option>Completada</option><option>Cancelada</option><option>Sin cerrar</option>
                                    </select>
                                </div>
                            </div>

                            <div className="overflow-x-auto min-h-[300px]">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-slate-200 bg-slate-50/50 dark:bg-slate-800/50 dark:border-slate-700">
                                            {["Alumno", "Departamento", "Especialista", "Fecha", "Hora", "Modalidad", "Estado"].map(h => (
                                                <th key={h} className="px-6 py-4 text-slate-500 font-bold tracking-wider uppercase text-[0.65rem]">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700 bg-white dark:bg-slate-900">
                                        {pagedAppts.map(cita => {
                                            const citaDate = new Date(cita.date + "T12:00:00");
                                            const isSinCerrar = (cita.status === "Pendiente" || cita.status === "Confirmada") && citaDate < todayMidnightAdmin;
                                            const isSesionTardia = cita.status === "Completada" && cita.updatedAt && cita.updatedAt.split("T")[0] > cita.date;
                                            return (
                                            <tr key={cita.id} className={`hover:bg-slate-50/80 dark:hover:bg-slate-700/40 transition-colors ${isSinCerrar ? "bg-amber-50/40 dark:bg-amber-900/20" : ""}`}>
                                                <td className="px-6 py-4"><p className="text-slate-900 font-bold text-sm">{cita.studentName}</p></td>
                                                <td className="px-6 py-4">
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">{cita.department}</span>
                                                </td>
                                                <td className="px-6 py-4"><p className="text-slate-700 font-medium text-sm">{cita.specialistName}</p></td>
                                                <td className="px-6 py-4"><p className="text-slate-900 font-bold text-sm">{citaDate.toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</p></td>
                                                <td className="px-6 py-4 text-slate-500 font-medium text-sm">{cita.time}</td>
                                                <td className="px-6 py-4 text-slate-500 font-medium text-sm capitalize">{cita.modality}</td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <StatusBadge status={cita.status} />
                                                        {isSinCerrar && <StatusBadge status="Sin cerrar" />}
                                                        {isSesionTardia && <StatusBadge status="Sesión tardía" />}
                                                    </div>
                                                </td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {filteredAppts.length === 0 && (
                                    <EmptyState icon={CalendarCheck} title="Sin resultados" subtitle="No hay citas que coincidan con los filtros seleccionados." />
                                )}
                            </div>
                            {apptTotalPages > 1 && (
                                <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                                    <span className="text-xs text-slate-500 font-medium">
                                        {apptPage * APPT_PAGE_SIZE + 1}–{Math.min((apptPage + 1) * APPT_PAGE_SIZE, filteredAppts.length)} de {filteredAppts.length}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => setApptPage(p => Math.max(0, p - 1))} disabled={apptPage === 0}
                                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                            ← Anterior
                                        </button>
                                        {Array.from({ length: apptTotalPages }, (_, i) => (
                                            <button key={i} onClick={() => setApptPage(i)}
                                                className={`w-7 h-7 rounded-lg text-xs font-bold transition-colors ${i === apptPage ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"}`}>
                                                {i + 1}
                                            </button>
                                        ))}
                                        <button onClick={() => setApptPage(p => Math.min(apptTotalPages - 1, p + 1))} disabled={apptPage === apptTotalPages - 1}
                                            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                            Siguiente →
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ─── Especialistas Tab ─── */}
                    {activeTab === "especialistas" && (
                        <div className="p-8">
                            <div className="flex items-center justify-between mb-8">
                                <div>
                                    <h3 className="text-2xl font-bold text-slate-900">Gestión de Especialistas</h3>
                                    <p className="text-slate-500 font-medium mt-1">{specialists.length} especialistas registrados en el sistema.</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                {/* List */}
                                <div className="space-y-3">
                                    <h4 className="text-slate-900 font-bold mb-4 uppercase tracking-wider text-xs">Directorio Activo</h4>
                                    {specialists.map((esp: Specialist) => {
                                        const conf = DEPT_CONFIG[esp.department];
                                        return (
                                            <div key={esp.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm hover:shadow-md transition-shadow flex items-center gap-4 group">
                                                <Avatar name={esp.name} avatarUrl={esp.avatarUrl} />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-slate-900 font-bold truncate tracking-tight">{esp.name}</p>
                                                    <div className="flex flex-wrap items-center gap-2 mt-1">
                                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-50 border border-slate-100 text-slate-500 text-xs font-bold">
                                                            {conf && <conf.icon className="w-3 h-3" style={{ color: conf.color }} />} {esp.department}
                                                        </span>
                                                        <span className="text-slate-400 text-xs">•</span>
                                                        <span className="text-slate-500 text-xs font-medium truncate">{esp.email}</span>
                                                    </div>
                                                    {esp.shift && (
                                                        <span className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-widest border border-blue-100">
                                                            <Clock3 className="w-2.5 h-2.5" /> {esp.shift}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className={`px-2.5 py-1 rounded-full font-bold text-[0.65rem] uppercase tracking-wider shrink-0 border ${esp.active ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-slate-100 text-slate-400 border-slate-200"}`}>
                                                    {esp.active ? "Activo" : "Inactivo"}
                                                </span>
                                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={() => setEditingSpec(esp)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg cursor-pointer transition-colors"><Pencil className="w-4 h-4" /></button>
                                                    <button onClick={() => setDeactivatingSpec(esp)} title="Dar de baja"
                                                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"><XCircle className="w-4 h-4" /></button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Add form */}
                                <div>
                                    <h4 className="text-slate-900 font-bold mb-4 uppercase tracking-wider text-xs flex items-center gap-2">
                                        <Plus className="w-4 h-4 text-blue-600" /> Nuevo Registro
                                    </h4>
                                    <div className="bg-slate-50 rounded-3xl border border-slate-200 p-6 shadow-sm space-y-5">
                                        <div>
                                            <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Nombre completo <span className="text-rose-500">*</span></label>
                                            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ej. Dra. Ana López" className={inputCls} />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Departamento</label>
                                                <select value={newDept} onChange={e => setNewDept(e.target.value)} className={inputCls}>
                                                    {departments.map(d => <option key={d}>{d}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Correo institucional <span className="text-rose-500">*</span></label>
                                                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="correo@instituto.edu.mx" className={inputCls} />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">Turno de Atención</label>
                                            <select value={newShift} onChange={e => setNewShift(e.target.value)} className={inputCls}>
                                                <option value="Matutino">Turno Matutino</option>
                                                <option value="Vespertino">Turno Vespertino</option>
                                            </select>
                                        </div>
                                        <Btn onClick={handleAddSpec} size="lg" className="w-full"><Plus className="w-5 h-5 mr-2" /> Enviar Invitación</Btn>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ─── Usuarios Tab ─── */}
                    {activeTab === "estudiantes" && (() => {
                        const alumnosAll = users.filter((u: any) => u.role === "alumno" || u.role === "usuario");
                        const alumnosTotalPages = Math.ceil(alumnosAll.length / STUDENTS_PAGE_SIZE);
                        const pagedAlumnos = alumnosAll.slice(studentsPage * STUDENTS_PAGE_SIZE, (studentsPage + 1) * STUDENTS_PAGE_SIZE);
                        const tableHeaders = isSchool
                            ? [endUserLabel, "Carrera", "Semestre", "Matrícula", "Correo", "Acción"]
                            : [endUserLabel, "Datos de registro", "Correo", "Acción"];
                        return (
                        <div className="p-8">
                            <div className="flex items-center justify-between mb-6">
                                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{endUserLabel}s Registrados <span className="text-slate-400 font-normal text-lg">({alumnosAll.length})</span></h3>
                            </div>
                            <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden overflow-x-auto">
                                <table className="w-full min-w-[640px]">
                                    <thead>
                                        <tr className="border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-700/30">
                                            {tableHeaders.map(h => (
                                                <th key={h} className="px-6 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50 dark:divide-slate-700">
                                        {pagedAlumnos.map((u: any) => (
                                            <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/40 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <Avatar name={u.name} size="sm" />
                                                        <p className="font-bold text-slate-900 dark:text-white text-sm">{u.name}</p>
                                                    </div>
                                                </td>
                                                {isSchool ? (<>
                                                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300 text-sm">{u.carrera || "—"}</td>
                                                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300 text-sm">{u.semestre || "—"}</td>
                                                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300 text-sm font-mono">{u.matricula || "—"}</td>
                                                </>) : (
                                                    <td className="px-6 py-4 text-slate-700 dark:text-slate-300 text-sm">
                                                        {u.metadata && Object.keys(u.metadata).length > 0
                                                            ? Object.entries(u.metadata as Record<string, string>).slice(0, 3).map(([k, v]) => (
                                                                <span key={k} className="inline-block mr-3">
                                                                    <span className="text-slate-400 text-xs">{k.replace(/_/g, " ")}: </span>
                                                                    <span className="font-medium">{v}</span>
                                                                </span>
                                                            ))
                                                            : <span className="text-slate-400">—</span>
                                                        }
                                                    </td>
                                                )}
                                                <td className="px-6 py-4 text-slate-500 text-sm">{u.email}</td>
                                                <td className="px-6 py-4">
                                                    <button onClick={() => setDeactivatingUser(u)} title="Dar de baja"
                                                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer">
                                                        <XCircle className="w-4 h-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {alumnosTotalPages > 1 && (
                                    <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                                        <span className="text-xs text-slate-500 font-medium">
                                            {studentsPage * STUDENTS_PAGE_SIZE + 1}–{Math.min((studentsPage + 1) * STUDENTS_PAGE_SIZE, alumnosAll.length)} de {alumnosAll.length}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => setStudentsPage(p => Math.max(0, p - 1))} disabled={studentsPage === 0}
                                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                                ← Anterior
                                            </button>
                                            {Array.from({ length: alumnosTotalPages }, (_, i) => (
                                                <button key={i} onClick={() => setStudentsPage(i)}
                                                    className={`w-7 h-7 rounded-lg text-xs font-bold transition-colors ${i === studentsPage ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"}`}>
                                                    {i + 1}
                                                </button>
                                            ))}
                                            <button onClick={() => setStudentsPage(p => Math.min(alumnosTotalPages - 1, p + 1))} disabled={studentsPage === alumnosTotalPages - 1}
                                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                                                Siguiente →
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        );
                    })()}

                    {/* ─── Estadísticas Tab ─── */}
                    {activeTab === "estadisticas" && (
                        <div className="p-8 bg-slate-50/50 dark:bg-slate-900/30 min-h-full">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                                <div>
                                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Análisis de Datos e Impacto</h3>
                                    <p className="text-slate-500 font-medium">Visualiza y exporta las métricas de atención institucional</p>
                                </div>
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                                    {/* Selector de período */}
                                    <div className="relative">
                                        <select
                                            value={selectedPeriodId}
                                            onChange={e => setSelectedPeriodId(e.target.value)}
                                            className={`${inputCls} pr-8 text-sm font-semibold appearance-none cursor-pointer min-w-[220px]`}
                                        >
                                            <option value="all">Todos los períodos</option>
                                            {unassignedCount > 0 && (
                                                <option value="unassigned">Sin período asignado ({unassignedCount})</option>
                                            )}
                                            {periods.map(p => (
                                                <option key={p.id} value={p.id}>
                                                    {p.name}{p.status === "activo" ? " (activo)" : ""}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                    </div>
                                    {/* Tabs de departamento */}
                                    <div className="flex bg-white dark:bg-slate-800 rounded-xl p-1 border border-slate-200 dark:border-slate-700 shadow-sm">
                                        {["Global", ...departments].map(v => (
                                            <button key={v} onClick={() => setStatsView(v)}
                                                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer ${statsView === v ? "bg-blue-600 text-white shadow-md shadow-blue-600/20" : "text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700"}`}>
                                                {v}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            {loadingPeriodStats && (
                                <div className="text-center py-4 text-slate-500 text-sm font-medium animate-pulse">Cargando datos del período...</div>
                            )}

                            <div className="space-y-6">
                                {(() => {
                                    const isGlobal = statsView === "Global";
                                    const data = isGlobal ? { ...charts, ...globalDemoData } : deptChartData[statsView];
                                    const refs = deptRefs[statsView];
                                    if (!data || !refs) return null;

                                    return (
                                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                {/* Monthly */}
                                                <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
                                                    <div className="flex items-center justify-between mb-6">
                                                        <h4 className="text-slate-900 dark:text-white font-bold text-lg">Citas por Mes{isGlobal ? " y Departamento" : ""}</h4>
                                                        <button onClick={() => downloadChartAsImage(refs.monthly, `Tendencias_${statsView}`, isGlobal ? "Citas por Mes y Departamento" : `Citas por Mes — ${statsView}`, dark, isGlobal ? departments.map(d => ({ label: d, color: DEPT_CONFIG[d]?.color ?? "#64748b" })) : undefined)}
                                                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all cursor-pointer" title="Descargar como imagen">
                                                            <Download className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                    <div ref={refs.monthly}>
                                                        <ResponsiveContainer width="100%" height={300}>
                                                            <BarChart data={data.monthly} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                                                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                                                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} dy={10} />
                                                                <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                                                                <Tooltip cursor={cursorStyle} contentStyle={tooltipStyle} />
                                                                {isGlobal ? (
                                                                    <>
                                                                        {departments.map(d => (
                                                                            <Bar key={d} dataKey={d} fill={DEPT_CONFIG[d]?.color ?? "#64748b"} radius={[4, 4, 0, 0]} maxBarSize={40} />
                                                                        ))}
                                                                    </>
                                                                ) : (
                                                                    <Bar dataKey={statsView} fill={DEPT_CONFIG[statsView]?.color ?? "#64748b"} radius={[4, 4, 0, 0]} maxBarSize={50} />
                                                                )}
                                                            </BarChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                </div>

                                                {/* Motivos */}
                                                <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
                                                    <div className="flex items-center justify-between mb-6">
                                                        <h4 className="text-slate-900 dark:text-white font-bold text-lg">Motivos Frecuentes</h4>
                                                        <button onClick={() => { const tot = data.motivos.reduce((s: number, d: any) => s + d.value, 0); downloadChartAsImage(refs.motivos, `Motivos_${statsView}`, "Motivos Frecuentes", dark, data.motivos.map((d: any, i: number) => ({ label: d.name, color: PIE_COLORS[i % PIE_COLORS.length], percent: tot > 0 ? (d.value / tot) * 100 : 0 }))); }}
                                                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all cursor-pointer" title="Descargar como imagen">
                                                            <Download className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                    <div ref={refs.motivos}>
                                                        <ResponsiveContainer width="100%" height={300}>
                                                            <PieChart>
                                                                <Pie data={data.motivos} cx="50%" cy="50%" outerRadius={100} innerRadius={60} dataKey="value" stroke="none">
                                                                    {data.motivos.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                                                </Pie>
                                                                <Tooltip contentStyle={tooltipStyle} />
                                                            </PieChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className={`grid grid-cols-1 ${isSchool ? "lg:grid-cols-2" : ""} gap-6`}>
                                                {/* Modalidad */}
                                                <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
                                                    <div className="flex items-center justify-between mb-6">
                                                        <h4 className="text-slate-900 dark:text-white font-bold text-lg">Modalidad de Atención</h4>
                                                        <button onClick={() => { const tot = data.modalidad.reduce((s: number, d: any) => s + d.value, 0); downloadChartAsImage(refs.modalidad, `Modalidad_${statsView}`, "Modalidad de Atención", dark, data.modalidad.map((d: any, i: number) => ({ label: d.name, color: i === 0 ? "#3b82f6" : "#10b981", percent: tot > 0 ? (d.value / tot) * 100 : 0 }))); }}
                                                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all cursor-pointer" title="Descargar como imagen">
                                                            <Download className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                    <div ref={refs.modalidad}>
                                                        <ResponsiveContainer width="100%" height={260}>
                                                            <PieChart>
                                                                <Pie data={data.modalidad} cx="50%" cy="50%" innerRadius={70} outerRadius={100} dataKey="value" stroke="none">
                                                                    <Cell fill="#3b82f6" /><Cell fill="#10b981" />
                                                                </Pie>
                                                                <Tooltip contentStyle={tooltipStyle} />
                                                            </PieChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                </div>

                                                {/* Una gráfica por campo de registro de la organización.
                                                    Sustituye a las fijas por carrera o género: cada
                                                    organización define los suyos y aquí se agrupa por ellos.
                                                    Los campos que nadie rellenó no se pintan. */}
                                                {(data.byField ?? []).map((f: { key: string; label: string; data: { name: string; value: number }[] }) => (
                                                    <div key={f.key} className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
                                                        <div className="flex items-center justify-between mb-6">
                                                            <h4 className="text-slate-900 dark:text-white font-bold text-lg">Distribución por {f.label}</h4>
                                                        </div>
                                                        <ResponsiveContainer width="100%" height={320}>
                                                            <BarChart data={f.data} layout="vertical" margin={{ top: 0, right: 30, left: 30, bottom: 0 }}>
                                                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                                                                <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                                                                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "#475569", fontWeight: 500 }} axisLine={false} tickLine={false} width={100} interval={0} />
                                                                <Tooltip cursor={cursorStyle} contentStyle={tooltipStyle} />
                                                                <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} maxBarSize={24} />
                                                            </BarChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                ))}

                                                {/* Por Carrera — school only */}
                                                {isSchool && (
                                                <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
                                                    <div className="flex items-center justify-between mb-6">
                                                        <h4 className="text-slate-900 dark:text-white font-bold text-lg">Distribución por Carrera</h4>
                                                        <button onClick={() => downloadChartAsImage(refs.carrera, `Carreras_${statsView}`, "Distribución por Carrera", dark)}
                                                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all cursor-pointer" title="Descargar como imagen">
                                                            <Download className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                    <div ref={refs.carrera}>
                                                        <ResponsiveContainer width="100%" height={320}>
                                                            <BarChart data={data.carrera} layout="vertical" margin={{ top: 0, right: 30, left: 30, bottom: 0 }}>
                                                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                                                                <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                                                                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "#475569", fontWeight: 500 }} axisLine={false} tickLine={false} width={100} interval={0} />
                                                                <Tooltip cursor={cursorStyle} contentStyle={tooltipStyle} />
                                                                <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} maxBarSize={24} />
                                                            </BarChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                </div>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                                {/* Por Género */}
                                                {hasRealData(data.genero) && (
                                                <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
                                                    <div className="flex items-center justify-between mb-6">
                                                        <h4 className="text-slate-900 dark:text-white font-bold text-lg">Distribución por Género</h4>
                                                        <button onClick={() => { const gd = data.genero ?? []; const tot = gd.reduce((s: number, d: any) => s + d.value, 0); downloadChartAsImage(refs.genero, `Genero_${statsView}`, "Distribución por Género", dark, gd.map((d: any, i: number) => ({ label: d.name, color: PIE_COLORS[i % PIE_COLORS.length], percent: tot > 0 ? (d.value / tot) * 100 : 0 }))); }}
                                                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all cursor-pointer" title="Descargar como imagen">
                                                            <Download className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                    <div ref={refs.genero}>
                                                        <ResponsiveContainer width="100%" height={260}>
                                                            <PieChart>
                                                                <Pie data={data.genero ?? []} cx="50%" cy="50%" innerRadius={70} outerRadius={100} dataKey="value" stroke="none">
                                                                    {(data.genero ?? []).map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                                                                </Pie>
                                                                <Tooltip contentStyle={tooltipStyle} />
                                                            </PieChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                </div>
                                                )}

                                                {/* Por Semestre — school only */}
                                                {isSchool && (
                                                <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
                                                    <div className="flex items-center justify-between mb-6">
                                                        <h4 className="text-slate-900 dark:text-white font-bold text-lg">Distribución por Semestre</h4>
                                                        <button onClick={() => downloadChartAsImage(refs.semestre, `Semestre_${statsView}`, "Distribución por Semestre", dark)}
                                                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all cursor-pointer" title="Descargar como imagen">
                                                            <Download className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                    <div ref={refs.semestre}>
                                                        <ResponsiveContainer width="100%" height={260}>
                                                            <BarChart data={data.semestre ?? []} margin={{ top: 10, right: 10, left: -20, bottom: 10 }}>
                                                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                                                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                                                                <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                                                                <Tooltip cursor={cursorStyle} contentStyle={tooltipStyle} />
                                                                <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={40} />
                                                            </BarChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                </div>
                                                )}

                                                {/* Histograma de Edad */}
                                                <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200 dark:border-slate-700 p-6 shadow-sm">
                                                    <div className="flex items-center justify-between mb-6">
                                                        <div>
                                                            <h4 className="text-slate-900 dark:text-white font-bold text-lg">Distribución de Edad</h4>
                                                            <p className="text-slate-400 text-xs mt-0.5">{endUserLabel}s atendidos por rango de edad</p>
                                                        </div>
                                                        <button onClick={() => downloadChartAsImage(refs.edad, `Edad_${statsView}`, "Distribución de Edad", dark)}
                                                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all cursor-pointer" title="Descargar como imagen">
                                                            <Download className="w-5 h-5" />
                                                        </button>
                                                    </div>
                                                    {(data.edad ?? []).every((d: any) => d.value === 0) ? (
                                                        <div className="flex items-center justify-center h-[260px] text-slate-400 text-sm">Sin datos de fecha de nacimiento</div>
                                                    ) : (
                                                        <div ref={refs.edad}>
                                                            <ResponsiveContainer width="100%" height={260}>
                                                                <BarChart data={data.edad ?? []} margin={{ top: 10, right: 10, left: -20, bottom: 10 }}>
                                                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                                                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                                                                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                                                                    <Tooltip cursor={cursorStyle} contentStyle={tooltipStyle} formatter={(v: any) => [v, "Citas"]} />
                                                                    <Bar dataKey="value" name="Citas" radius={[4, 4, 0, 0]} maxBarSize={48}>
                                                                        {(data.edad ?? []).map((_: any, i: number) => (
                                                                            <Cell key={i} fill={["#6366f1", "#3b82f6", "#0ea5e9", "#10b981", "#f59e0b"][i % 5]} />
                                                                        ))}
                                                                    </Bar>
                                                                </BarChart>
                                                            </ResponsiveContainer>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    )}

                    {/* ─── Reportes Tab ─── */}
                    {activeTab === "reportes" && (
                        <div className="p-8 space-y-10">
                            {/* ── Encabezado ── */}
                            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                                <div>
                                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight mb-1">Reportes y Períodos</h3>
                                    <p className="text-slate-500 font-medium">Gestiona los períodos académicos y exporta reportes PDF por departamento.</p>
                                </div>
                                <Btn onClick={openCreatePeriod} disabled={!!activePeriod} className="shrink-0" title={activePeriod ? "Ya existe un período activo" : ""}>
                                    <Plus className="w-4 h-4 mr-2" /> Nuevo período
                                </Btn>
                            </div>

                            {/* ── Período activo ── */}
                            {activePeriod ? (
                                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                            <span className="text-xs font-bold text-green-600 dark:text-green-400 uppercase tracking-wide">Período activo</span>
                                        </div>
                                        <p className="text-slate-900 dark:text-white font-bold text-lg">{activePeriod.name}</p>
                                        <p className="text-slate-500 text-sm mt-0.5">
                                            Desde {new Date(activePeriod.startDate + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                                            {activePeriod.endDate && ` hasta ${new Date(activePeriod.endDate + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}`}
                                            {" · "}{activePeriod._count?.appointments ?? 0} citas registradas
                                        </p>
                                    </div>
                                    <div className="flex gap-3 shrink-0">
                                        <Btn variant="outline" onClick={() => openEditPeriod(activePeriod)}>
                                            <Pencil className="w-4 h-4 mr-2" /> Editar fechas
                                        </Btn>
                                        <Btn onClick={() => openClosePeriod(activePeriod)} className="bg-amber-500 hover:bg-amber-600 text-white border-0">
                                            <Scissors className="w-4 h-4 mr-2" /> Realizar Corte
                                        </Btn>
                                    </div>
                                </div>
                            ) : (
                                <div className={`border rounded-3xl p-6 ${unassignedCount > 0 ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800" : "bg-slate-50 dark:bg-slate-800/50 border-dashed border-slate-300 dark:border-slate-600"}`}>
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                        <div className="flex items-start gap-3">
                                            <Scissors className={`w-8 h-8 mt-0.5 shrink-0 ${unassignedCount > 0 ? "text-amber-500" : "text-slate-300"}`} />
                                            <div>
                                                <p className={`font-semibold ${unassignedCount > 0 ? "text-amber-800 dark:text-amber-300" : "text-slate-500"}`}>
                                                    No hay ningún período activo
                                                </p>
                                                {unassignedCount > 0 ? (
                                                    <p className="text-amber-700 dark:text-amber-400 text-sm mt-0.5">
                                                        <strong>{unassignedCount} cita{unassignedCount !== 1 ? "s" : ""}</strong> registrada{unassignedCount !== 1 ? "s" : ""} sin período — no quedarán clasificadas hasta que crees uno nuevo.
                                                    </p>
                                                ) : (
                                                    <p className="text-slate-400 text-sm mt-0.5">Crea un período para comenzar a etiquetar las citas automáticamente.</p>
                                                )}
                                            </div>
                                        </div>
                                        {unassignedCount > 0 && (
                                            <Btn onClick={openCreatePeriod} className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white border-0">
                                                <Plus className="w-4 h-4 mr-2" /> Crear período
                                            </Btn>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* ── Historial de períodos ── */}
                            {periods.filter(p => p.status === "cerrado").length > 0 && (() => {
                                const closed = periods.filter(p => p.status === "cerrado");
                                return (
                                    <div>
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="text-slate-900 dark:text-white font-bold text-base">Historial de períodos cerrados</h4>
                                            <span className="text-xs text-slate-400 font-medium">{closed.length} período{closed.length !== 1 ? "s" : ""}</span>
                                        </div>
                                        <div className="border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
                                            <div className="overflow-y-auto max-h-[13rem] divide-y divide-slate-100 dark:divide-slate-700/60">
                                                {closed.map(p => (
                                                    <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                                        <div className="min-w-0">
                                                            <span className="text-slate-900 dark:text-white font-semibold text-sm truncate block">{p.name}</span>
                                                            <span className="text-slate-400 text-xs">
                                                                {p.startDate && new Date(p.startDate + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}
                                                                {p.endDate && ` — ${new Date(p.endDate + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}`}
                                                                {" · "}{p._count?.appointments ?? 0} citas
                                                            </span>
                                                        </div>
                                                        <button onClick={() => openEditPeriod(p)} className="shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" title="Renombrar">
                                                            <Pencil className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                            {closed.length > 4 && (
                                                <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-700 text-center">
                                                    <span className="text-xs text-slate-400">Desplázate para ver todos los períodos</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* ── Exportar PDF ── */}
                            <div>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                                    <h4 className="text-slate-900 dark:text-white font-bold text-base">Exportar reporte PDF</h4>
                                    <div className="relative">
                                        <select
                                            value={pdfPeriodId}
                                            onChange={e => setPdfPeriodId(e.target.value)}
                                            className={`${inputCls} pr-8 text-sm appearance-none cursor-pointer min-w-[200px]`}
                                        >
                                            <option value="all">Todos los períodos</option>
                                            {periods.map(p => (
                                                <option key={p.id} value={p.id}>
                                                    {p.name}{p.status === "activo" ? " (activo)" : ""}
                                                </option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                                {(() => {
                                    const pdfAppts = pdfPeriodId === "all"
                                        ? allAppts
                                        : allAppts.filter(a => a.periodId === pdfPeriodId);
                                    const pdfPeriodName = pdfPeriodId === "all"
                                        ? undefined
                                        : periods.find(p => p.id === pdfPeriodId)?.name;
                                    return (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                            {[
                                                ...departments.map(d => ({
                                                    label: d,
                                                    icon: REPORT_CARD_STYLE[d]?.icon ?? FileText,
                                                    gradient: REPORT_CARD_STYLE[d]?.gradient ?? "from-slate-500 to-slate-700",
                                                })),
                                                { label: "Reporte Global", icon: FileText, gradient: "from-violet-600 to-purple-700" },
                                            ].map(r => (
                                                <div key={r.label} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 text-center hover:shadow-xl transition-all flex flex-col h-full">
                                                    <div className={`w-16 h-16 bg-gradient-to-br ${r.gradient} rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg`}>
                                                        <r.icon className="w-8 h-8 text-white" />
                                                    </div>
                                                    <h4 className="text-slate-900 dark:text-white font-bold text-lg mb-2">{r.label}</h4>
                                                    <p className="text-slate-500 text-xs font-medium mb-1 flex-1">Datos consolidados, demografía y efectividad.</p>
                                                    <p className="text-slate-400 text-xs mb-5">
                                                        {pdfPeriodName ? `Período: ${pdfPeriodName}` : "Todos los períodos"}
                                                        {" · "}{(r.label === "Reporte Global" ? pdfAppts : pdfAppts.filter(a => a.department === r.label)).length} citas
                                                    </p>
                                                    <Btn onClick={() => generatePDFReport(r.label, pdfAppts, users, pdfPeriodName, isSchool, endUserLabel, departments)} variant="outline" className="w-full">
                                                        <Download className="w-4 h-4 mr-2" /> PDF Export
                                                    </Btn>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    )}

                    {/* ─── Contenido Tab ─── */}
                    {activeTab === "contenido" && (
                        <AdminContentTab />
                    )}

                    {/* ─── Eventos Tab ─── */}
                    {activeTab === "sedes" && (
                        <div>
                            <div className="mb-6">
                                <h3 className="text-2xl font-bold text-slate-900 dark:text-white">Sedes de la organización</h3>
                                <p className="text-slate-500 font-medium mt-1">Define las ubicaciones físicas. Los especialistas elegirán la suya de esta lista para sus citas presenciales.</p>
                            </div>

                            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 mb-6 shadow-sm">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <input value={newLocName} onChange={e => setNewLocName(e.target.value)} placeholder="Nombre (ej. Campus Centro)" className={inputCls} />
                                    <input value={newLocAddress} onChange={e => setNewLocAddress(e.target.value)} placeholder="Dirección o referencia (opcional)" className={inputCls} />
                                </div>
                                <Btn size="sm" className="mt-3" onClick={addLocation}><Plus className="w-4 h-4" /> Agregar sede</Btn>
                            </div>

                            {orgLocations.length === 0 ? (
                                <EmptyState icon={MapPin} title="Sin sedes registradas" subtitle="Agrega la primera arriba." />
                            ) : (
                                <div className="space-y-2">
                                    {orgLocations.map(l => (
                                        <div key={l.id} className="flex items-center justify-between gap-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                                            <div className="min-w-0">
                                                <p className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> {l.name}</p>
                                                {l.address && <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5 truncate">{l.address}</p>}
                                            </div>
                                            <button onClick={() => deleteLocation(l.id)} title="Eliminar sede"
                                                className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded-lg transition-all cursor-pointer shrink-0">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "eventos" && (
                        <AdminEventsTab endUserTabLabel={endUserTabLabel} />
                    )}

                </div>{/* end card */}
                </Reveal>

                {/* ─── Action Modal ─── */}
                <Modal open={!!action.appt && !!action.status} onClose={action.close}
                    title={`Cambiar estado a: ${action.status}`}
                    subtitle={action.appt ? `${action.appt.studentName} — ${action.appt.date} a las ${action.appt.time}` : ""}
                    maxWidth="max-w-md">
                    <div className="space-y-5">
                        <div>
                            <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">{action.status === "Cancelada" ? <>Motivo de cancelación <span className="text-rose-500">*</span></> : "Observaciones (opcional)"}</label>
                            <textarea value={action.notes} onChange={e => action.setNotes(e.target.value)}
                                placeholder="Agregar comentario..." rows={3}
                                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 resize-none focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 transition-colors text-slate-700 dark:text-slate-200 bg-slate-50/50 dark:bg-slate-700/50 text-sm" />
                        </div>
                        <div className="flex gap-3">
                            <Btn variant="outline" onClick={action.close} className="flex-1">Cancelar Operación</Btn>
                            <Btn onClick={() => {
                                    if (action.status === "Cancelada" && !action.notes.trim()) { toast.error("Indica el motivo de la cancelación."); return; }
                                    action.confirm(false);
                                }}
                                className={`flex-1 text-white border-0 shadow-lg ${action.status === "Cancelada" ? "bg-rose-600 hover:bg-rose-700 shadow-rose-600/20" : "bg-blue-600 hover:bg-blue-700 shadow-blue-600/20"}`}>
                                Confirmar Estado
                            </Btn>
                        </div>
                    </div>
                </Modal>

                {/* ─── Edit Specialist Modal ─── */}
                <Modal open={!!editingSpec} onClose={() => setEditingSpec(null)} title="Editar Especialista" subtitle={editingSpec?.name} maxWidth="max-w-md">
                    <div className="space-y-4">
                        <div>
                            <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Nombre</label>
                            <input type="text" value={editingSpec?.name || ""} onChange={e => setEditingSpec(p => p ? { ...p, name: e.target.value } : null)} className={inputCls} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Email</label>
                                <input type="email" value={editingSpec?.email || ""} onChange={e => setEditingSpec(p => p ? { ...p, email: e.target.value } : null)} className={inputCls} />
                            </div>
                            <div>
                                <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Departamento</label>
                                <select value={editingSpec?.department || ""} onChange={e => setEditingSpec(p => p ? { ...p, department: e.target.value } : null)} className={inputCls}>
                                    {departments.map(d => <option key={d}>{d}</option>)}
                                </select>
                            </div>
                        </div>
                        <div>
                            <label className="block mb-1 text-slate-700 font-bold text-xs uppercase text-blue-600">Cambiar Contraseña (opcional)</label>
                            <input type="text" value={editPass} onChange={e => setEditPass(e.target.value)} placeholder="Dejar vacío para mantener" className={inputCls} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Turno</label>
                                <select value={editingSpec?.shift || "Matutino"} onChange={e => setEditingSpec(p => p ? { ...p, shift: e.target.value } : null)} className={inputCls}>
                                    <option value="Matutino">Matutino</option>
                                    <option value="Vespertino">Vespertino</option>
                                </select>
                            </div>
                            <div>
                                <label className="block mb-1 text-slate-700 font-bold text-xs uppercase">Activo</label>
                                <div className="flex items-center gap-2 h-[46px]">
                                    <input type="checkbox" id="spec-active" checked={editingSpec?.active || false}
                                        onChange={e => setEditingSpec(p => p ? { ...p, active: e.target.checked } : null)}
                                        className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                    <label htmlFor="spec-active" className="text-sm font-bold text-slate-600">Habilitado</label>
                                </div>
                            </div>
                        </div>
                        <div className="pt-4 flex gap-3">
                            <Btn variant="ghost" onClick={() => setEditingSpec(null)} className="flex-1">Cancelar</Btn>
                            <Btn onClick={handleUpdateSpec} className="flex-1 bg-blue-600 shadow-blue-600/20">Guardar Cambios</Btn>
                        </div>
                    </div>
                </Modal>

                {/* ─── Modal de Período (crear / editar / corte) ─── */}
                <Modal
                    open={showPeriodModal}
                    onClose={() => setShowPeriodModal(false)}
                    title={
                        periodModalMode === "create" ? "Nuevo Período" :
                        periodModalMode === "edit" ? "Editar Período" :
                        "Realizar Corte de Datos"
                    }
                    subtitle={
                        periodModalMode === "close"
                            ? `Se cerrará: ${editingPeriod?.name}`
                            : undefined
                    }
                    maxWidth="max-w-lg"
                >
                    {(periodModalMode === "create" || periodModalMode === "edit") && (
                        <div className="space-y-5">
                            <div>
                                <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">
                                    Nombre del período <span className="text-rose-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    value={periodName}
                                    onChange={e => setPeriodName(e.target.value)}
                                    placeholder="Ej. Semestre Feb–Jun 2025"
                                    className={inputCls}
                                />
                            </div>
                            <div>
                                <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">
                                    Rango de fechas <span className="text-rose-500">*</span>
                                    {editingPeriod?.status === "cerrado" && (
                                        <span className="ml-2 text-xs font-normal text-slate-400">(período cerrado — solo editable el nombre)</span>
                                    )}
                                </label>
                                {editingPeriod?.status !== "cerrado" ? (
                                    <div className="flex justify-center rounded-2xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-3">
                                        <Calendar
                                            mode="range"
                                            selected={periodDateRange}
                                            onSelect={setPeriodDateRange}
                                            numberOfMonths={2}
                                            locale={es}
                                            defaultMonth={periodDateRange?.from}
                                        />
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-400 italic px-1">
                                        {editingPeriod.startDate} — {editingPeriod.endDate ?? "sin fecha fin"}
                                    </p>
                                )}
                                {periodDateRange?.from && (
                                    <p className="text-xs text-slate-500 mt-2 px-1">
                                        Seleccionado: {periodDateRange.from.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                                        {periodDateRange.to && ` → ${periodDateRange.to.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}`}
                                    </p>
                                )}
                            </div>
                            {periodModalMode === "create" && unassignedCount > 0 && (
                                <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
                                    <input
                                        type="checkbox"
                                        id="absorb-unassigned"
                                        checked={absorbUnassigned}
                                        onChange={e => setAbsorbUnassigned(e.target.checked)}
                                        className="w-4 h-4 mt-0.5 rounded border-slate-300 text-blue-600 shrink-0"
                                    />
                                    <label htmlFor="absorb-unassigned" className="text-sm text-amber-800 dark:text-amber-300 cursor-pointer">
                                        <span className="font-semibold">Absorber {unassignedCount} cita{unassignedCount !== 1 ? "s" : ""} sin período</span>
                                        <span className="block font-normal mt-0.5 text-amber-700 dark:text-amber-400">
                                            Estas citas quedaron sin clasificar durante el lapso entre períodos y se asignarán a este nuevo período.
                                        </span>
                                    </label>
                                </div>
                            )}
                            <div className="flex gap-3 pt-2">
                                <Btn variant="ghost" onClick={() => setShowPeriodModal(false)} className="flex-1">Cancelar</Btn>
                                <Btn onClick={handleSavePeriod} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20">
                                    {periodModalMode === "create" ? "Crear Período" : "Guardar Cambios"}
                                </Btn>
                            </div>
                        </div>
                    )}

                    {periodModalMode === "close" && (
                        <div className="space-y-6">
                            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 text-sm text-amber-800 dark:text-amber-300">
                                <p className="font-semibold mb-1">¿Confirmar corte de datos?</p>
                                <p>Las citas ya registradas en este período quedarán archivadas. No podrás asignarles otro período después.</p>
                                <p className="mt-1 font-medium">{editingPeriod?._count?.appointments ?? 0} citas serán archivadas en este período.</p>
                            </div>

                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="create-next"
                                    checked={createNextPeriod}
                                    onChange={e => setCreateNextPeriod(e.target.checked)}
                                    className="w-4 h-4 rounded border-slate-300 text-blue-600"
                                />
                                <label htmlFor="create-next" className="text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                                    Crear el siguiente período ahora
                                </label>
                            </div>

                            {createNextPeriod && (
                                <div className="space-y-4 border-t border-slate-100 dark:border-slate-700 pt-4">
                                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Nuevo período</p>
                                    <div>
                                        <label className="block mb-2 text-slate-700 dark:text-slate-300 font-semibold text-sm">
                                            Nombre <span className="text-rose-500">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            value={nextPeriodName}
                                            onChange={e => setNextPeriodName(e.target.value)}
                                            placeholder="Ej. Semestre Ago–Dic 2025"
                                            className={inputCls}
                                        />
                                    </div>
                                    <div>
                                        <label className="block mb-2 text-slate-700 dark:text-slate-300 font-semibold text-sm">Rango de fechas</label>
                                        <div className="flex justify-center rounded-2xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 p-3">
                                            <Calendar
                                                mode="range"
                                                selected={nextPeriodDateRange}
                                                onSelect={setNextPeriodDateRange}
                                                numberOfMonths={2}
                                                locale={es}
                                                defaultMonth={nextPeriodDateRange?.from}
                                            />
                                        </div>
                                        {nextPeriodDateRange?.from && (
                                            <p className="text-xs text-slate-500 mt-2 px-1">
                                                Seleccionado: {nextPeriodDateRange.from.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                                                {nextPeriodDateRange.to && ` → ${nextPeriodDateRange.to.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}`}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <Btn variant="ghost" onClick={() => setShowPeriodModal(false)} className="flex-1">Cancelar</Btn>
                                <Btn onClick={handleClosePeriod} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white border-0">
                                    <Scissors className="w-4 h-4 mr-2" /> Confirmar Corte
                                </Btn>
                            </div>
                        </div>
                    )}
                </Modal>

                {/* ── Baja de personas ─────────────────────────────────────────
                    No es un borrado: la cuenta y su historial clínico se conservan
                    por obligación legal de retención. El modal lo dice explícitamente
                    para que el admin sepa qué está haciendo realmente. */}
                <Modal
                    open={!!(deactivatingSpec || deactivatingUser)}
                    onClose={() => { setDeactivatingSpec(null); setDeactivatingUser(null); setDeactivateReason(""); }}
                    title={deactivatingSpec ? "Dar de baja al especialista" : `Dar de baja al ${endUserLabel.toLowerCase()}`}
                >
                    <div className="space-y-5">
                        <p className="text-slate-700 dark:text-slate-300 text-sm">
                            Estás por dar de baja a <strong>{deactivatingSpec?.name ?? deactivatingUser?.name}</strong>.
                        </p>

                        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-4 text-sm space-y-2">
                            <p className="text-slate-700 dark:text-slate-200">
                                <strong>Perderá el acceso de inmediato</strong> y sus citas pendientes o confirmadas
                                se cancelarán avisando a la otra parte por correo.
                            </p>
                            <p className="text-slate-600 dark:text-slate-300">
                                Su expediente clínico y su historial de citas <strong>se conservan</strong>: la ley
                                obliga a resguardarlos. La cuenta puede reactivarse después.
                            </p>
                        </div>

                        <div>
                            <label className="block mb-2 text-slate-900 dark:text-slate-200 font-bold text-sm">
                                Motivo <span className="text-slate-400 font-normal">(se incluye en el aviso de cancelación)</span>
                            </label>
                            <input
                                type="text"
                                value={deactivateReason}
                                onChange={e => setDeactivateReason(e.target.value)}
                                placeholder="Ej. Cambio de adscripción"
                                className={inputCls}
                            />
                        </div>

                        <div className="flex gap-3">
                            <Btn variant="ghost" className="flex-1"
                                onClick={() => { setDeactivatingSpec(null); setDeactivatingUser(null); setDeactivateReason(""); }}>
                                Cancelar
                            </Btn>
                            <Btn className="flex-1 bg-rose-600 hover:bg-rose-700 text-white border-0"
                                onClick={() => {
                                    const reason = deactivateReason.trim() || undefined;
                                    if (deactivatingSpec) removeSpecialist(deactivatingSpec.id, reason);
                                    else if (deactivatingUser) deleteUser(deactivatingUser.id, reason);
                                    setDeactivatingSpec(null); setDeactivatingUser(null); setDeactivateReason("");
                                }}>
                                <XCircle className="w-4 h-4 mr-2" /> Dar de baja
                            </Btn>
                        </div>
                    </div>
                </Modal>

            </div>
        </AppShell>
    );
}
