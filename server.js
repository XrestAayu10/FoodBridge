// Beginner-friendly local server. Run: node server.js
// It serves the website and stores demo data in data.json.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 8000;
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'data.json');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };

function readDb() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function writeDb(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
function id(prefix) { return `${prefix}_${crypto.randomUUID().slice(0, 8)}`; }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } }); }); }
function reply(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/listings' && req.method === 'GET') {
      const listings = readDb().listings;
      return reply(res, 200, url.searchParams.get('all') === '1' ? listings : listings.filter(x => x.status === 'available'));
    }
    if (url.pathname === '/api/listings' && req.method === 'POST') {
      const input = await body(req); const db = readDb();
      const listing = { id: id('listing'), supplierId: input.supplierId || 'supplier_demo', supplierName: input.supplierName || 'Demo Supplier', foodName: input.foodName, quantity: input.quantity, deadline: input.deadline, location: input.location, safetyConfirmed: Boolean(input.safetyConfirmed), status: 'available', createdAt: new Date().toISOString() };
      if (!listing.foodName || !listing.quantity || !listing.deadline || !listing.location || !listing.safetyConfirmed) return reply(res, 400, { error: 'Complete all fields and confirm food safety.' });
      db.listings.unshift(listing); db.notifications.unshift({ id: id('note'), role: 'organization', message: `New food available: ${listing.foodName}`, read: false }); writeDb(db); return reply(res, 201, listing);
    }
    if (url.pathname === '/api/requests' && req.method === 'POST') {
      const input = await body(req); const db = readDb(); const listing = db.listings.find(x => x.id === input.listingId && x.status === 'available');
      if (!listing) return reply(res, 404, { error: 'This listing is no longer available.' });
      const request = { id: id('request'), listingId: listing.id, organizationName: input.organizationName || 'Hope Relief Nepal', requestedQuantity: input.requestedQuantity || listing.quantity, pickupCode: `AHL-${Math.floor(1000 + Math.random() * 9000)}`, status: 'pending', createdAt: new Date().toISOString() };
      db.requests.unshift(request); listing.status = 'requested'; db.notifications.unshift({ id: id('note'), role: 'supplier', message: `${request.organizationName} requested ${listing.foodName}`, read: false }); writeDb(db); return reply(res, 201, request);
    }
    if (url.pathname.match(/^\/api\/requests\/[^/]+\/accept$/) && req.method === 'POST') {
      const db = readDb(); const request = db.requests.find(x => x.id === url.pathname.split('/')[3]); if (!request) return reply(res, 404, { error: 'Request not found.' });
      request.status = 'accepted'; const listing = db.listings.find(x => x.id === request.listingId); if (listing) listing.status = 'reserved'; db.notifications.unshift({ id: id('note'), role: 'organization', message: `Pickup accepted. Code: ${request.pickupCode}`, read: false }); writeDb(db); return reply(res, 200, request);
    }
    if (url.pathname.match(/^\/api\/requests\/[^/]+\/collect$/) && req.method === 'POST') {
      const db = readDb(); const request = db.requests.find(x => x.id === url.pathname.split('/')[3]); if (!request) return reply(res, 404, { error: 'Request not found.' });
      request.status = 'collected'; const listing = db.listings.find(x => x.id === request.listingId); if (listing) listing.status = 'collected'; db.impact.mealsRescued += Number.parseInt(request.requestedQuantity, 10) || 1; writeDb(db); return reply(res, 200, request);
    }
    if (url.pathname === '/api/requests' && req.method === 'GET') return reply(res, 200, readDb().requests);
    if (url.pathname === '/api/organizations' && req.method === 'GET') { const organizations = readDb().organizations; const email = url.searchParams.get('email'); return reply(res, 200, email ? organizations.filter(x => x.email === email) : organizations); }
    if (url.pathname.match(/^\/api\/organizations\/[^/]+\/approve$/) && req.method === 'POST') { const db = readDb(); const org = db.organizations.find(x => x.id === url.pathname.split('/')[3]); if (!org) return reply(res, 404, { error: 'Organization not found.' }); org.status = 'approved'; writeDb(db); return reply(res, 200, org); }
    if (url.pathname === '/api/auth/register' && req.method === 'POST') { const input = await body(req); const db = readDb(); if (!input.name || !input.email || !input.role) return reply(res, 400, { error: 'Complete every registration field.' }); if (db.users.some(x => x.email === input.email)) return reply(res, 409, { error: 'An account already exists for this email.' }); const user = { id: id('user'), name: input.name, email: input.email, role: input.role, createdAt: new Date().toISOString() }; db.users.push(user); if (input.role === 'organization') db.organizations.push({ id: id('org'), name: input.name, email: input.email, community: 'Not yet provided', document: 'Not submitted', status: 'pending' }); writeDb(db); return reply(res, 201, user); }
    if (url.pathname === '/api/impact' && req.method === 'GET') return reply(res, 200, readDb().impact);

    // Architecture routes share one beginner-friendly page shell. Each path selects its own screen.
    const routes = {
      '/': ['Public','home'], '/index.html': ['Public','home'], '/public/home.html': ['Public','home'], '/public/how-it-works.html': ['Public','how'], '/public/login.html': ['Public','login'], '/public/register.html': ['Public','register'],
      '/supplier/dashboard.html': ['Supplier','supplierDashboard'], '/supplier/post-food.html': ['Supplier','postFood'], '/supplier/my-listings.html': ['Supplier','myListings'], '/supplier/pickup-requests.html': ['Supplier','pickupRequests'], '/supplier/impact.html': ['Supplier','supplierImpact'],
      '/organization/available-food.html': ['Organization','availableFood'], '/organization/my-requests.html': ['Organization','myRequests'], '/organization/pickup-tracking.html': ['Organization','tracking'], '/organization/verification.html': ['Organization','verification'], '/organization/profile.html': ['Organization','profile'],
      '/admin/verification-queue.html': ['Admin','verificationQueue'], '/admin/food-review.html': ['Admin','foodReview'], '/admin/users.html': ['Admin','users'], '/admin/impact-dashboard.html': ['Admin','adminImpact']
    };
    if (routes[url.pathname]) {
      const [group, page] = routes[url.pathname];
      const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${page} | FoodBridge</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="/portal.css"></head><body data-group="${group}" data-page="${page}"><div id="app"></div><script src="/portal.js"></script></body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html);
    }

    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.normalize(path.join(ROOT, requested));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return reply(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); fs.createReadStream(file).pipe(res);
  } catch (error) { reply(res, 500, { error: error.message || 'Server error' }); }
});
server.listen(PORT, () => console.log(`FoodBridge is running at http://localhost:${PORT}`));
