// ===========================================
// Cron job: enviament de recordatoris de tasques
// ===========================================
//
// Cada 5 min revisa les tasques amb `reminder ≠ NONE`, calcula quan
// s'ha d'enviar el recordatori i envia el missatge pels canals
// configurats per cada usuari assignat (de moment: Telegram).
//
// Política:
//   - Només tasques amb dueAt + dueTime (cal hora exacta per al recordatori)
//   - Només tasques no completades ni cancel·lades
//   - Marca a TaskReminderSent per evitar duplicats
//   - Si la finestra ja ha passat (>10 min), NO enviem (massa tard)
// ===========================================

const cron = require('node-cron');
const { prisma } = require('../config/database');
const { logger } = require('../config/logger');
const tg = require('../services/telegramService');

// Quants minuts abans del recordatori comencem a buscar (finestra de tolerància)
const WINDOW_BEFORE_MIN = 0;     // no enviem abans
const WINDOW_AFTER_MIN  = 10;    // si han passat ≤10 min de l'hora prevista, encara enviem

let isRunning = false;

/**
 * Calcula l'instant en què s'ha d'enviar el recordatori per una tasca.
 * Retorna null si no se sap (ex: dueAt sense dueTime).
 */
function computeReminderInstant(task) {
  if (!task.dueAt || !task.dueTime) return null;
  // Combinem dueAt (data) amb dueTime (HH:MM)
  const [hh, mm] = String(task.dueTime).split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;

  const due = new Date(task.dueAt);
  // Forcem l'hora local del servidor (Europe/Madrid)
  due.setHours(hh, mm, 0, 0);

  switch (task.reminder) {
    case 'AT_TIME':
      return due;
    case 'HOUR_BEFORE':
      return new Date(due.getTime() - 60 * 60 * 1000);
    case 'DAY_BEFORE':
      return new Date(due.getTime() - 24 * 60 * 60 * 1000);
    case 'CUSTOM': {
      // reminderCustom format ex: "30m", "2h", "1d"
      const m = String(task.reminderCustom || '').match(/^(\d+)\s*([mhd])$/);
      if (!m) return null;
      const n = parseInt(m[1]);
      const unit = m[2];
      const factor = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
      return new Date(due.getTime() - n * factor);
    }
    default:
      return null;
  }
}

/**
 * Construeix el text del missatge de recordatori (MarkdownV2).
 */
function formatReminderMessage(task, user) {
  const e = tg.mdv2Escape;
  const dueDate = task.dueAt ? new Date(task.dueAt).toLocaleDateString('ca-ES', {
    weekday: 'short', day: 'numeric', month: 'short',
  }) : null;

  const lines = [];
  lines.push(`🔔 *Recordatori SeitoCamera*`);
  lines.push('');
  lines.push(`📋 *${e(task.title)}*`);
  if (task.project?.name) lines.push(`🎬 ${e('Projecte:')} ${e(task.project.name)}`);
  if (dueDate) lines.push(`⏰ ${e(dueDate)}${task.dueTime ? ` ${e(task.dueTime)}` : ''}`);

  const otherAssignees = (task.assignees || [])
    .map(a => a.user?.name)
    .filter(n => n && n !== user.name);
  if (otherAssignees.length > 0) {
    lines.push(`👥 ${e('També:')} ${e(otherAssignees.join(', '))}`);
  }

  if (task.description) {
    const desc = task.description.length > 200 ? task.description.slice(0, 200) + '...' : task.description;
    lines.push('');
    lines.push(`_${e(desc)}_`);
  }

  // Link a la tasca (si tenim FRONTEND_URL)
  const front = process.env.FRONTEND_URL;
  if (front) {
    lines.push('');
    lines.push(`[Veure tasca](${front.replace(/\/$/, '')}/operations/tasks?taskId=${task.id})`);
  }

  return lines.join('\n');
}

/**
 * Itera per les tasques pendents de recordatori i envia.
 */
