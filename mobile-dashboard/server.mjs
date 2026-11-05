#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SKILL = path.join(ROOT, 'skills', 'directing-stickman-videos');
const AUTOPILOT = path.join(SKILL, 'scripts', 'autopilot.mjs');
const PROJECTS = path.join(ROOT, 'projects');
const PUBLIC = path.join(HERE, 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = '0.0.0.0';
const jobs = new Set();
const downloads = new Set(['preview.mp4', 'film.mp4', 'preview-contact-sheet.png', 'film-contact-sheet.png', 'preview.srt', 'film.srt']);

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function projectSlug(value) {
  if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 48) throw new Error('Nama proyek gunakan huruf kecil, angka, dan tanda hubung saja.');
  return value;
}
function projectDir(value) {
  const dir = path.resolve(PROJECTS, projectSlug(value));
  if (!dir.startsWith(PROJECTS + path.sep)) throw new Error('Lokasi proyek tidak valid.');
  if (!fs.existsSync(path.join(dir, 'project.json'))) throw new Error('project.json belum ada. Buat proyek terlebih dahulu.');
  return dir;
}
function runAutopilot(args, timeoutMs = 20 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const key = args[0];
    if (jobs.has(key)) return reject(new Error('Tahap ini sedang berjalan. Tunggu sampai selesai.'));
    jobs.add(key);
    const child = spawn(process.execPath, [AUTOPILOT, ...args], {cwd: SKILL, env: process.env, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', settled = false;
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const append = (current, chunk) => (current + chunk.toString()).slice(-16000);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', error => {
      if (settled) return;
      settled = true; clearTimeout(timer); jobs.delete(key); reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true; clearTimeout(timer); jobs.delete(key);
      const result = {ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim()};
      if (code === 0) resolve(result);
      else reject(Object.assign(new Error(stderr.trim() || stdout.trim() || ('Autopilot berhenti (kode ' + code + ').')), {result}));
    });
  });
}
async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16000) throw new Error('Permintaan terlalu besar.');
  }
  return raw ? JSON.parse(raw) : {};
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function listProjects() {
  fs.mkdirSync(PROJECTS, {recursive: true});
  return fs.readdirSync(PROJECTS, {withFileTypes: true}).filter(item => item.isDirectory()).map(item => {
    const dir = path.join(PROJECTS, item.name), out = path.join(dir, 'output');
    return {name: item.name, ready: fs.existsSync(path.join(dir, 'project.json')), preview: fs.existsSync(path.join(out, 'preview.mp4')), film: fs.existsSync(path.join(out, 'film.mp4'))};
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/api/projects') return send(res, 200, {projects: listProjects()});
  if (req.method === 'GET' && url.pathname === '/api/download') {
    try {
      const slug = projectSlug(url.searchParams.get('project')), file = url.searchParams.get('file');
      if (!downloads.has(file)) throw new Error('File tidak diizinkan.');
      const full = path.join(projectDir(slug), 'output', file);
      if (!fs.existsSync(full)) throw new Error('File belum tersedia.');
      res.writeHead(200, {'Content-Type': file.endsWith('.mp4') ? 'video/mp4' : file.endsWith('.png') ? 'image/png' : 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + file + '"', 'X-Content-Type-Options': 'nosniff'});
      return fs.createReadStream(full).pipe(res);
    } catch (error) { return send(res, 400, {error: error.message}); }
  }
  if (!url.pathname.startsWith('/api/')) return send(res, 404, {error: 'Tidak ditemukan.'});
  if (req.method !== 'POST' || !sameOrigin(req)) return send(res, 403, {error: 'Akses ditolak. Buka dashboard dari port Codespaces yang sama.'});
  try {
    const body = await readBody(req);
    if (url.pathname === '/api/doctor') {
      const result = await runAutopilot(['doctor'], 30000);
      let report = {};
      try { report = JSON.parse(result.stdout); } catch {}
      return send(res, 200, {ok: true, report});
    }
    if (url.pathname === '/api/init') {
      const slug = projectSlug(body.name), style = ['B1', 'B2', 'B3'].includes(body.style) ? body.style : 'B1';
      fs.mkdirSync(PROJECTS, {recursive: true});
      const dir = path.join(PROJECTS, slug);
      if (fs.existsSync(dir)) throw new Error('Nama proyek sudah dipakai. Pilih nama lain.');
      const result = await runAutopilot(['init', dir, '--style', style], 30000);
      const narration = path.join(SKILL, 'narration.txt');
      let narrationCopied = false;
      if (fs.existsSync(narration)) {
        fs.copyFileSync(narration, path.join(dir, 'narration.txt'), fs.constants.COPYFILE_EXCL);
        narrationCopied = true;
      }
      return send(res, 200, {ok: true, project: slug, narrationCopied, result});
    }
    if (url.pathname === '/api/preview') {
      const dir = projectDir(body.project), seconds = Math.min(60, Math.max(1, Number(body.seconds) || 20));
      const result = await runAutopilot(['preview', path.join(dir, 'project.json'), '--seconds', String(seconds)], 20 * 60 * 1000);
      return send(res, 200, {ok: true, result});
    }
    if (url.pathname === '/api/approve') {
      const dir = projectDir(body.project);
      if (body.reviewed !== true) throw new Error('Centang persetujuan setelah benar-benar menonton dan mendengar preview.');
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
      if (!note) throw new Error('Catatan approval wajib diisi.');
      const result = await runAutopilot(['approve', path.join(dir, 'project.json'), '--note', note], 30000);
      return send(res, 200, {ok: true, result});
    }
    if (url.pathname === '/api/render') {
      const dir = projectDir(body.project);
      if (body.confirm !== true) throw new Error('Konfirmasi render final belum diberikan.');
      const result = await runAutopilot(['render', path.join(dir, 'project.json')], 30 * 60 * 1000);
      return send(res, 200, {ok: true, result});
    }
    return send(res, 404, {error: 'Aksi tidak dikenal.'});
  } catch (error) {
    return send(res, 400, {ok: false, error: error.message, result: error.result || null});
  }
});
server.listen(PORT, HOST, () => {
  fs.mkdirSync(PROJECTS, {recursive: true});
  console.log('Stickman Mobile Dashboard aktif di port ' + PORT + ' (Codespaces: biarkan port Private).');
});
