import { ARCHIVE_CONFIG as cfg } from './oral-collection-config.js';
const $ = id => document.getElementById(id);
const by = sel => Array.from(document.querySelectorAll(sel));
const configured = /^https:\/\/[-\w]+\.supabase\.co\/?$/.test(cfg.supabaseUrl) && cfg.publishableKey?.length > 15;
const base = configured ? `${cfg.supabaseUrl.replace(/\/$/, '')}/functions/v1/${cfg.functionName}` : '';
const govs = ['مسقط','ظفار','مسندم','البريمي','الداخلية','شمال الباطنة','جنوب الباطنة','شمال الشرقية','جنوب الشرقية','الظاهرة','الوسطى'];
const topics = ['الحياة في القرى','التعليم والكتاتيب','الأسواق والمهن','الأفلاج والزراعة','الملاحة والتجارة','العادات والتقاليد','الشخصيات التاريخية','المرأة العُمانية','الحرف التقليدية','ذكريات النهضة','الأمثال والحكايات الشعبية','غيرها'];
let supa, recorder, micStream, chunks = [], recordedFile = null, previewUrl = '', seconds = 0, started = 0, elapsed = 0, tick = null, isRecording = false;
let publicStories = [], reviews = [], activeReview = null, reviewerAuth = false;

const option = (select, value) => { const el = document.createElement('option'); el.value = value; el.textContent = value; select.append(el); };
for (const name of govs) { option($('governorate'),name); option($('filterGov'),name); }
for (const name of topics) option($('category'),name);
function notice(target, msg, good = false) { const n = $(target); n.textContent = msg; n.className = good ? 'status-ok' : 'status-err'; }
function showTab(tab) {
  if (!['submit','browse','admin'].includes(tab)) return;
  by('[role=tab]').forEach(b => b.setAttribute('aria-selected',String(b.dataset.tab===tab)));
  for (const id of ['submit','browse','admin']) $('panel-'+id).hidden = id !== tab;
  if (tab==='browse') loadPublic();
  if (tab==='admin') checkAdminSession();
  history.replaceState(null,'','#'+tab);
}
by('[data-tab]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
by('[data-tablink]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();showTab(b.dataset.tablink);$('panel-'+b.dataset.tablink).scrollIntoView({behavior:'smooth'});}));
if (!configured) {
  const n = $('connection'); n.hidden = false;
  n.textContent = 'وضع المعاينة: يعمل مسجل الصوت محليًا، لكن إرسال الروايات والمكتبة ولوحة المراجعة تحتاج ربط هذا القسم بقاعدة بيانات مستقلة وآمنة للجمعية. لا تُرسَل أي بيانات في هذا الوضع.';
  $('send').disabled = true;
}
function createWave() {
  const el = $('wave');
  for(let i=0;i<43;i++){const bar=document.createElement('i'); bar.style.height=7+Math.floor(Math.abs(Math.sin(i*2.43)*Math.cos(i*.61))*43)+'px';bar.style.animationDelay=(i%10)*.06+'s';el.append(bar);}
}
createWave();
const timeText = s => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
const clock = () => { seconds = Math.floor((elapsed + (started ? Date.now()-started : 0))/1000); $('timer').textContent=timeText(seconds); };
function cleanStream(){if(micStream){micStream.getTracks().forEach(t=>t.stop());micStream=null;}}
function clearClock(){if(tick)clearInterval(tick);tick=null;started=0;elapsed=0;}
function resetPreview(){if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl='';}$('recordedAudio').removeAttribute('src');$('recordedAudio').hidden=true;$('recordedActions').hidden=true;recordedFile=null;}
function displayFile(file){resetPreview();recordedFile=file;previewUrl=URL.createObjectURL(file);$('recordedAudio').src=previewUrl;$('recordedAudio').hidden=false;$('recordedActions').hidden=false;$('downloadAudio').href=previewUrl;$('downloadAudio').download=file.name||'omani-story.m4a';$('fileName').textContent=`التسجيل المختار: ${file.name} (${(file.size/1048576).toFixed(1)} م.ب)`;}
function micError(e){const msg=e?.name==='NotAllowedError'?'لم يسمح المتصفح باستخدام الميكروفون. افتح إعدادات Safari واسمح للميكروفون، أو ارفع ملفًا محفوظًا.':e?.name==='NotFoundError'?'لم يُعثر على ميكروفون. ارفع تسجيلًا محفوظًا.':'تعذّر بدء التسجيل. يجب فتح الصفحة عبر HTTPS واستخدام متصفح يدعم MediaRecorder.';$('rec-status').textContent=msg;cleanStream();}
function getMime(){if(typeof MediaRecorder==='undefined')return '';return ['audio/mp4','audio/webm;codecs=opus','audio/webm','video/mp4','video/webm','audio/ogg;codecs=opus'].find(x=>MediaRecorder.isTypeSupported(x))||'';}
$('record').addEventListener('click',async()=>{
  if (isRecording)return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder==='undefined'){micError({name:'NotSupportedError'});return;}
  resetPreview();$('audioFile').value='';$('fileName').textContent='';
  try{
    micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    const mime=getMime();recorder=new MediaRecorder(micStream,mime?{mimeType:mime}:undefined);chunks=[];
    recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
    recorder.onerror=()=>{$('rec-status').textContent='حدث خطأ أثناء التسجيل. جرّب مرة أخرى.';cleanStream();};
    recorder.onstop=()=>{
      const type=recorder.mimeType||mime||'audio/webm',ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';
      const blob=new Blob(chunks,{type});cleanStream();isRecording=false;$('wave').classList.remove('recording');$('liveDot').hidden=true;$('record').hidden=false;$('pause').hidden=true;$('stop').hidden=true;$('record').classList.remove('active');clearClock();
      if(blob.size){displayFile(new File([blob],`omani-story-${Date.now()}.${ext}`,{type}));$('rec-status').textContent='تم التسجيل. يمكنك الاستماع إليه قبل الإرسال.';}else $('rec-status').textContent='لم يُحفظ صوت؛ حاول مجددًا.';
      chunks=[];
    };
    recorder.start(1000);isRecording=true;seconds=0;elapsed=0;started=Date.now();clock();tick=setInterval(clock,300);
    $('wave').classList.add('recording');$('liveDot').hidden=false;$('record').hidden=true;$('pause').hidden=false;$('stop').hidden=false;$('rec-status').textContent='يتم تسجيل الصوت الآن…';
  }catch(e){micError(e);}
});
$('pause').addEventListener('click',()=>{if(!recorder)return;
  if(recorder.state==='recording'){recorder.pause();elapsed+=Date.now()-started;started=0;$('pause').textContent='متابعة التسجيل';$('rec-status').textContent='التسجيل متوقف مؤقتًا';}
  else if(recorder.state==='paused'){recorder.resume();started=Date.now();$('pause').textContent='إيقاف مؤقت';$('rec-status').textContent='عاد التسجيل';} clock();
});
$('stop').addEventListener('click',()=>{if(!recorder||recorder.state==='inactive')return;clock();recorder.stop();});
$('discard').addEventListener('click',()=>{resetPreview();$('fileName').textContent='';$('timer').textContent='00:00';$('audioFile').value='';$('rec-status').textContent='حُذف التسجيل المحلي. اضغط على الزر لبدء تسجيل جديد.';});
$('audioFile').addEventListener('change',()=>{const f=$('audioFile').files?.[0];if(!f)return;if(f.size>12*1048576){notice('rec-status','الملف أكبر من 12 م.ب. استخدم ملفًا أصغر.');$('audioFile').value='';return;}displayFile(f);$('rec-status').textContent='يمكنك الاستماع للملف قبل الإرسال.';});
$('submitForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!configured){notice('submitStatus','لم يتم ربط الأرشيف بالخادم بعد. نزّل التسجيل للاحتفاظ به.');return;}
  if(isRecording){notice('submitStatus','أنهِ التسجيل أولًا.');return;}
  const form=new FormData(e.currentTarget);
  if(!recordedFile && (String(form.get('summary')||'').trim().length<20 && String(form.get('transcript')||'').trim().length<20)){
    notice('submitStatus','أرفق تسجيلًا صوتيًا أو اكتب رواية من 20 حرفًا على الأقل.');return;
  }
  if(recordedFile){if(recordedFile.size>12*1048576){notice('submitStatus','حجم الصوت أكبر من الحد المسموح.');return;}form.set('audio',recordedFile);}
  const attachment=$('attachment').files?.[0];if(attachment&&attachment.size>3*1048576){notice('submitStatus','المرفق أكبر من 3 م.ب.');return;}
  for(const name of ['consent_storage','authority_confirmed','consent_public','consent_name','consent_audio','consent_attachment'])form.set(name,String(Boolean(e.currentTarget.elements[name].checked)));
  form.set('duration_seconds',String(seconds||0));const btn=$('send');btn.disabled=true;notice('submitStatus','يُرفع الملف وتحفظ الرواية…');
  try{const res=await fetch(`${base}?action=submit`,{method:'POST',body:form});const data=await res.json();
    if(!res.ok||!data.ok)throw Error(data.error||'تعذر الحفظ');
    notice('submitStatus',`استُلمت الرواية بنجاح للمراجعة. رقمها: ${data.id}. لم تُنشر بعد.`,true);
    e.currentTarget.reset();resetPreview();$('audioFile').value='';$('fileName').textContent='';$('timer').textContent='00:00';seconds=0;
  }catch(err){notice('submitStatus',`لم يُحفظ الطلب: ${err.message}. احتفظ بالتسجيل على هاتفك ثم حاول مجددًا.`)}finally{btn.disabled=false;}
});
async function publicRequest(path,token=''){
  if(!configured)throw Error('الخادم غير متصل بعد');
  const headers=token?{Authorization:`Bearer ${token}`}:{},res=await fetch(`${base}?${path}`,{headers});let data;
  try{data=await res.json()}catch{throw Error('تعذرت قراءة استجابة الخادم')}
  if(!res.ok)throw Error(data.error||`خطأ ${res.status}`);return data;
}
function make(tag,css='',text=''){const el=document.createElement(tag);if(css)el.className=css;if(text)el.textContent=text;return el;}
async function loadPublic(){const box=$('stories');if(!configured){box.replaceChildren(make('p','empty','المكتبة غير متصلة بعد. لا تُعرض روايات تجريبية على أنها حقيقية.'));return;}
  box.replaceChildren(make('p','empty','جارٍ تحميل الروايات المنشورة…'));
  try{publicStories=(await publicRequest('action=list')).stories||[];renderPublic();}catch(err){box.replaceChildren(make('p','empty','تعذر تحميل المكتبة: '+err.message));}
}
function renderPublic(){const q=$('search').value.trim(),gov=$('filterGov').value,box=$('stories');box.replaceChildren();
  const filtered=publicStories.filter(s=>(!gov||s.governorate===gov)&&(!q||[s.title,s.wilayah,s.category,s.summary,s.narrator].join(' ').includes(q)));
  if(!filtered.length){box.append(make('p','empty',publicStories.length?'لا توجد روايات مطابقة لهذا البحث.':'لم تُنشر روايات بعد. ندعوكم للمشاركة في بناء ذاكرة عُمان.'));return;}
  filtered.forEach(s=>{const card=make('article','story-card');card.append(make('span','tag',s.category),make('h3','',s.title),make('small','',[s.wilayah,s.governorate].filter(Boolean).join('، ')),make('p','',s.summary||'شهادة تاريخية محفوظة'));
    card.append(make('p','',`الراوي: ${s.narrator}`));if(s.transcript){const d=make('details');const sum=make('summary','','قراءة النص');const p=make('p','',s.transcript);d.append(sum,p);card.append(d);}
    const foot=make('div','card-foot');foot.append(make('small','',s.story_source==='heard'?'منقول عن آخرين':'شهادة مباشرة'));
    if(s.has_audio){const btn=make('button','button outline compact','▶ استمع');btn.onclick=async()=>{btn.disabled=true;try{const data=await publicRequest('action=audio&id='+encodeURIComponent(s.id));$('publicPlayer').src=data.url;$('publicPlayer').hidden=false;await $('publicPlayer').play();}catch(err){alert('تعذّر تشغيل الصوت: '+err.message);}finally{btn.disabled=false;}};foot.append(btn);}
    if(s.has_attachment){const btn=make('button','button outline compact','عرض المرفق');btn.onclick=async()=>{try{const data=await publicRequest('action=attachment&id='+encodeURIComponent(s.id));window.open(data.url,'_blank','noopener,noreferrer');}catch(err){alert('المرفق غير متاح: '+err.message)}};foot.append(btn);}
    card.append(foot);box.append(card);});
}
$('refreshStories').onclick=loadPublic;$('search').oninput=renderPublic;$('filterGov').onchange=renderPublic;
async function client(){if(!configured)throw Error('الربط غير مفعل');if(!supa){const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.118.0');supa=createClient(cfg.supabaseUrl,cfg.publishableKey);}return supa;}
async function checkAdminSession(){if(!configured){notice('loginStatus','يلزم توصيل قاعدة بيانات مستقلة للجمعية لتفعيل لوحة الإدارة.');return;}
  try{const sb=await client(),{data:{user}}=await sb.auth.getUser();if(user)await checkRole(user.id);}catch(err){notice('loginStatus',err.message);}
}
async function checkRole(uid){const sb=await client(),{data,error}=await sb.from('oha_oral_reviewers').select('role').eq('user_id',uid).maybeSingle();
  if(error||!data){reviewerAuth=false;notice('loginStatus','الحساب غير مخوّل بمراجعة روايات الجمعية. يجب اعتماده من مسؤول النظام.');return;}
  reviewerAuth=true;$('loginForm').hidden=true;$('reviewDashboard').hidden=false;$('logout').hidden=false;await loadReviews();
}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();notice('loginStatus','جارٍ التحقق من الحساب…');
  try{const sb=await client(),{data,error}=await sb.auth.signInWithPassword({email:e.target.elements.email.value,password:e.target.elements.password.value});
    if(error)throw error;await checkRole(data.user.id);}catch(err){notice('loginStatus','فشل تسجيل الدخول: '+err.message);}
});
$('logout').onclick=async()=>{const sb=await client();await sb.auth.signOut();reviewerAuth=false;reviews=[];$('reviewDashboard').hidden=true;$('loginForm').hidden=false;$('logout').hidden=true;notice('loginStatus','تم تسجيل الخروج.',true);};
async function loadReviews(){if(!reviewerAuth)return;const box=$('reviewList');box.replaceChildren(make('p','empty','جارٍ تحميل الطلبات…'));
  try{const sb=await client(),{data,error}=await sb.from('oha_oral_stories').select('*').order('created_at',{ascending:false}).limit(200);
    if(error)throw error;reviews=data||[];renderReviewList();renderReviewStats();if(activeReview){const newStory=reviews.find(x=>x.id===activeReview);if(newStory)showReview(newStory);else $('reviewDetail').replaceChildren(make('p','empty','اختَر رواية.'));}}
  catch(err){box.replaceChildren(make('p','empty','تعذر التحميل: '+err.message));}
}
function renderReviewStats(){const el=$('reviewStats');el.replaceChildren();const labels={pending:'بانتظار المراجعة',needs_info:'يحتاج معلومات',approved:'معتمد',rejected:'مرفوض',private_archived:'أرشيف خاص'};
  for(const [state,label] of Object.entries(labels))el.append(make('span','',`${label}: ${reviews.filter(x=>x.status===state).length}`));
}
function renderReviewList(){const el=$('reviewList');el.replaceChildren();if(!reviews.length){el.append(make('p','empty','لا توجد روايات في قائمة المراجعة.'));return;}
  const labels={pending:'جديد',needs_info:'استكمال',approved:'منشور',rejected:'مرفوض',private_archived:'محفوظ خاص'};
  for(const s of reviews){const btn=make('button','review-item');btn.type='button';btn.setAttribute('aria-pressed',String(activeReview===s.id));btn.append(make('b','',s.title),make('small','',`${labels[s.status]||s.status} · ${s.wilayah} · ${new Date(s.created_at).toLocaleDateString('ar-OM')}`));btn.onclick=()=>showReview(s);el.append(btn);}
}
function field(label,value='',kind='input'){const wrap=make('label');wrap.append(make('span','',label));const input=make(kind);if(kind==='textarea')input.rows=4;input.value=value||'';wrap.append(input);return {wrap,input};}
async function showReview(s){activeReview=s.id;renderReviewList();const el=$('reviewDetail');el.replaceChildren();
  el.append(make('h3','',`مراجعة: ${s.title}`));const info=make('div','private');info.textContent=`الراوي: ${s.narrator}\nالاتصال (خاص): ${s.contact||'—'}\nمسجل المقابلة: ${s.recorded_by||'—'}\nالموقع: ${[s.governorate,s.wilayah,s.village].filter(Boolean).join('، ')}\nالمصدر: ${s.story_source==='heard'?'منقول':'شاهد مباشر'}\nالفترة: ${s.era||'غير محددة'}\n\nالموافقات: حفظ ✓ · نشر ${s.consent_public?'✓':'✗'} · اسم ${s.consent_name?'✓':'✗'} · صوت ${s.consent_audio?'✓':'✗'} · مرفق ${s.consent_attachment?'✓':'✗'}`;el.append(info);
  if(s.audio_path){const btn=make('button','button outline compact','▶ استمع للتسجيل الخاص');const audio=make('audio');audio.controls=true;audio.hidden=true;btn.onclick=async()=>{try{const sb=await client(),{data:{session}}=await sb.auth.getSession();const data=await publicRequest('action=audio&id='+encodeURIComponent(s.id),session?.access_token);audio.src=data.url;audio.hidden=false;audio.play();}catch(err){alert('تعذر تشغيل التسجيل: '+err.message)}};el.append(btn,audio);}
  if(s.attachment_path){const btn=make('button','button outline compact','عرض المرفق الخاص');btn.onclick=async()=>{try{const sb=await client(),{data:{session}}=await sb.auth.getSession();const data=await publicRequest('action=attachment&id='+encodeURIComponent(s.id),session?.access_token);window.open(data.url,'_blank','noopener,noreferrer');}catch(err){alert('تعذر عرض المرفق: '+err.message)}};el.append(btn);}
  const title=field('العنوان',s.title),category=field('التصنيف',s.category),summary=field('وصف الرواية',s.summary,'textarea'),transcript=field('تفريغ النص (تحرير المراجع فقط)',s.transcript,'textarea'),note=field('ملاحظات المراجعة',s.review_note,'textarea');
  for(const f of [title,category,summary,transcript,note])el.append(f.wrap);
  const status=field('حالة الرواية');const sel=make('select');for(const [value,label] of Object.entries({pending:'قيد المراجعة',needs_info:'يحتاج معلومات',approved:'اعتماد للنشر',private_archived:'حفظ خاص دون نشر',rejected:'رفض'})){const option=make('option','',label);option.value=value;sel.append(option);}sel.value=s.status;status.input.replaceWith(sel);el.append(status.wrap);
  if(!s.consent_public){const p=make('p','status-err','لا يجوز النشر لأن الراوي لم يوافق على النشر العام. يمكن حفظ الرواية في الأرشيف الخاص.');el.append(p);}
  const actions=make('div','actions'),save=make('button','approve','حفظ قرار المراجعة');actions.append(save);el.append(actions);const result=make('p');result.setAttribute('role','status');el.append(result);
  save.onclick=async()=>{if(sel.value==='approved'&&!s.consent_public){result.className='status-err';result.textContent='لا يمكن اعتماد النشر دون موافقة صريحة.';return;}
    save.disabled=true;result.textContent='جارٍ الحفظ…';try{const sb=await client(),{error}=await sb.from('oha_oral_stories').update({title:title.input.value.trim(),category:category.input.value.trim(),summary:summary.input.value.trim(),transcript:transcript.input.value.trim(),review_note:note.input.value.trim(),status:sel.value}).eq('id',s.id);
      if(error)throw error;result.className='status-ok';result.textContent='حُفظ قرار المراجعة.';await loadReviews();}
    catch(err){result.className='status-err';result.textContent='تعذّر الحفظ: '+err.message;}finally{save.disabled=false;}
  };
}
$('refreshReviews').onclick=loadReviews;
function safeCsv(v){let s=String(v??'').replaceAll('"','""');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s+'"';}
$('exportCsv').onclick=()=>{if(!reviewerAuth)return;const keys=['id','title','narrator','contact','governorate','wilayah','village','category','era','story_source','status','consent_public','created_at'];
  const csv='\ufeff'+[keys.map(safeCsv).join(','),...reviews.map(r=>keys.map(k=>safeCsv(r[k])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='oha-oral-review-private.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
};
showTab(['submit','browse','admin'].includes(location.hash.slice(1))?location.hash.slice(1):'submit');
window.addEventListener('beforeunload',e=>{if(isRecording){e.preventDefault();e.returnValue='';}});
