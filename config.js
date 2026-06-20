// config.js
// การตั้งค่าเชื่อมต่อ Supabase
// คุณสามารถแก้ไข URL และ Anon Key ของคุณที่นี่เพื่อใช้สำหรับ Production
// หรือเปิดแอปแล้วตั้งค่าผ่านหน้าจอ UI (ข้อมูลจะบันทึกลง LocalStorage ของเครื่อง)

const DEFAULT_CONFIG = {
    supabaseUrl: "", // ใส่ Supabase URL ของคุณ เช่น "https://xxxx.supabase.co"
    supabaseAnonKey: "" // ใส่ Anon Key ของคุณ
};

// โหลดการตั้งค่าจาก LocalStorage หรือใช้ค่าเริ่มต้น
export function getSupabaseConfig() {
    const localUrl = localStorage.getItem('SUPABASE_URL');
    const localKey = localStorage.getItem('SUPABASE_ANON_KEY');

    return {
        supabaseUrl: DEFAULT_CONFIG.supabaseUrl || localUrl || "",
        supabaseAnonKey: DEFAULT_CONFIG.supabaseAnonKey || localKey || ""
    };
}

export function saveSupabaseConfig(url, key) {
    if (url) localStorage.setItem('SUPABASE_URL', url.trim());
    if (key) localStorage.setItem('SUPABASE_ANON_KEY', key.trim());
}

export function clearSupabaseConfig() {
    localStorage.removeItem('SUPABASE_URL');
    localStorage.removeItem('SUPABASE_ANON_KEY');
}

export function isConfigured() {
    const conf = getSupabaseConfig();
    return conf.supabaseUrl && conf.supabaseAnonKey;
}
