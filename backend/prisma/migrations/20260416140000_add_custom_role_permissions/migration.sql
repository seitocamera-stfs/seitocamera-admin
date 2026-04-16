-- Afegir valor CUSTOM a l'enum Role
-- (ha d'anar sol a la seva migració — PostgreSQL no permet afegir valor
-- a un enum i usar-lo a la mateixa transacció)
ALTER TYPE "Role" ADD VALUE 'CUSTOM';
