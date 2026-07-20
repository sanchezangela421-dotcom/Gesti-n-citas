import { motion, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useRef, useState } from "react";

// Curva de salida estándar de la app — arranque rápido, asentamiento suave.
const EASE = [0.22, 1, 0.36, 1] as const;

// ─── Reveal ──────────────────────────────────────────────
// Fade + desplazamiento vertical al montar. Para secciones/cards sueltas.
export function Reveal({
    children, className = "", delay = 0, y = 12,
}: { children: React.ReactNode; className?: string; delay?: number; y?: number }) {
    const reduce = useReducedMotion();
    return (
        <motion.div
            className={className}
            initial={reduce ? false : { opacity: 0, y }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay, ease: EASE }}
        >
            {children}
        </motion.div>
    );
}

// ─── Stagger ─────────────────────────────────────────────
// Contenedor que escalona la entrada de sus <StaggerItem> hijos.
const containerVariants: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

export function Stagger({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    const reduce = useReducedMotion();
    if (reduce) return <div className={className}>{children}</div>;
    return (
        <motion.div className={className} variants={containerVariants} initial="hidden" animate="show">
            {children}
        </motion.div>
    );
}

// `y={0}` → fade sin translación. Úsalo dentro de contenedores con overflow-y-auto
// (modales) para que la translación no extienda el área scrollable y dispare la barra.
export function StaggerItem({ children, className = "", y = 12 }: { children: React.ReactNode; className?: string; y?: number }) {
    const reduce = useReducedMotion();
    if (reduce) return <div className={className}>{children}</div>;
    const variants: Variants = {
        hidden: { opacity: 0, y },
        show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
    };
    return <motion.div className={className} variants={variants}>{children}</motion.div>;
}

// ─── useCountUp ──────────────────────────────────────────
// Anima un entero de 0 al objetivo con easing. Respeta reduced-motion.
export function useCountUp(target: number, duration = 900): number {
    const reduce = useReducedMotion();
    const [val, setVal] = useState(reduce ? target : 0);
    const frame = useRef<number | undefined>(undefined);

    useEffect(() => {
        if (reduce || !Number.isFinite(target)) { setVal(target); return; }
        const start = performance.now();
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
            setVal(Math.round(target * eased));
            if (t < 1) frame.current = requestAnimationFrame(tick);
        };
        frame.current = requestAnimationFrame(tick);
        return () => { if (frame.current) cancelAnimationFrame(frame.current); };
    }, [target, duration, reduce]);

    return val;
}

// ─── Skeleton ────────────────────────────────────────────
// Placeholder de carga con pulso suave (evita el "salto" de datos al hacer poll).
export function Skeleton({ className = "" }: { className?: string }) {
    return <div className={`animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-700/40 ${className}`} />;
}
