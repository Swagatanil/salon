const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const DEFAULT_SLOT_CAPACITY = 2;
const MAX_BOOKINGS_PER_PHONE_PER_DAY = 5;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(), ...extraHeaders },
  });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  };
}

function clean(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return '';
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function todayInIndia() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function slotCapacity(env) {
  const parsed = Number.parseInt(env.SLOT_CAPACITY ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SLOT_CAPACITY;
}

const SALON_OPEN_MINUTES = 8 * 60; // 8:00 AM
const SALON_CLOSE_MINUTES = 20 * 60; // last slot start 8:00 PM (salon shuts 8:30 PM)
const SLOT_STEP_MINUTES = 30;

function generateSlotTimes() {
  const times = [];
  for (let m = SALON_OPEN_MINUTES; m <= SALON_CLOSE_MINUTES; m += SLOT_STEP_MINUTES) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    times.push(`${hh}:${mm}`);
  }
  return times;
}

function isSunday(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay() === 0;
}

function nowMinutesInIndia() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function isAdmin(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (provided.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i += 1) diff |= provided.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

function withImageUrl(row) {
  return { ...row, image_url: row.image_key ? `/api/images/${row.image_key}` : '' };
}

// Photos seedha database (D1) mein base64 text ke roop mein store hoti hain —
// R2 ya kisi alag paid storage ki zaroorat nahi.
const MAX_IMAGE_BYTES = 650 * 1024; // ~650KB raw file (database mein jagah bachane ke liye)

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function uploadImage(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Upload sahi format mein nahi mila.' }, 400);
  }
  const file = form.get('file');

  if (!file || typeof file === 'string') return json({ error: 'Photo chuniye.' }, 400);
  if (!file.type || !file.type.startsWith('image/')) return json({ error: 'Sirf image files (jpg/png/webp) chalengi.' }, 400);
  if (file.size > MAX_IMAGE_BYTES) {
    return json({ error: `Photo bahut badi hai (max ${Math.round(MAX_IMAGE_BYTES / 1024)}KB). Kripya photo ko compress/resize karke dobara try karein.` }, 400);
  }

  const base64 = arrayBufferToBase64(await file.arrayBuffer());
  const inserted = await env.DB.prepare(
    'INSERT INTO images (data, content_type) VALUES (?1, ?2) RETURNING id'
  ).bind(base64, file.type).first();

  const key = String(inserted.id);
  return json({ key, url: `/api/images/${key}` }, 201);
}

async function serveImage(env, key) {
  const id = Number.parseInt(key, 10);
  if (!Number.isInteger(id)) return json({ error: 'Photo nahi mili.' }, 404);
  const row = await env.DB.prepare('SELECT data, content_type FROM images WHERE id = ?1').bind(id).first();
  if (!row) return json({ error: 'Photo nahi mili.' }, 404);
  return new Response(base64ToArrayBuffer(row.data), {
    headers: {
      'content-type': row.content_type ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      ...corsHeaders(),
    },
  });
}

async function deleteImage(env, key) {
  const id = Number.parseInt(key, 10);
  if (Number.isInteger(id)) {
    try { await env.DB.prepare('DELETE FROM images WHERE id = ?1').bind(id).run(); } catch { /* ignore */ }
  }
}

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const map = Object.fromEntries(results.map((r) => [r.key, r.value]));
  return json({
    notice_active: map.notice_active === '1',
    notice_text: map.notice_text ?? '',
    hero_image_key: map.hero_image_key ?? '',
    hero_image_url: map.hero_image_key ? `/api/images/${map.hero_image_key}` : '',
    about_image_key: map.about_image_key ?? '',
    about_image_url: map.about_image_key ? `/api/images/${map.about_image_key}` : '',
    logo_image_key: map.logo_image_key ?? '',
    logo_image_url: map.logo_image_key ? `/api/images/${map.logo_image_key}` : '',
  });
}

