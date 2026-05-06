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

// Filtre per tipus de fitxer (factures, restrictiu)
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

// ===========================================
// Storage / upload per a adjunts de tasca (més permissiu)
// ===========================================
const TASK_ATTACHMENTS_DIR = path.join(__dirname, '../../uploads/task-attachments');

const fs = require('fs');
if (!fs.existsSync(TASK_ATTACHMENTS_DIR)) fs.mkdirSync(TASK_ATTACHMENTS_DIR, { recursive: true });

const taskAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Subcarpeta per taskId per organització
    const taskId = req.params.id || 'shared';
    const taskDir = path.join(TASK_ATTACHMENTS_DIR, taskId.replace(/[^a-zA-Z0-9]/g, ''));
    if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
    cb(null, taskDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// Filtre permissiu per adjunts de tasca: imatges + PDFs + docs Office + text
const taskAttachmentFilter = (req, file, cb) => {
  const allowed = [
    // PDFs i imatges
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    // Documents Office
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    // Text
    'text/plain', 'text/csv', 'text/markdown',
    // Comprimits
    'application/zip', 'application/x-zip-compressed', 'application/x-7z-compressed',
    'application/x-rar-compressed',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipus de fitxer no permès: ${file.mimetype}`), false);
  }
};

const taskAttachmentUpload = multer({
  storage: taskAttachmentStorage,
  fileFilter: taskAttachmentFilter,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB per als adjunts
  },
});

module.exports = { upload, UPLOAD_DIR, taskAttachmentUpload, TASK_ATTACHMENTS_DIR };