async function runTaskReminders() {
  if (isRunning) {
    logger.debug('Task reminders: ja s\'està executant, s\'omet');
    return;
  }
  if (!tg.isEnabled()) {
    logger.debug('Task reminders: Telegram no configurat, s\'omet');
    return;
  }

  isRunning = true;
  const now = new Date();
  const windowFloor = new Date(now.getTime() - WINDOW_AFTER_MIN * 60_000);
  const windowCeil  = new Date(now.getTime() + WINDOW_BEFORE_MIN * 60_000);

  let sent = 0, errors = 0;
  try {
    // Tasques amb recordatori pendent (dueAt al futur o recent passat)
    const candidates = await prisma.projectTask.findMany({
      where: {
        reminder: { not: 'NONE' },
        completedAt: null,
        status: { notIn: ['OP_DONE'] },
        dueAt: {
          // Reduïm el càlcul: només tasques amb dueAt entre ahir i d'aquí 7 dies
          gte: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      },
      include: {
        project: { select: { name: true } },
        assignees: {
          include: {
            user: {
              select: {
                id: true, name: true, telegramChatId: true, notifyTelegram: true,
              },
            },
          },
        },
        assignedTo: {
          select: { id: true, name: true, telegramChatId: true, notifyTelegram: true },
        },
        remindersSent: {
          select: { userId: true, channel: true, kind: true },
        },
      },
      take: 500,
    });

    for (const task of candidates) {
      const instant = computeReminderInstant(task);
      if (!instant) continue;
      // Hem d'estar dins la finestra (instant ∈ [windowFloor, windowCeil])
      if (instant < windowFloor || instant > windowCeil) continue;

      // Recopilar destinataris únics (assignees + assignedTo legacy, deduplicats)
      const usersById = new Map();
      for (const a of task.assignees || []) {
        if (a.user) usersById.set(a.user.id, a.user);
      }
      if (task.assignedTo) usersById.set(task.assignedTo.id, task.assignedTo);

      for (const user of usersById.values()) {
        if (!user.telegramChatId) continue;
        if (!user.notifyTelegram) continue;

        // Ja enviat?
        const already = task.remindersSent.some(r =>
          r.userId === user.id && r.channel === 'telegram' && r.kind === task.reminder
        );
        if (already) continue;

        try {
          const text = formatReminderMessage(task, user);
          await tg.sendMessage(user.telegramChatId, text);
          await prisma.taskReminderSent.create({
            data: {
              taskId: task.id,
              userId: user.id,
              channel: 'telegram',
              kind: task.reminder,
            },
          });
          sent++;
        } catch (err) {
          errors++;
          // Si Telegram diu "chat not found" o "blocked", desvinculem
          if (/chat not found|bot was blocked|user is deactivated/i.test(err.message)) {
            await prisma.user.update({
              where: { id: user.id },
              data: { telegramChatId: null, telegramUsername: null, telegramLinkedAt: null },
            });
            logger.warn(`Telegram: chat invàlid per ${user.name} (${err.message}) — desvinculat`);
          } else {
            logger.error(`Telegram reminder error per task=${task.id} user=${user.id}: ${err.message}`);
          }
        }
      }
    }

    if (sent > 0 || errors > 0) {
      logger.info(`Task reminders: ${sent} enviats, ${errors} errors`);
    }
  } catch (err) {
    logger.error(`Task reminders: error general: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

function startTaskReminderJob() {
  if (!tg.isEnabled()) {
    logger.info('Task reminders: Telegram no configurat, cron desactivat');
    return null;
  }
  // Cada 5 min, tots els dies
  const task = cron.schedule('*/5 * * * *', runTaskReminders, { timezone: 'Europe/Madrid' });
  logger.info('Task reminders: cron activat (cada 5 min)');
  // Execució inicial després d'1 min
  setTimeout(() => runTaskReminders().catch(e => logger.error(`Task reminders initial: ${e.message}`)), 60_000);
  return task;
}

module.exports = { startTaskReminderJob, runTaskReminders };