async function updateSettings(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Request body galat hai.' }, 400);

  const updates = [];
  if ('notice_active' in body) updates.push(['notice_active', body.notice_active ? '1' : '0']);
  if ('notice_text' in body) updates.push(['notice_text', clean(body.notice_text, 300)]);
  if ('hero_image_key' in body) updates.push(['hero_image_key', clean(body.hero_image_key, 200)]);
  if ('about_image_key' in body) updates.push(['about_image_key', clean(body.about_image_key, 200)]);
  if ('logo_image_key' in body) updates.push(['logo_image_key', clean(body.logo_image_key, 200)]);

  for (const [key, value] of updates) {
    if (key === 'hero_image_key' || key === 'about_image_key' || key === 'logo_image_key') {
      const old = await env.DB.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first();
      if (old?.value && old.value !== value) await deleteImage(env, old.value);
    }
    await env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2'
    ).bind(key, value).run();
  }

  return getSettings(env);
}

async function listGallery(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, image_key, label, sort_order FROM gallery_images ORDER BY sort_order, id'
  ).all();
  return json({ images: results.map((r) => ({ ...r, url: `/api/images/${r.image_key}` })) });
}

async function addGalleryImage(request, env) {
  const body = await readJson(request);
  if (!body?.image_key) return json({ error: 'Pehle photo upload karein, phir yeh call karein.' }, 400);
  const label = clean(body.label, 80);
  const sortOrder = Number.parseInt(body.sort_order ?? 99, 10);
  const inserted = await env.DB.prepare(
    'INSERT INTO gallery_images (image_key, label, sort_order) VALUES (?1, ?2, ?3) RETURNING id'
  ).bind(clean(body.image_key, 200), label, sortOrder).first();
  return json(inserted, 201);
}

async function deleteGalleryImage(env, id) {
  const row = await env.DB.prepare('SELECT image_key FROM gallery_images WHERE id = ?1').bind(id).first();
  if (!row) return json({ error: 'Photo nahi mili.' }, 404);
  await env.DB.prepare('DELETE FROM gallery_images WHERE id = ?1').bind(id).run();
  await deleteImage(env, row.image_key);
  return json({ ok: true });
}

async function dailyBookingSummary(env) {
  const { results } = await env.DB.prepare(
    `SELECT booking_date AS date, COUNT(*) AS count
     FROM bookings WHERE status != 'cancelled'
     GROUP BY booking_date ORDER BY booking_date DESC LIMIT 30`
  ).all();
  return json({ days: results });
}

const CLEANUP_AFTER_DAYS = 30;

async function cleanupOldData(env) {
  const oldRows = await env.DB.prepare(
    `SELECT id FROM bookings WHERE booking_date < date('now', ?1)`
  ).bind(`-${CLEANUP_AFTER_DAYS} days`).all();
  await env.DB.prepare(
    `DELETE FROM bookings WHERE booking_date < date('now', ?1)`
  ).bind(`-${CLEANUP_AFTER_DAYS} days`).run();
  return oldRows.results.length;
}

async function manualCleanup(env) {
  const deleted = await cleanupOldData(env);
  return json({ ok: true, deleted, message: `${deleted} purani booking(s) delete ho gayi.` });
}

async function listServices(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, description, price, icon, image_key FROM services WHERE active = 1 ORDER BY sort_order, id'
  ).all();
  return json({ services: results.map(withImageUrl) });
}

async function listReviews(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, rating, message, created_at FROM feedback WHERE approved = 1 ORDER BY id DESC LIMIT 20'
  ).all();
  const summary = await env.DB.prepare(
    'SELECT COUNT(*) AS total, AVG(rating) AS average FROM feedback WHERE approved = 1'
  ).first();
  return json({
    reviews: results,
    total: summary?.total ?? 0,
    average: summary?.total ? Math.round(summary.average * 10) / 10 : null,
  });
}

