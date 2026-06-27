-- schema.sql
-- นำโค้ดนี้ไปรันใน SQL Editor ของ Supabase เพื่อสร้างฐานข้อมูล

-- 1. สร้างตาราง Profiles สำหรับข้อมูลผู้ใช้งาน
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. สร้างตาราง Categories (หมวดหมู่รายรับ/รายจ่าย และงบประมาณ)
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL, -- เช่น 🍔, 🚗, 🎬
    color TEXT NOT NULL, -- เก็บสี Tailwind เช่น 'rose-500', 'blue-500'
    budget NUMERIC DEFAULT 0 NOT NULL, -- งบประมาณรายเดือน
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. สร้างตาราง Transactions (รายการธุรกรรมรายรับ/รายจ่าย)
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    amount NUMERIC NOT NULL,
    type TEXT CHECK (type IN ('income', 'expense')) NOT NULL,
    category_id UUID REFERENCES public.categories ON DELETE SET NULL, -- สำหรับรายจ่าย
    note TEXT,
    date DATE DEFAULT CURRENT_DATE NOT NULL,
    payment_method TEXT DEFAULT 'cash' NOT NULL, -- cash, transfer, credit
    is_fixed BOOLEAN DEFAULT false NOT NULL, -- บันทึกโดยระบบออโต้รายจ่ายประจำหรือไม่
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. สร้างตาราง Fixed Expenses (รายการรายจ่ายประจำ/อัตโนมัติประจำเดือน)
CREATE TABLE IF NOT EXISTS public.fixed_expenses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    amount NUMERIC NOT NULL,
    type TEXT CHECK (type IN ('income', 'expense')) DEFAULT 'expense' NOT NULL,
    category_id UUID REFERENCES public.categories ON DELETE SET NULL,
    note TEXT,
    day_of_month INTEGER CHECK (day_of_month >= 1 AND day_of_month <= 31) NOT NULL, -- ตัดยอดวันที่เท่าไหร่
    payment_method TEXT DEFAULT 'cash' NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. สร้างตาราง Fixed Expense Logs (ป้องกันการตัดยอดรายจ่ายประจำซ้ำซ้อนในเดือนเดียวกัน)
CREATE TABLE IF NOT EXISTS public.fixed_expense_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    fixed_expense_id UUID REFERENCES public.fixed_expenses ON DELETE CASCADE NOT NULL,
    month_year TEXT NOT NULL, -- เก็บในรูปแบบ YYYY-MM เช่น '2026-06'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (fixed_expense_id, month_year)
);

-- 6. สร้างตาราง Monthly Budgets (เป้ารายรับประจำเดือนสำหรับใช้วางแผน)
CREATE TABLE IF NOT EXISTS public.monthly_budgets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    month_year TEXT NOT NULL, -- เช่น '2026-06'
    income_goal NUMERIC DEFAULT 0 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, month_year)
);

-- =========================================================================
-- ตั้งค่า Row Level Security (RLS) เพื่อรักษาความปลอดภัยของข้อมูล
-- =========================================================================

-- เปิดใช้งาน RLS บนทุกตาราง
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_expense_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_budgets ENABLE ROW LEVEL SECURITY;

-- นโยบายสิทธิ์ (Policies) ของตาราง Profiles
CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

-- นโยบายสิทธิ์ (Policies) ของตาราง Categories
CREATE POLICY "Users can manage their own categories" ON public.categories
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- นโยบายสิทธิ์ (Policies) ของตาราง Transactions
CREATE POLICY "Users can manage their own transactions" ON public.transactions
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- นโยบายสิทธิ์ (Policies) ของตาราง Fixed Expenses
CREATE POLICY "Users can manage their own fixed expenses" ON public.fixed_expenses
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- นโยบายสิทธิ์ (Policies) ของตาราง Fixed Expense Logs
CREATE POLICY "Users can manage their own fixed expense logs" ON public.fixed_expense_logs
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- นโยบายสิทธิ์ (Policies) ของตาราง Monthly Budgets
CREATE POLICY "Users can manage their own monthly budgets" ON public.monthly_budgets
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- สร้าง Trigger สำหรับสร้าง Profile อัตโนมัติเมื่อมีการสมัครใช้งาน (Sign Up)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, avatar_url)
    VALUES (
        new.id,
        COALESCE(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
        new.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================================
-- 7. สร้างตาราง Budgets (งบประมาณแยกรายการ ไม่ผูกติดกับหมวดหมู่)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.budgets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    category_id UUID REFERENCES public.categories ON DELETE SET NULL,
    color TEXT NOT NULL DEFAULT 'rose-500',
    show_daily BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own budgets" ON public.budgets
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
