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
        return res.status(400).json({
          error: 'Dades invàlides',
          details: errors,
        });
      }
      next(error);
    }
  };
}

module.exports = { validate };