async function availability(env, url) {
  const date = clean(url.searchParams.get('date'), 10);
  if (!isValidDate(date)) return json({ error: 'Date galat hai (YYYY-MM-DD chahiye).' }, 400);

  const capacity = slotCapacity(env);

  if (isSunday(date)) {
    return json({ date, capacity, closed: true, slots: [] });
  }

  const { results } = await env.DB.prepare(
    `SELECT booking_time AS time, seat_number AS seat FROM bookings
     WHERE booking_date = ?1 AND status != 'cancelled'`
  ).bind(date).all();

  const takenSeatsByTime = new Map();
  for (const row of results) {
    if (!takenSeatsByTime.has(row.time)) takenSeatsByTime.set(row.time, new Set());
    takenSeatsByTime.get(row.time).add(row.seat);
  }

  const today = todayInIndia();
  const nowMinutes = date === today ? nowMinutesInIndia() : -1;

  const slots = generateSlotTimes().map((time) => {
    const [hh, mm] = time.split(':').map(Number);
    const slotMinutes = hh * 60 + mm;
    const past = date === today && slotMinutes <= nowMinutes;
    const takenSeats = takenSeatsByTime.get(time) ?? new Set();
    const seats = Array.from({ length: capacity }, (_, i) => i + 1)
      .map((number) => ({ number, taken: past || takenSeats.has(number) }));
    const full = seats.every((s) => s.taken);
    return { time, past, full, seats };
  });

  return json({ date, capacity, closed: false, slots });
}

