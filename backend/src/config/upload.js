const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// Directori d'uploads
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

// Configuració d'emmagatzematge
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Nom únic: timestamp + random + extensió original
    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// Filtre per tipus de fitxer
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipus de fitxer no permès: ${file.mimetype}. Només PDF, JPEG, PNG i WebP.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB màxim
  },
});

module.exports = { upload, UPLOAD_DIR };
