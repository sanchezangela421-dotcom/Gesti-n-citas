-- CreateTable
CREATE TABLE "OrgDepartment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "icon" TEXT NOT NULL DEFAULT 'Stethoscope',
    "requiresNote" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgDepartment_organizationId_active_idx" ON "OrgDepartment"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "OrgDepartment_organizationId_name_key" ON "OrgDepartment"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "OrgDepartment" ADD CONSTRAINT "OrgDepartment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sembrado desde el catálogo fijo anterior.
--
-- Hasta aquí los tres departamentos eran una constante de plataforma y
-- Organization.departments guardaba cuáles tenía contratados cada organización.
-- Ahora cada uno es una fila. Se conserva el NOMBRE EXACTO: es la clave con la
-- que Appointment y ClinicalNote referencian su departamento, y de ella depende
-- la regla de continuidad del expediente.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "OrgDepartment" (
    "id", "organizationId", "name", "color", "icon",
    "requiresNote", "active", "order", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    o."id",
    d."name",
    CASE d."name"
        WHEN 'Psicología' THEN '#2563EB'
        WHEN 'Tutorías'   THEN '#16A34A'
        WHEN 'Nutrición'  THEN '#EA580C'
        ELSE '#64748b'
    END,
    CASE d."name"
        WHEN 'Psicología' THEN 'Brain'
        WHEN 'Tutorías'   THEN 'GraduationCap'
        WHEN 'Nutrición'  THEN 'Apple'
        ELSE 'Stethoscope'
    END,
    -- Psicología y Nutrición son atención clínica (NOM-004); Tutorías no.
    d."name" IN ('Psicología', 'Nutrición'),
    TRUE,
    d."ord"::int,
    NOW(),
    NOW()
FROM "Organization" o
CROSS JOIN LATERAL unnest(o."departments") WITH ORDINALITY AS d("name", "ord")
ON CONFLICT ("organizationId", "name") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Departamentos EN USO que ya no estaban contratados.
--
-- Retirar un departamento nunca canceló lo agendado: el especialista conservaba
-- su acceso y sus citas. Si no les creamos fila, su `requiresNote` se resolvería
-- al valor por defecto y la nota clínica dejaría de ser obligatoria en silencio.
-- Se crean INACTIVOS: existen para resolver metadatos, pero no admiten reservas
-- nuevas, que es exactamente el comportamiento que ya tenían.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "OrgDepartment" (
    "id", "organizationId", "name", "color", "icon",
    "requiresNote", "active", "order", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    u."organizationId",
    u."name",
    CASE u."name"
        WHEN 'Psicología' THEN '#2563EB'
        WHEN 'Tutorías'   THEN '#16A34A'
        WHEN 'Nutrición'  THEN '#EA580C'
        ELSE '#64748b'
    END,
    CASE u."name"
        WHEN 'Psicología' THEN 'Brain'
        WHEN 'Tutorías'   THEN 'GraduationCap'
        WHEN 'Nutrición'  THEN 'Apple'
        ELSE 'Stethoscope'
    END,
    u."name" IN ('Psicología', 'Nutrición'),
    FALSE,
    99,
    NOW(),
    NOW()
FROM (
    SELECT "organizationId", "department" AS "name"
      FROM "Specialist"  WHERE "organizationId" IS NOT NULL AND "department" <> ''
    UNION
    SELECT "organizationId", "department" AS "name"
      FROM "Appointment" WHERE "organizationId" IS NOT NULL AND "department" <> ''
) u
ON CONFLICT ("organizationId", "name") DO NOTHING;
