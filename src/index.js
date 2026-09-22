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

async function listServices(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, description, price, icon FROM services WHERE active = 1 ORDER BY sort_order, id'
  ).all();
  return json({ services: results });
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
  const { results } = await env.DB.prepare(
    `SELECT booking_time AS time, COUNT(*) AS taken FROM bookings
     WHERE booking_date = ?1 AND status != 'cancelled' GROUP BY booking_time`
  ).bind(date).all();
  const capacity = slotCapacity(env);
  return json({
    date,
    capacity,
    slots: results.map((row) => ({ time: row.time, taken: row.taken, full: row.taken >= capacity })),
  });
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

  if (name.length < 2) return json({ error: 'Kripya apna poora naam likhein.' }, 400);
  if (!phone) return json({ error: 'Mobile number 10 ank ka hona chahiye.' }, 400);
  if (!service) return json({ error: 'Service chuniye.' }, 400);
  if (!isValidDate(date)) return json({ error: 'Date sahi format mein chuniye.' }, 400);
  if (!isValidTime(time)) return json({ error: 'Time sahi format mein chuniye.' }, 400);
  if (date < todayInIndia()) return json({ error: 'Beeti hui date par booking nahi ho sakti.' }, 400);

  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM bookings
     WHERE phone = ?1 AND created_at > datetime('now', '-1 day') AND status != 'cancelled'`
  ).bind(phone).first();
  if ((recent?.count ?? 0) >= MAX_BOOKINGS_PER_PHONE_PER_DAY) {
    return json({ error: 'Is number se bahut saari booking ho chuki hain. Kripya call karein.' }, 429);
  }

  const capacity = slotCapacity(env);
  const slot = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM bookings
     WHERE booking_date = ?1 AND booking_time = ?2 AND status != 'cancelled'`
  ).bind(date, time).first();
  if ((slot?.count ?? 0) >= capacity) {
    return json({ error: 'Yeh slot bhar chuka hai, doosra time chuniye.' }, 409);
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO bookings (name, phone, service, booking_date, booking_time, note)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id, status`
  ).bind(name, phone, service, date, time, note).first();

  return json({
    id: inserted.id,
    status: inserted.status,
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
  if (method === 'POST' && path === '/api/bookings') return createBooking(request, env);
  if (method === 'POST' && path === '/api/feedback') return createFeedback(request, env);

  if (path.startsWith('/api/admin/')) {
    if (!isAdmin(request, env)) return json({ error: 'Admin token galat hai.' }, 401);

    if (method === 'GET' && path === '/api/admin/bookings') return adminBookings(env, url);
    if (method === 'GET' && path === '/api/admin/feedback') return adminFeedback(env);
    if (method === 'GET' && path === '/api/admin/services') return listServices(env);
    if (method === 'POST' && path === '/api/admin/services') return upsertService(env, request, null);

    const bookingMatch = path.match(/^\/api\/admin\/bookings\/(\d+)$/);
    if (method === 'PATCH' && bookingMatch) return updateBooking(env, Number(bookingMatch[1]), request);

    const feedbackMatch = path.match(/^\/api\/admin\/feedback\/(\d+)$/);
    if (method === 'PATCH' && feedbackMatch) return updateFeedback(env, Number(feedbackMatch[1]), request);

    const serviceMatch = path.match(/^\/api\/admin\/services\/(\d+)$/);
    if (serviceMatch && method === 'PATCH') return upsertService(env, request, Number(serviceMatch[1]));
    if (serviceMatch && method === 'DELETE') return deleteService(env, Number(serviceMatch[1]));
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
};
