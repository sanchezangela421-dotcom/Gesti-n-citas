-- organizationId nullable en OrgLocation (consistente con el resto: soporta orgs legacy null).
ALTER TABLE "OrgLocation" ALTER COLUMN "organizationId" DROP NOT NULL;
