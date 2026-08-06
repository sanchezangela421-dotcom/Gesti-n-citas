-- Departamentos contratados por organización.
--
-- El catálogo de departamentos es fijo a nivel de plataforma (Psicología,
-- Tutorías y Nutrición): las organizaciones no definen los suyos. Lo único que
-- varía es cuáles tiene contratados cada una, así que basta una lista de
-- nombres en la propia organización — sin tabla ni llaves foráneas nuevas.
--
-- El DEFAULT hace que todas las organizaciones existentes conserven los tres:
-- nada cambia para nadie hasta que el superadmin desactive alguno.
ALTER TABLE "Organization"
  ADD COLUMN "departments" TEXT[] NOT NULL
  DEFAULT ARRAY['Psicología', 'Tutorías', 'Nutrición']::TEXT[];
