/**
 * Plataformes conegudes que envien factures per email
 * sense adjuntar el PDF directament.
 *
 * Per cada plataforma:
 *   - domains: dominis de remitent que identifiquen la plataforma
 *   - name: nom visible
 *   - billingUrl: URL on es pot descarregar la factura
 *   - instructions: instruccions per a l'usuari
 *   - keywords: paraules extra que ajuden a detectar-la
 */

const KNOWN_PLATFORMS = [
  {
    name: 'Amazon / Amazon Business',
    domains: ['amazon.es', 'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazonbusiness.eu'],
    billingUrl: 'https://www.amazon.es/gp/css/order-history',
    instructions: 'Entrar a Amazon > Comandes > Descarregar factura del producte',
    keywords: ['order', 'comanda', 'shipment', 'enviament'],
  },
  {
    name: 'Adobe',
    domains: ['adobe.com', 'adobesign.com'],
    billingUrl: 'https://account.adobe.com/plans',
    instructions: 'Entrar a Adobe > Account > Plans & Billing > Billing History > Descarregar factura',
    keywords: ['subscription', 'creative cloud', 'acrobat'],
  },
  {
    name: 'Google / Google Workspace',
    domains: ['google.com', 'google.es', 'googlecommerce.com', 'google-invoice.com'],
    billingUrl: 'https://payments.google.com/payments/u/0/home#paymentMethods',
    instructions: 'Entrar a Google Payments > Subscripcions i serveis > Descarregar factura',
    keywords: ['google workspace', 'google ads', 'google cloud', 'youtube'],
  },
  {
    name: 'Meta / Facebook Ads',
    domains: ['facebookmail.com', 'meta.com', 'facebook.com', 'instagram.com'],
    billingUrl: 'https://business.facebook.com/billing_hub/payment_activity',
    instructions: 'Entrar a Meta Business Suite > Billing > Payment Activity > Descarregar factura',
    keywords: ['ad spend', 'publicitat', 'advertising', 'campaign'],
  },
  {
    name: 'Stripe',
    domains: ['stripe.com'],
    billingUrl: 'https://dashboard.stripe.com/settings/billing',
    instructions: 'Entrar a Stripe Dashboard > Settings > Billing > Invoices',
    keywords: ['payment', 'charge', 'subscription'],
  },
  {
    name: 'OpenAI',
    domains: ['openai.com'],
    billingUrl: 'https://platform.openai.com/account/billing/history',
    instructions: 'Entrar a OpenAI > Billing > Invoice history > Descarregar factura',
    keywords: ['api usage', 'chatgpt', 'gpt-4'],
  },
  {
    name: 'Anthropic',
    domains: ['anthropic.com'],
    billingUrl: 'https://console.anthropic.com/settings/billing',
    instructions: 'Entrar a Anthropic Console > Settings > Billing > Descarregar factura',
    keywords: ['api usage', 'claude'],
  },
  {
    name: 'Apple',
    domains: ['apple.com', 'itunes.com', 'email.apple.com'],
    billingUrl: 'https://reportaproblem.apple.com/',
    instructions: 'Entrar a Apple ID > Purchase History o reportaproblem.apple.com > Descarregar factura',
    keywords: ['app store', 'icloud', 'apple music', 'subscription'],
  },
  {
    name: 'Microsoft / Office 365',
    domains: ['microsoft.com', 'microsoftonline.com', 'office.com', 'azure.com'],
    billingUrl: 'https://admin.microsoft.com/AdminPortal/Home#/billoverview',
    instructions: 'Entrar a Microsoft 365 Admin > Billing > Bills & Payments > Descarregar factura',
    keywords: ['office 365', 'azure', 'microsoft 365', 'teams'],
  },
  {
    name: 'Mailchimp',
    domains: ['mailchimp.com', 'intuit.com'],
    billingUrl: 'https://admin.mailchimp.com/account/billing-history/',
    instructions: 'Entrar a Mailchimp > Account > Billing > Billing history',
    keywords: ['campaign', 'email marketing'],
  },
  {
    name: 'Zoom',
    domains: ['zoom.us', 'zoom.com'],
    billingUrl: 'https://zoom.us/billing',
    instructions: 'Entrar a Zoom > Admin > Billing > Invoice History',
    keywords: ['meeting', 'webinar', 'subscription'],
  },
  {
    name: 'Dropbox',
    domains: ['dropbox.com', 'dropboxmail.com'],
    billingUrl: 'https://www.dropbox.com/account/billing',
    instructions: 'Entrar a Dropbox > Settings > Billing > Invoices',
    keywords: ['storage', 'subscription'],
  },
  {
    name: 'Canva',
    domains: ['canva.com'],
    billingUrl: 'https://www.canva.com/settings/billing',
    instructions: 'Entrar a Canva > Account Settings > Billing & Plans',
    keywords: ['design', 'subscription'],
  },
  {
    name: 'Shopify',
    domains: ['shopify.com'],
    billingUrl: 'https://admin.shopify.com/store/settings/billing',
    instructions: 'Entrar a Shopify Admin > Settings > Billing > View all bills',
    keywords: ['store', 'plan', 'subscription'],
  },
  {
    name: 'OVH / OVHcloud',
    domains: ['ovh.com', 'ovhcloud.com', 'ovh.es'],
    billingUrl: 'https://www.ovh.com/manager/#/dedicated/billing/history',
    instructions: 'Entrar a OVH Manager > Billing > My invoices',
    keywords: ['hosting', 'server', 'domain', 'cloud'],
  },
  {
    name: 'Hetzner',
    domains: ['hetzner.com', 'hetzner.de'],
    billingUrl: 'https://accounts.hetzner.com/invoices',
    instructions: 'Entrar a Hetzner > Invoices > Descarregar PDF',
    keywords: ['server', 'cloud', 'hosting'],
  },
  {
    name: 'PayPal',
    domains: ['paypal.com', 'paypal.es'],
    billingUrl: 'https://www.paypal.com/myaccount/transactions/',
    instructions: 'Entrar a PayPal > Activitat > Seleccionar transacció > Descarregar factura/rebut',
    keywords: ['payment', 'receipt', 'transaction'],
  },
  {
    name: 'Rentman',
    domains: ['rentman.io', 'rentman.net'],
    billingUrl: 'https://app.rentman.io',
    instructions: 'Entrar a Rentman > Settings > Billing > Invoices',
    keywords: ['subscription', 'rental software'],
  },
  {
    name: 'Qonto',
    domains: ['qonto.com', 'qonto.eu'],
    billingUrl: 'https://app.qonto.com/transactions',
    instructions: 'Entrar a Qonto > Transactions > Descarregar factura/rebut',
    keywords: ['bank', 'transaction', 'payment'],
  },
];

/**
 * Busca una plataforma coneguda pel domini del remitent
 * @param {string} fromAddress - Adreça email del remitent
 * @returns {Object|null} - Plataforma trobada o null
 */
function findPlatformByEmail(fromAddress) {
  if (!fromAddress) return null;
  const emailLower = fromAddress.toLowerCase();
  const domain = emailLower.split('@')[1];
  if (!domain) return null;

  return KNOWN_PLATFORMS.find((p) =>
    p.domains.some((d) => domain === d || domain.endsWith('.' + d))
  ) || null;
}

/**
 * Busca una plataforma pel contingut del subject o body
 * @param {string} text - Text a analitzar (subject + body)
 * @returns {Object|null} - Plataforma trobada o null
 */
function findPlatformByContent(text) {
  if (!text) return null;
  const textLower = text.toLowerCase();

  // Buscar per nom de plataforma al text
  return KNOWN_PLATFORMS.find((p) =>
    textLower.includes(p.name.toLowerCase().split(' / ')[0]) ||
    p.keywords.some((kw) => textLower.includes(kw.toLowerCase()))
  ) || null;
}

module.exports = {
  KNOWN_PLATFORMS,
  findPlatformByEmail,
  findPlatformByContent,
};
