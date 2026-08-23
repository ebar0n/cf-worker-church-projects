-- El tope diario pasa a ser por actividad: `kind` guarda '<actividad>:<tipo>'
-- (p. ej. 'pr39:card'). Todas las filas anteriores son del cap. 39.
UPDATE adventurers_interactions SET kind = 'pr39:quiz' WHERE kind = 'quiz';
UPDATE adventurers_interactions SET kind = 'pr39:card' WHERE kind IN ('card', '');
