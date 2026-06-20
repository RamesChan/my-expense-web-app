// auth.js
// จัดการการยืนยันตัวตนและการเข้าสู่ระบบผ่าน Supabase Auth
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getSupabaseConfig, isConfigured } from './config.js';

let supabaseClient = null;

// ดึงหรือรีเซ็ต Client
export function getSupabaseClient() {
    if (!isConfigured()) return null;
    
    if (!supabaseClient) {
        const config = getSupabaseConfig();
        supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
            auth: {
                persistSession: true,
                autoRefreshToken: true
            }
        });
    }
    return supabaseClient;
}

export function resetSupabaseClient() {
    supabaseClient = null;
}

// สมัครสมาชิกใหม่
export async function signUp(email, password, displayName) {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured yet.");

    const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
            data: {
                display_name: displayName
            }
        }
    });

    if (error) throw error;
    return data;
}

// เข้าสู่ระบบ
export async function signIn(email, password) {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase is not configured yet.");

    const { data, error } = await client.auth.signInWithPassword({
        email,
        password
    });

    if (error) throw error;
    return data;
}

// ออกจากระบบ
export async function signOut() {
    const client = getSupabaseClient();
    if (!client) return;

    const { error } = await client.auth.signOut();
    if (error) throw error;
}

// รับข้อมูลผู้ใช้งานปัจจุบันที่กำลังล็อกอินอยู่
export async function getCurrentUser() {
    const client = getSupabaseClient();
    if (!client) return null;

    const { data: { user } } = await client.auth.getUser();
    return user;
}

// ดึงข้อมูล Profile ปัจจุบันจากฐานข้อมูล
export async function getCurrentProfile() {
    const client = getSupabaseClient();
    if (!client) return null;

    const user = await getCurrentUser();
    if (!user) return null;

    const { data, error } = await client
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    if (error) {
        console.error("Error fetching profile:", error);
        // หากยังไม่มีโปรไฟล์ในตาราง ลองสร้างโปรไฟล์ใหม่ (เพื่อกันระบบทริกเกอร์ล้าช้า)
        try {
            const { data: newProfile, error: createError } = await client
                .from('profiles')
                .insert({
                    id: user.id,
                    display_name: user.user_metadata?.display_name || user.email.split('@')[0]
                })
                .select()
                .single();
            if (!createError) return newProfile;
        } catch (e) {
            console.error("Failed to fallback-create profile:", e);
        }
        return null;
    }
    return data;
}

// อัปเดตชื่อผู้ใช้
export async function updateProfileDisplayName(displayName) {
    const client = getSupabaseClient();
    if (!client) return null;

    const user = await getCurrentUser();
    if (!user) return null;

    const { data, error } = await client
        .from('profiles')
        .update({ display_name: displayName })
        .eq('id', user.id)
        .select()
        .single();

    if (error) throw error;
    
    // อัปเดตข้อมูลผู้ใช้ใน auth ด้วย
    await client.auth.updateUser({
        data: { display_name: displayName }
    });

    return data;
}

// สังเกตการเปลี่ยนแปลงสถานะการเข้าสู่ระบบ
export function subscribeToAuthChanges(callback) {
    const client = getSupabaseClient();
    if (!client) return () => {};

    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });

    return () => subscription.unsubscribe();
}
