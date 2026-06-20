// db.js
// จัดการฐานข้อมูลและ CRUD Operations ต่างๆ ร่วมกับ Supabase
import { getSupabaseClient } from './auth.js';

// เช็คความพร้อมของ Client
function getClient() {
    const client = getSupabaseClient();
    if (!client) throw new Error("Supabase client is not initialized.");
    return client;
}

// =========================================================================
// 1. หมวดหมู่ (Categories)
// =========================================================================

// รายการหมวดหมู่เริ่มต้นกรณีผู้ใช้สมัครใหม่
const DEFAULT_CATEGORIES = [
    { name: "อาหารและเครื่องดื่ม", icon: "🍔", color: "rose-500", budget: 5000 },
    { name: "การเดินทาง", icon: "🚗", color: "blue-500", budget: 3000 },
    { name: "ความบันเทิง", icon: "🎬", color: "yellow-500", budget: 2000 },
    { name: "ของใช้ในบ้าน", icon: "🏠", color: "purple-500", budget: 4000 },
    { name: "ช้อปปิ้ง", icon: "🛍️", color: "pink-500", budget: 2000 },
    { name: "รายได้ประจำ", icon: "💰", color: "emerald-500", budget: 0 } // สำหรับรายรับ
];

// ดึงหมวดหมู่ทั้งหมดของผู้ใช้งานปัจจุบัน
export async function getCategories() {
    const supabase = getClient();
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return [];

    const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

    if (error) throw error;

    // ถ้ายังไม่มีหมวดหมู่เลย ให้เริ่มสร้างหมวดหมู่เริ่มต้น
    if (data.length === 0) {
        return await initializeDefaultCategories(user.id);
    }

    return data;
}

// สร้างหมวดหมู่เริ่มต้นให้กับผู้ใช้
async function initializeDefaultCategories(userId) {
    const supabase = getClient();
    const categoriesToInsert = DEFAULT_CATEGORIES.map(cat => ({
        user_id: userId,
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        budget: cat.budget
    }));

    const { data, error } = await supabase
        .from('categories')
        .insert(categoriesToInsert)
        .select();

    if (error) {
        console.error("Error creating default categories:", error);
        return [];
    }
    return data;
}

