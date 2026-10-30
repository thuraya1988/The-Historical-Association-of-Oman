// Deploy with --no-verify-jwt because PUBLIC submissions/approved playback are deliberate.
// Admin operations still validate real user JWTs and reviewer roles server-side.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const URL = Deno.env.get('SUPABASE_URL') ?? '';
const SECRET = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUBLISHABLE = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const allowedOrigins = new Set([
  'https://thuraya1988.github.io',
  'http://localhost:8000', 'http://127.0.0.1:8000',
]);
const maxAudio = 12 * 1024 * 1024, maxAttachment = 3 * 1024 * 1024;
const supa = createClient(URL, SECRET, { auth: { persistSession: false } });
function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://thuraya1988.github.io',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Vary': 'Origin', 'Cache-Control': 'no-store',
  };
}
function result(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function str(body: FormData, key: string, length = 250) {
  return String(body.get(key) ?? '').trim().slice(0, length);
}
function bool(body: FormData, key: string) { return body.get(key) === 'true'; }
function starts(b: Uint8Array, value: number[]) { return value.every((v, i) => b[i] === v); }
async function acceptedFile(file: File, attachment = false): Promise<{ mime: string; ext: string } | null> {
  if (!file.size || file.size > (attachment ? maxAttachment : maxAudio)) return null;
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (attachment) {
    if (starts(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', ext: 'pdf' };
    if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
    if (starts(b, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
    return null;
  }
  if (b.length > 8 && String.fromCharCode(...b.slice(4, 8)) === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: 'audio/webm', ext: 'webm' };
  if (starts(b, [0x4f, 0x67, 0x67, 0x53])) return { mime: 'audio/ogg', ext: 'ogg' };
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && String.fromCharCode(...b.slice(8, 12)) === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  if (starts(b, [0x49, 0x44, 0x33]) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { mime: 'audio/mpeg', ext: 'mp3' };
  return null;
}
async function reviewer(req: Request): Promise<boolean> {
  const value = req.headers.get('authorization') || '';
  if (!value.startsWith('Bearer ') || !PUBLISHABLE) return false;
  const jwt = value.substring(7);
  const authClient = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { data: { user }, error } = await authClient.auth.getUser(jwt);
  if (error || !user) return false;
  const { data: role } = await supa.from('oha_oral_reviewers').select('user_id').eq('user_id', user.id).maybeSingle();
  return !!role;
}
async function rateLimited(req: Request): Promise<boolean> {
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const bytes = new TextEncoder().encode(`${ip}:${SECRET.slice(0, 64)}`);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supa.from('oha_oral_submission_limits')
    .select('id', { count: 'exact', head: true }).eq('ip_digest', digest).gte('created_at', from);
  if (error || (count ?? 99) >= 4) return true;
  const { error: inserted } = await supa.from('oha_oral_submission_limits').insert({ ip_digest: digest });
  return !!inserted;
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (!URL || !SECRET) return result(req, { error: 'Backend configuration missing' }, 503);
  try {
    const u = new URL(req.url), action = u.searchParams.get('action') || '';
    if (req.method === 'GET' && action === 'list') {
      const { data, error } = await supa.from('oha_oral_stories').select(
        'id,title,governorate,wilayah,village,category,era,summary,transcript,story_source,created_at,narrator,consent_name,consent_audio,consent_attachment,audio_path,attachment_path'
      ).eq('status', 'approved').eq('consent_public', true).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return result(req, { stories: (data || []).map(s => ({
        id: s.id, title: s.title, governorate: s.governorate, wilayah: s.wilayah, village: s.village,
        category: s.category, era: s.era, summary: s.summary, transcript: s.transcript,
        story_source: s.story_source, created_at: s.created_at,
        narrator: s.consent_name ? s.narrator : 'راوٍ عُماني',
        has_audio: Boolean(s.audio_path && s.consent_audio),
        has_attachment: Boolean(s.attachment_path && s.consent_attachment),
      })) });
    }
    if (req.method === 'GET' && (action === 'audio' || action === 'attachment')) {
      const id = u.searchParams.get('id') || '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) return result(req, { error: 'Invalid ID' }, 400);
      const { data: s, error } = await supa.from('oha_oral_stories').select('*').eq('id', id).maybeSingle();
      if (error || !s) return result(req, { error: 'Not found' }, 404);
      const isReviewer = await reviewer(req);
      const publicRecord = s.status === 'approved' && s.consent_public;
      const permitted = isReviewer || (publicRecord && (action === 'audio' ? s.consent_audio : s.consent_attachment));
      if (!permitted) return result(req, { error: 'Forbidden' }, 403);
      const path = action === 'audio' ? s.audio_path : s.attachment_path;
      if (!path) return result(req, { error: 'Not found' }, 404);
      const { data: signed, error: signErr } = await supa.storage.from('oha-oral-private').createSignedUrl(path, 120);
      if (signErr || !signed) throw signErr || Error('Signed link failed');
      return result(req, { url: signed.signedUrl });
    }
    if (req.method === 'POST' && action === 'submit') {
      if (req.headers.get('content-length') && Number(req.headers.get('content-length')) > 16 * 1024 * 1024)
        return result(req, { error: 'File too large' }, 413);
      if (await rateLimited(req)) return result(req, { error: 'Too many submissions — please try later' }, 429);
      const body = await req.formData();
      const title = str(body, 'title', 160), narrator = str(body, 'narrator', 100) || 'راوٍ عُماني';
      const governorate = str(body, 'governorate', 70), wilayah = str(body, 'wilayah', 70);
      const category = str(body, 'category', 80), summary = str(body, 'summary', 4000);
      const transcript = str(body, 'transcript', 16000);
      const storySource = str(body, 'story_source', 10);
      const audio = body.get('audio'), attachment = body.get('attachment');
      const af = audio instanceof File && audio.size > 0 ? audio : null;
      const df = attachment instanceof File && attachment.size > 0 ? attachment : null;
      if (title.length < 4 || !governorate || !wilayah || !category || !['heard', 'witness'].includes(storySource))
        return result(req, { error: 'Missing required fields' }, 400);
      if (!bool(body, 'consent_storage') || !bool(body, 'authority_confirmed'))
        return result(req, { error: 'Consent and authority confirmation required' }, 400);
      if (!af && Math.max(summary.length, transcript.length) < 20)
        return result(req, { error: 'Provide recording or at least 20 characters of narrative' }, 400);
      if (af && !(await acceptedFile(af))) return result(req, { error: 'Unsupported audio or file exceeds 12 MB' }, 400);
      if (df && !(await acceptedFile(df, true))) return result(req, { error: 'Unsupported attachment or file exceeds 3 MB' }, 400);
      const id = crypto.randomUUID();
      let audioPath: string | null = null, attachmentPath: string | null = null;
      try {
        if (af) {
          const m = (await acceptedFile(af))!; audioPath = `${id}/source.${m.ext}`;
          const { error } = await supa.storage.from('oha-oral-private').upload(audioPath, af, { contentType: m.mime, upsert: false });
          if (error) throw error;
        }
        if (df) {
          const m = (await acceptedFile(df, true))!; attachmentPath = `${id}/attachment.${m.ext}`;
          const { error } = await supa.storage.from('oha-oral-private').upload(attachmentPath, df, { contentType: m.mime, upsert: false });
          if (error) throw error;
        }
        const { error } = await supa.from('oha_oral_stories').insert({
          id, title, narrator, contact: str(body, 'contact', 180) || null,
          recorded_by: str(body, 'recorded_by', 120) || null,
          governorate, wilayah, village: str(body, 'village', 100) || null, category,
          era: str(body, 'era', 120) || null, story_source: storySource,
          summary, transcript, audio_path: audioPath, audio_mime: af?.type || null,
          attachment_path: attachmentPath, attachment_mime: df?.type || null,
          duration_seconds: Math.max(0, Math.min(36000, Number(body.get('duration_seconds')) || 0)),
          consent_storage: true, consent_public: bool(body, 'consent_public'),
          consent_name: bool(body, 'consent_name'), consent_audio: bool(body, 'consent_audio'),
          consent_attachment: bool(body, 'consent_attachment'),
          authority_confirmed: true, status: 'pending',
        });
        if (error) throw error;
      } catch (e) {
        const paths = [audioPath, attachmentPath].filter(Boolean) as string[];
        if (paths.length) await supa.storage.from('oha-oral-private').remove(paths);
        throw e;
      }
      return result(req, { ok: true, id, status: 'pending' }, 201);
    }
    return result(req, { error: 'Unknown route' }, 404);
  } catch (e) {
    console.error('oha oral error', e);
    return result(req, { error: 'Server error, please try again' }, 500);
  }
});