async function createBooking(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Request body galat hai.' }, 400);

  const name = clean(body.name, 80);
  const phone = normalizePhone(body.phone);
  const service = clean(body.service, 120);
  const date = clean(body.date, 10);
  const time = clean(body.time, 5);
  const note = clean(body.note, 300);
  const capacity = slotCapacity(env);
  const seatNumber = Number.parseInt(body.seat, 10);

  if (name.length < 2) return json({ error: 'Kripya apna poora naam likhein.' }, 400);
  if (!phone) return json({ error: 'Mobile number 10 ank ka hona chahiye.' }, 400);
  if (!service) return json({ error: 'Service chuniye.' }, 400);
  if (!isValidDate(date)) return json({ error: 'Date sahi format mein chuniye.' }, 400);
  if (!isValidTime(time)) return json({ error: 'Time sahi format mein chuniye.' }, 400);
  if (date < todayInIndia()) return json({ error: 'Beeti hui date par booking nahi ho sakti.' }, 400);
  if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > capacity) {
    return json({ error: 'Kripya ek seat chuniye.' }, 400);
  }

  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM bookings
     WHERE phone = ?1 AND created_at > datetime('now', '-1 day') AND status != 'cancelled'`
  ).bind(phone).first();
  if ((recent?.count ?? 0) >= MAX_BOOKINGS_PER_PHONE_PER_DAY) {
    return json({ error: 'Is number se bahut saari booking ho chuki hain. Kripya call karein.' }, 429);
  }

  const takenSeat = await env.DB.prepare(
    `SELECT id FROM bookings
     WHERE booking_date = ?1 AND booking_time = ?2 AND seat_number = ?3 AND status != 'cancelled'`
  ).bind(date, time, seatNumber).first();
  if (takenSeat) {
    return json({ error: 'Yeh seat kisi aur ne le li! Kripya doosri seat ya time chuniye.' }, 409);
  }

  let inserted;
  try {
    inserted = await env.DB.prepare(
      `INSERT INTO bookings (name, phone, service, booking_date, booking_time, seat_number, note)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id, status, seat_number`
    ).bind(name, phone, service, date, time, seatNumber, note).first();
  } catch (error) {
    if (String(error).includes('UNIQUE')) {
      return json({ error: 'Yeh seat abhi-abhi book ho gayi! Kripya doosri seat chuniye.' }, 409);
    }
    throw error;
  }

  return json({
    id: inserted.id,
    status: inserted.status,
    seat: inserted.seat_number,
    message: 'Booking mil gayi! Hum jaldi confirm karenge.',
  }, 201);
}

async function createFeedback(request, env) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Request body galat hai.' }, 400);

  const name = clean(body.name, 80);
  const message = clean(body.message, 600);
  const rating = Number.parseInt(body.rating ?? 5, 10);

  if (name.length < 2) return json({ error: 'Kripya apna naam likhein.' }, 400);
  if (message.length < 3) return json({ error: 'Kripya apna feedback likhein.' }, 400);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return json({ error: 'Rating 1 se 5 ke beech honi chahiye.' }, 400);
  }

  const inserted = await env.DB.prepare(
    'INSERT INTO feedback (name, rating, message) VALUES (?1, ?2, ?3) RETURNING id'
  ).bind(name, rating, message).first();

  return json({ id: inserted.id, message: 'Feedback ke liye dhanyawad!' }, 201);
}

async function adminBookings(env, url) {
  const status = clean(url.searchParams.get('status'), 20);
  const query = status
    ? env.DB.prepare(
        `SELECT * FROM bookings WHERE status = ?1
         ORDER BY booking_date DESC, booking_time DESC LIMIT 200`
      ).bind(status)
    : env.DB.prepare('SELECT * FROM bookings ORDER BY booking_date DESC, booking_time DESC LIMIT 200');
  const { results } = await query.all();
  const counts = await env.DB.prepare(
    'SELECT status, COUNT(*) AS count FROM bookings GROUP BY status'
  ).all();
  return json({ bookings: results, counts: counts.results });
}

async function updateBooking(env, id, request) {
  const body = await readJson(request);
  const status = clean(body?.status, 20);
  if (!['pending', 'confirmed', 'done', 'cancelled'].includes(status)) {
    return json({ error: 'Status galat hai.' }, 400);
  }
  const updated = await env.DB.prepare(
    'UPDATE bookings SET status = ?1 WHERE id = ?2 RETURNING id, status'
  ).bind(status, id).first();
  if (!updated) return json({ error: 'Booking nahi mili.' }, 404);
  return json(updated);
}

async function adminFeedback(env) {
  const { results } = await env.DB.prepare('SELECT * FROM feedback ORDER BY id DESC LIMIT 200').all();
  return json({ feedback: results });
}

async function updateFeedback(env, id, request) {
  const body = await readJson(request);
  const approved = body?.approved ? 1 : 0;
  const updated = await env.DB.prepare(
    'UPDATE feedback SET approved = ?1 WHERE id = ?2 RETURNING id, approved'
  ).bind(approved, id).first();
  if (!updated) return json({ error: 'Feedback nahi mila.' }, 404);
  return json(updated);
}

async function upsertService(env, request, id) {
  const body = await readJson(request);
  if (!body) return json({ error: 'Request body galat hai.' }, 400);
  const name = clean(body.name, 80);
  const description = clean(body.description, 160);
  const icon = clean(body.icon, 8) || '✂️';
  const price = Number.parseInt(body.price ?? '', 10);
  const sortOrder = Number.parseInt(body.sort_order ?? 99, 10);
  const active = body.active === false ? 0 : 1;

  if (!name) return json({ error: 'Service ka naam chahiye.' }, 400);
  if (!Number.isInteger(price) || price < 0) return json({ error: 'Price sahi likhein.' }, 400);

  if (id) {
    if ('image_key' in body) {
      const imageKey = clean(body.image_key, 200);
      const old = await env.DB.prepare('SELECT image_key FROM services WHERE id = ?1').bind(id).first();
      if (old?.image_key && old.image_key !== imageKey) await deleteImage(env, old.image_key);
      const updated = await env.DB.prepare(
        `UPDATE services SET name = ?1, description = ?2, price = ?3, icon = ?4, sort_order = ?5, active = ?6, image_key = ?7
         WHERE id = ?8 RETURNING id`
      ).bind(name, description, price, icon, sortOrder, active, imageKey, id).first();
      if (!updated) return json({ error: 'Service nahi mili.' }, 404);
      return json(updated);
    }
    const updated = await env.DB.prepare(
      `UPDATE services SET name = ?1, description = ?2, price = ?3, icon = ?4, sort_order = ?5, active = ?6
       WHERE id = ?7 RETURNING id`
    ).bind(name, description, price, icon, sortOrder, active, id).first();
    if (!updated) return json({ error: 'Service nahi mili.' }, 404);
    return json(updated);
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO services (name, description, price, icon, sort_order, active)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`
  ).bind(name, description, price, icon, sortOrder, active).first();
  return json(inserted, 201);
}

