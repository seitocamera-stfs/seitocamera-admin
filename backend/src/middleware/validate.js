const { ZodError } = require('zod');

/**
 * Middleware de validació amb Zod
 * Ús: validate(loginSchema) com a middleware de ruta
 */
function validate(schema) {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        }));
        // Missatge més informatiu: inclou el primer camp invàlid
        const firstError = errors[0];
        const errorMsg = firstError
          ? `Dades invàlides: ${firstError.field} — ${firstError.message}`
          : 'Dades invàlides';
        return res.status(400).json({
          error: errorMsg,
          details: errors,
        });
      }
      next(error);
    }
  };
}

module.exports = { validate };
