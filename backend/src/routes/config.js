const express = require('express');
const company = require('../config/company');

const router = express.Router();

/**
 * GET /api/config/company — Informació pública de l'empresa (per al frontend)
 * No requereix autenticació perquè es necessita a la pantalla de login
 */
router.get('/company', (req, res) => {
  res.json({
    name: company.name,
    legalName: company.legalName,
    appName: company.appName,
  });
});

module.exports = router;