// สร้างหมวดหมู่ใหม่
export async function createCategory(name, icon, color, budget) {
    const supabase = getClient();
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) throw new Error("Unauthorized");

    const { data, error } = await supabase
        .from('categories')
        .insert({
            user_id: user.id,
            name,
            icon,
            color,
            budget: parseFloat(budget) || 0
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

// แก้ไขหมวดหมู่
export async function updateCategory(id, name, icon, color, budget) {
    const supabase = getClient();
    const { data, error } = await supabase
        .from('categories')
        .update({
            name,
            icon,
            color,
            budget: parseFloat(budget) || 0
        })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

// ลบหมวดหมู่
export async function deleteCategory(id) {
    const supabase = getClient();
    const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', id);

    if (error) throw error;
    return true;
}

// =========================================================================
// 2. รายการธุรกรรม (Transactions)
// =========================================================================

// ดึงรายการธุรกรรมตามฟิลเตอร์
// filters: { monthYear: '2026-06' } (ฟอร์แมตวันที่แบบ YYYY-MM)
export async function getTransactions(filters = {}) {
    const supabase = getClient();
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return [];

    let query = supabase
        .from('transactions')
        .select('*, categories(name, icon, color)')
        .eq('user_id', user.id);

    // กรองตามเดือน-ปี (กรองช่วงวันที่ของเดือนนั้นๆ)
    if (filters.monthYear) {
        const [year, month] = filters.monthYear.split('-');
        const startDate = `${year}-${month}-01`;
        
        // หาวันสุดท้ายของเดือนนั้น
        const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
        const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

        query = query.gte('date', startDate).lte('date', endDate);
    }

    const { data, error } = await query.order('date', { ascending: false }).order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

// สร้างธุรกรรมใหม่
export async function createTransaction({ amount, type, categoryId, note, date, paymentMethod, isFixed = false }) {
    const supabase = getClient();
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) throw new Error("Unauthorized");

    const { data, error } = await supabase
        .from('transactions')
        .insert({
            user_id: user.id,
            amount: parseFloat(amount),
            type,
            category_id: type === 'expense' ? categoryId : null, // ถ้ารายรับไม่ต้องระบุหมวดหมู่รายจ่าย
            note: note || '',
            date: date || new Date().toISOString().split('T')[0],
            payment_method: paymentMethod || 'cash',
            is_fixed: isFixed
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

// ลบรายการธุรกรรม
export async function deleteTransaction(id) {
    const supabase = getClient();
    const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', id);

    if (error) throw error;
    return true;
}

// =========================================================================
// 3. รายจ่ายประจำ (Fixed Expenses)
// =========================================================================

// ดึงรายการรายจ่ายประจำทั้งหมด
export async function getFixedExpenses() {
    const supabase = getClient();
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return [];

    const { data, error } = await supabase
        .from('fixed_expenses')
        .select('*, categories(name, icon, color)')
        .eq('user_id', user.id)
        .order('day_of_month', { ascending: true });

    if (error) throw error;
    return data;
}

// สร้างรายจ่ายประจำใหม่
export async function createFixedExpense({ amount, type, categoryId, note, dayOfMonth, paymentMethod }) {
    const supabase = getClient();
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) throw new Error("Unauthorized");

    const { data, error } = await supabase
        .from('fixed_expenses')
        .insert({
            user_id: user.id,
            amount: parseFloat(amount),
            type: type || 'expense',
            category_id: type === 'expense' ? categoryId : null,
            note: note || '',
            day_of_month: parseInt(dayOfMonth),
            payment_method: paymentMethod || 'cash'
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

// ลบรายจ่ายประจำ
export async function deleteFixedExpense(id) {
    const supabase = getClient();
    const { error } = await supabase
        .from('fixed_expenses')
        .delete()
        .eq('id', id);

    if (error) throw error;
    return true;
}

// เช็คและสร้างธุรกรรมจากรายจ่ายประจำอัตโนมัติประจำเดือน
// ฟังก์ชันนี้จะดึงรายการประจำทั้งหมด หากพบว่าถึงหรือเลยวันที่ที่ต้องชำระในเดือนนั้น และยังไม่มีการบันทึก ระบบจะสร้างธุรกรรมลงตาราง transactions โดยอัตโนมัติ
export async function checkAndApplyFixedExpenses() {
    const supabase = getClient();
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return [];

    // ดึงเวลาปัจจุบัน
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');
    const currentDay = today.getDate();
    const monthYear = `${currentYear}-${currentMonth}`; // เช่น '2026-06'

    // 1. ดึงรายจ่ายประจำทั้งหมดของผู้ใช้งาน
    const fixedExpenses = await getFixedExpenses();
    if (fixedExpenses.length === 0) return [];

    // 2. ดึง log ของเดือนนี้เพื่อดูว่าตัวไหนรันไปแล้วบ้าง
    const { data: logs, error: logsError } = await supabase
        .from('fixed_expense_logs')
        .select('fixed_expense_id')
        .eq('user_id', user.id)
        .eq('month_year', monthYear);

    if (logsError) throw logsError;
    const appliedIds = new Set(logs.map(log => log.fixed_expense_id));

    const newlyApplied = [];

    // 3. วนลูปตรวจสอบทีละตัว
    for (const item of fixedExpenses) {
        // เงื่อนไข: วันที่ตัดยอด <= วันนี้ และยังไม่เคยถูกรันในเดือนนี้
        if (item.day_of_month <= currentDay && !appliedIds.has(item.id)) {
            try {
                // กำหนดวันที่ที่ต้องการบันทึก (เช่น ปีนี้-เดือนนี้-วันที่ตัดยอดของตัวนี้)
                const transactionDate = `${currentYear}-${currentMonth}-${String(item.day_of_month).padStart(2, '0')}`;

                // ก) สร้างธุรกรรม
                const { data: tx, error: txError } = await supabase
                    .from('transactions')
                    .insert({
                        user_id: user.id,
                        amount: item.amount,
                        type: item.type,
                        category_id: item.category_id,
                        note: `[ประจำ] ${item.note || ''}`,
                        date: transactionDate,
                        payment_method: item.payment_method,
                        is_fixed: true
                    })
                    .select()
                    .single();

                if (txError) throw txError;

                // ข) บันทึก log การรันของเดือนนี้
                const { error: logError } = await supabase
                    .from('fixed_expense_logs')
                    .insert({
                        user_id: user.id,
                        fixed_expense_id: item.id,
                        month_year: monthYear
                    });

                if (logError) {
                    // หากบันทึก log ไม่สำเร็จ ให้ลบธุรกรรมที่เพิ่งสร้าง เพื่อป้องกันความซ้ำซ้อน
                    await supabase.from('transactions').delete().eq('id', tx.id);
                    throw logError;
                }

                newlyApplied.push(tx);
            } catch (err) {
                console.error(`Failed to apply fixed expense ${item.id}:`, err);
            }
        }
    }

    return newlyApplied;
}