async function deleteService(env, id) {
  const deleted = await env.DB.prepare('DELETE FROM services WHERE id = ?1 RETURNING id').bind(id).first();
  if (!deleted) return json({ error: 'Service nahi mili.' }, 404);
  return json({ ok: true });
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (method === 'GET' && path === '/api/health') return json({ ok: true });
  if (method === 'GET' && path === '/api/services') return listServices(env);
  if (method === 'GET' && path === '/api/reviews') return listReviews(env);
  if (method === 'GET' && path === '/api/availability') return availability(env, url);
  if (method === 'GET' && path === '/api/settings') return getSettings(env);
  if (method === 'GET' && path === '/api/gallery') return listGallery(env);
  if (method === 'POST' && path === '/api/bookings') return createBooking(request, env);
  if (method === 'POST' && path === '/api/feedback') return createFeedback(request, env);

  const imageMatch = path.match(/^\/api\/images\/(.+)$/);
  if (method === 'GET' && imageMatch) return serveImage(env, decodeURIComponent(imageMatch[1]));

  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(request, env)) return json({ error: 'Admin token galat hai.' }, 401);

    if (method === 'GET' && path === '/api/admin/bookings') return adminBookings(env, url);
    if (method === 'GET' && path === '/api/admin/bookings/summary') return dailyBookingSummary(env);
    if (method === 'POST' && path === '/api/admin/bookings/cleanup') return manualCleanup(env);
    if (method === 'GET' && path === '/api/admin/feedback') return adminFeedback(env);
    if (method === 'GET' && path === '/api/admin/services') return listServices(env);
    if (method === 'POST' && path === '/api/admin/services') return upsertService(env, request, null);
    if (method === 'PATCH' && path === '/api/admin/settings') return updateSettings(request, env);
    if (method === 'GET' && path === '/api/admin/gallery') return listGallery(env);
    if (method === 'POST' && path === '/api/admin/gallery') return addGalleryImage(request, env);
    if (method === 'POST' && path === '/api/admin/upload') return uploadImage(request, env);

    const bookingMatch = path.match(/^\/api\/admin\/bookings\/(\d+)$/);
    if (method === 'PATCH' && bookingMatch) return updateBooking(env, Number(bookingMatch[1]), request);

    const feedbackMatch = path.match(/^\/api\/admin\/feedback\/(\d+)$/);
    if (method === 'PATCH' && feedbackMatch) return updateFeedback(env, Number(feedbackMatch[1]), request);

    const serviceMatch = path.match(/^\/api\/admin\/services\/(\d+)$/);
    if (serviceMatch && method === 'PATCH') return upsertService(env, request, Number(serviceMatch[1]));
    if (serviceMatch && method === 'DELETE') return deleteService(env, Number(serviceMatch[1]));

    const galleryMatch = path.match(/^\/api\/admin\/gallery\/(\d+)$/);
    if (galleryMatch && method === 'DELETE') return deleteGalleryImage(env, Number(galleryMatch[1]));
  }

  return json({ error: 'Yeh endpoint nahi mila.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        return json({ error: 'Server mein dikkat aa gayi.', detail: String(error) }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupOldData(env));
  },
};
