-- Camp per marcar moviments que ja han tingut el justificant copiat a la Dropzone de Qonto
ALTER TABLE "bank_movements" ADD COLUMN "dropzoneSentAt" TIMESTAMP(3);
