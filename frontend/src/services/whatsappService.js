/**
 * whatsappService — Genera URLs "wa.me" per enviar missatges als conductors
 */

function formatDataMig(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('ca-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch { return iso; }
}

export function normalitzarTelefon(telefon) {
  if (!telefon) return null;
  let cleaned = telefon.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  if (cleaned.length === 9) cleaned = '34' + cleaned;
  if (cleaned.length < 10) return null;
  return cleaned;
}

function buildDriverLink(transport) {
  return `${window.location.origin}/ruta/${transport.publicToken || transport.id}`;
}

export function construirMissatgeConductor(transport) {
  const t = transport;
  const link = buildDriverLink(t);
  const linies = [];

  linies.push(link);
  linies.push('');

  const primerNom = t.conductor?.nom ? t.conductor.nom.split(' ')[0] : '';
  linies.push(`Hola${primerNom ? ' ' + primerNom : ''}`);
  linies.push('Tens una ruta assignada:');
  linies.push('');

  linies.push(`Projecte: ${t.projecte || 'Transport'}`);

  if (t.dataCarrega && t.horaRecollida) {
    linies.push(`Data: ${formatDataMig(t.dataCarrega)} a les ${t.horaRecollida}`);
  } else if (t.horaRecollida) {
    linies.push(`Recollida a les ${t.horaRecollida}`);
  }

  if (t.origen) linies.push(`Origen: ${t.origen}`);
  if (t.desti) linies.push(`Desti: ${t.desti}`);

  if (t.horaEntregaEstimada) {
    const dataDif = t.dataEntrega && t.dataEntrega !== t.dataCarrega
      ? ` (${formatDataMig(t.dataEntrega)})` : '';
    linies.push(`Entrega estimada: ${t.horaEntregaEstimada}${dataDif}`);
  }

  if (t.responsableProduccio || t.telefonResponsable) {
    linies.push('');
    const contactePart = t.telefonResponsable ? ` (${t.telefonResponsable})` : '';
    linies.push(`Contacte a la nau: ${t.responsableProduccio || ''}${contactePart}`);
  }

  if (t.notesOrigen) linies.push(`\nCarrega: ${t.notesOrigen}`);
  if (t.notesDesti) linies.push(`Entrega: ${t.notesDesti}`);
  if (t.notes) linies.push(`Notes: ${t.notes}`);

  return linies.join('\n');
}

export function enviarViaWhatsapp(transport) {
  const telefon = normalitzarTelefon(transport.conductor?.telefon);
  const text = construirMissatgeConductor(transport);
  const encoded = encodeURIComponent(text);
  const waUrl = telefon
    ? `https://wa.me/${telefon}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
}

export function construirMissatgeEmpresa(transport, empresa = null) {
  const t = transport;
  const link = buildDriverLink(t);
  const nomContacte = empresa?.nomContacte ? empresa.nomContacte.split(' ')[0] : '';
  const linies = [];

  linies.push(`Hola${nomContacte ? ' ' + nomContacte : ''}!`);
  linies.push('');
  linies.push(`Tens un transport assignat a ${t.empresa?.nom || 'la teva empresa'}:`);
  linies.push('');
  linies.push(`Projecte: ${t.projecte || 'Transport'}`);
  if (t.tipusServei) linies.push(`Tipus: ${t.tipusServei}`);
  if (t.dataCarrega && t.horaRecollida) {
    linies.push(`Data: ${formatDataMig(t.dataCarrega)} - recollida ${t.horaRecollida}`);
  }
  if (t.origen) linies.push(`Origen: ${t.origen}`);
  if (t.desti) linies.push(`Desti: ${t.desti}`);
  if (t.horaEntregaEstimada) linies.push(`Entrega estimada: ${t.horaEntregaEstimada}`);
  linies.push(`\nEstat: ${t.estat || 'Pendent'}`);
  if (t.responsableProduccio) {
    const tel = t.telefonResponsable ? ` - ${t.telefonResponsable}` : '';
    linies.push(`Contacte Seito: ${t.responsableProduccio}${tel}`);
  }
  linies.push('');
  linies.push(link);

  return linies.join('\n');
}

export function enviarViaWhatsappEmpresa(transport, empresa) {
  const telefon = normalitzarTelefon(empresa?.telefonContacte);
  const text = construirMissatgeEmpresa(transport, empresa);
  const encoded = encodeURIComponent(text);
  const waUrl = telefon
    ? `https://wa.me/${telefon}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`;
  window.open(waUrl, '_blank', 'noopener,noreferrer');
}

export function copyDriverLink(transport) {
  const link = buildDriverLink(transport);
  navigator.clipboard?.writeText(link);
}
