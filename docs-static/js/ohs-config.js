// إعداد ربط موقع الجمعية بمشروع Supabase
// انسخي القيمتين من: Supabase Dashboard ← Project Settings ← API Keys (أو زر Connect)
//   url : عنوان المشروع، مثل https://abcdefgh.supabase.co
//   key : المفتاح العام (Publishable key يبدأ بـ sb_publishable_ ، أو anon key القديم)
// هذا المفتاح مخصص للمتصفح وآمن للنشر لأن الصلاحيات محمية بقواعد RLS في supabase/schema.sql.
// لا تضعي هنا أبداً المفتاح السري (Secret key أو service_role).
window.OHS_SUPABASE = {
  url: "",
  key: ""
};
