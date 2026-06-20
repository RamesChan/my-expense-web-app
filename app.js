// app.js
// ตัวควบคุมการแสดงผลของ UI, กราฟ, การทำระบบล็อกอิน และเชื่อมต่อฐานข้อมูลทั้งหมด
import { isConfigured, saveSupabaseConfig, clearSupabaseConfig, getSupabaseConfig } from './config.js';
import { signUp, signIn, signOut, getCurrentUser, getCurrentProfile, updateProfileDisplayName, subscribeToAuthChanges, resetSupabaseClient } from './auth.js';
import { getCategories, createCategory, updateCategory, deleteCategory, getTransactions, createTransaction, deleteTransaction, getFixedExpenses, createFixedExpense, deleteFixedExpense, checkAndApplyFixedExpenses } from './db.js';

// =========================================================================
// สถานะแอปพลิเคชัน (Application State)
// =========================================================================
let state = {
    currentUser: null,
    currentProfile: null,
    categories: [],
    transactions: [],
    fixedExpenses: [],
    selectedMonth: "", // YYYY-MM
    activeTab: "dashboard",
    activeAuthTab: "login", // login | signup
    
    // สำหรับ Modals
    selectedTxType: "expense", // expense | income
    selectedTxCategoryId: null,
    selectedFixedCategoryId: null,
    selectedCategoryColor: "rose-500", // สีหมวดหมู่เริ่มต้น
    editingCategoryId: null, // ID หมวดหมู่ที่กำลังแก้ไข (ถ้ามี)
    chartInstance: null
};

// =========================================================================
// ฟังก์ชันเริ่มต้นการทำงาน (App Initialization)
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
    initMonthSelector();
    checkAppRouting();
    setupEventListeners();
    
    // หากคอนฟิกเรียบร้อยแล้ว ให้สมัครรับการเปลี่ยนแปลงสถานะล็อกอิน
    if (isConfigured()) {
        subscribeToAuthChanges((event, session) => {
            console.log("Auth Event Changed:", event, session);
            checkAppRouting();
        });
    }
});

// ตรวจสอบหน้าจอที่ควรแสดงผล
async function checkAppRouting() {
    const setupScreen = document.getElementById("screen-setup");
    const authScreen = document.getElementById("screen-auth");
    const mainScreen = document.getElementById("screen-main");

    // 1. ตรวจสอบว่ามี Supabase config หรือยัง
    if (!isConfigured()) {
        showScreen("setup");
        return;
    }

    try {
        // 2. ตรวจสอบว่าล็อกอินหรือยัง
        const user = await getCurrentUser();
        state.currentUser = user;

        if (!user) {
            showScreen("auth");
        } else {
            showScreen("main");
            // โหลดข้อมูลทั้งหมด
            await loadAllData();
        }
    } catch (err) {
        console.error("Routing error:", err);
        // แสดงหน้าล็อกอินหากเกิดข้อผิดพลาด
        showScreen("auth");
    }
}

// ควบคุมการแสดงผลแต่ละหน้าจอหลัก
function showScreen(screenName) {
    const screens = {
        setup: document.getElementById("screen-setup"),
        auth: document.getElementById("screen-auth"),
        main: document.getElementById("screen-main")
    };

    Object.keys(screens).forEach(name => {
        if (name === screenName) {
            screens[name].classList.remove("hidden");
        } else {
            screens[name].classList.add("hidden");
        }
    });
}

// สร้างตัวเลือกเดือนย้อนหลัง 12 เดือนใน Select
function initMonthSelector() {
    const selector = document.getElementById("month-selector");
    const today = new Date();
    
    // เริ่มด้วยเดือนปัจจุบัน
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    state.selectedMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    const monthNames = [
        "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
    ];

    selector.innerHTML = "";
    
    // สร้างตัวเลือกย้อนหลัง 12 เดือน
    for (let i = 0; i < 12; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const value = `${y}-${String(m).padStart(2, '0')}`;
        
        // แปลงปี ค.ศ. เป็น พ.ศ.
        const label = `${monthNames[m - 1]} ${y + 543}`;
        
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        selector.appendChild(option);
    }

    // เซ็ตให้เลือกเดือนล่าสุด
    selector.value = state.selectedMonth;

    // เฝ้าฟังการเปลี่ยนเดือน
    selector.addEventListener("change", async (e) => {
        state.selectedMonth = e.target.value;
        await loadAllData();
    });
}

// =========================================================================
// การโหลดข้อมูลและอัปเดต UI (Data Loading & Rendering)
// =========================================================================
async function loadAllData() {
    if (!state.currentUser) return;

    try {
        // อัปเดตข้อมูลผู้ใช้งานและโปรไฟล์
        state.currentProfile = await getCurrentProfile();
        updateUserHeader();

        // 1. รันระบบเช็คและตัดยอดรายจ่ายประจำอัตโนมัติ (Fixed Expenses)
        try {
            const applied = await checkAndApplyFixedExpenses();
            if (applied && applied.length > 0) {
                console.log(`Applied ${applied.length} fixed expenses automatically.`);
            }
        } catch (e) {
            console.error("Auto fixed expenses check failed:", e);
        }

        // 2. ดึงข้อมูลจากฐานข้อมูล
        state.categories = await getCategories();
        state.transactions = await getTransactions({ monthYear: state.selectedMonth });
        state.fixedExpenses = await getFixedExpenses();

        // 3. เรนเดอร์ UI
        renderDashboard();
        renderFixedExpenses();
        renderCategories();
        renderSettingsPage();
        
        // อัปเดต Category Pickers ใน Modals
        updateCategoryPickers();
        
    } catch (err) {
        console.error("Error loading app data:", err);
        alert("ไม่สามารถดึงข้อมูลได้: " + err.message);
    }
}

// แสดงชื่อผู้ใช้ใน Header
function updateUserHeader() {
    const userPill = document.getElementById("user-pill");
    if (state.currentProfile) {
        userPill.textContent = `👤 ${state.currentProfile.display_name || "ไม่มีชื่อ"}`;
    } else {
        userPill.textContent = "👤 ผู้ใช้งาน";
    }
}

// เรนเดอร์หน้าแดชบอร์ดหลัก (สรุปงบรวม, กราฟ, หมวดหมู่, รายการล่าสุด)
function renderDashboard() {
    // 1. คำนวณรายรับและรายจ่ายในเดือนปัจจุบัน
    let totalIncome = 0;
    let totalExpenses = 0;

    state.transactions.forEach(tx => {
        if (tx.type === 'income') {
            totalIncome += parseFloat(tx.amount);
        } else {
            totalExpenses += parseFloat(tx.amount);
        }
    });

    // 2. คำนวณงบประมาณรวมจากหมวดหมู่ทั้งหมดของเดือนนั้น
    let totalBudget = 0;
    state.categories.forEach(cat => {
        totalBudget += parseFloat(cat.budget) || 0;
    });

    // คำนวณงบคงเหลือ
    const remainingBudget = totalBudget - totalExpenses;
    const remainingPercent = totalBudget > 0 ? Math.max(0, Math.round((remainingBudget / totalBudget) * 100)) : 0;
    const spentPercent = totalBudget > 0 ? Math.min(100, Math.round((totalExpenses / totalBudget) * 100)) : 0;

    // อัปเดตการแสดงผลในหน้าจอ
    document.getElementById("dashboard-income").textContent = `+฿${totalIncome.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById("dashboard-expenses").textContent = `-฿${totalExpenses.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById("dashboard-remaining").textContent = `฿${remainingBudget.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById("dashboard-budget-total").textContent = `จากงบ: ฿${totalBudget.toLocaleString('th-TH')}`;
    
    const percentEl = document.getElementById("dashboard-remaining-percent");
    percentEl.textContent = `เหลือ ${remainingPercent}%`;
    
    // เปลี่ยนสีเปอรเซ็นต์งบประมาณ
    if (remainingPercent < 15) {
        percentEl.className = "text-xs bg-rose-500/20 text-rose-400 px-2.5 py-0.5 rounded-full font-medium";
    } else if (remainingPercent < 40) {
        percentEl.className = "text-xs bg-yellow-500/20 text-yellow-400 px-2.5 py-0.5 rounded-full font-medium";
    } else {
        percentEl.className = "text-xs bg-emerald-500/20 text-emerald-400 px-2.5 py-0.5 rounded-full font-medium";
    }

    // แถบ Progress Bar
    const progressBar = document.getElementById("dashboard-progress-bar");
    progressBar.style.width = `${remainingPercent}%`;
    if (remainingPercent < 15) {
        progressBar.className = "bg-rose-500 h-2 rounded-full transition-all duration-500";
    } else if (remainingPercent < 40) {
        progressBar.className = "bg-yellow-500 h-2 rounded-full transition-all duration-500";
    } else {
        progressBar.className = "bg-emerald-400 h-2 rounded-full transition-all duration-500";
    }

    // 3. วาดกราฟวงกลมและ Legend
    renderExpenseChart();

    // 4. เรนเดอร์การใช้งบแยกตามหมวดหมู่
    renderCategoryBudgets(totalExpenses);

    // 5. เรนเดอร์รายการธุรกรรมล่าสุด
    renderRecentTransactions();
}

// ฟังก์ชันวาดกราฟสัดส่วนรายจ่ายรายหมวดหมู่ (ด้วย Chart.js)
function renderExpenseChart() {
    const ctx = document.getElementById('expenseChart').getContext('2d');
    const legendEl = document.getElementById("chart-legend");
    legendEl.innerHTML = "";

    // กรองและรวมรายจ่ายแยกตามหมวดหมู่
    const expenseByCategory = {};
    let totalExpense = 0;

    state.transactions.forEach(tx => {
        if (tx.type === 'expense') {
            const amount = parseFloat(tx.amount);
            totalExpense += amount;
            
            // หาชื่อหมวดหมู่และสี
            const catName = tx.categories?.name || "ไม่ระบุหมวดหมู่";
            const catColor = tx.categories?.color || "slate-400";
            const catIcon = tx.categories?.icon || "❓";

            if (!expenseByCategory[catName]) {
                expenseByCategory[catName] = {
                    amount: 0,
                    color: getHexColorFromTailwind(catColor),
                    icon: catIcon
                };
            }
            expenseByCategory[catName].amount += amount;
        }
    });

    const labels = Object.keys(expenseByCategory);
    const dataValues = labels.map(label => expenseByCategory[label].amount);
    const backgroundColors = labels.map(label => expenseByCategory[label].color);

    // ล้างกราฟเก่าออกก่อน (ป้องกันการแสดงซ้อนทับกัน)
    if (state.chartInstance) {
        state.chartInstance.destroy();
    }

    if (totalExpense === 0) {
        // ไม่มีค่าใช้จ่ายเลย
        legendEl.innerHTML = `
            <div class="text-center py-6 text-slate-400 font-light">
                <span class="text-2xl block mb-1">🪙</span>
                ไม่มีรายการรายจ่ายในเดือนนี้
            </div>
        `;
        // วาดวงกลมเปล่าสีเทา
        state.chartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['ไม่มีการใช้จ่าย'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['#e2e8f0'],
                    borderWidth: 0
                }]
            },
            options: {
                cutout: '70%',
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                responsive: true,
                maintainAspectRatio: false
            }
        });
        return;
    }

    // วาดกราฟจริง
    state.chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: dataValues,
                backgroundColor: backgroundColors,
                borderWidth: 1,
                borderColor: '#ffffff'
            }]
        },
        options: {
            cutout: '70%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const value = context.raw || 0;
                            const percent = Math.round((value / totalExpense) * 100);
                            return ` ${context.label}: ฿${value.toLocaleString()} (${percent}%)`;
                        }
                    }
                }
            },
            responsive: true,
            maintainAspectRatio: false
        }
    });

    // สร้าง Legend แสดงสัดส่วนด้านขวา
    labels.forEach(label => {
        const item = expenseByCategory[label];
        const percent = Math.round((item.amount / totalExpense) * 100);
        
        const legendItem = document.createElement("div");
        legendItem.className = "flex justify-between items-center text-[11px] text-slate-600";
        legendItem.innerHTML = `
            <div class="flex items-center space-x-1.5 truncate mr-2">
                <span class="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style="background-color: ${item.color}"></span>
                <span class="truncate">${item.icon} ${label}</span>
            </div>
            <div class="font-medium text-right flex-shrink-0">
                <span>฿${Math.round(item.amount).toLocaleString()}</span>
                <span class="text-slate-400 ml-1 font-light">(${percent}%)</span>
            </div>
        `;
        legendEl.appendChild(legendItem);
    });
}

// ช่วยดึงสีรหัส Hex จากคลาสสี Tailwind
function getHexColorFromTailwind(colorClass) {
    const colors = {
        'rose-500': '#f43f5e',
        'blue-500': '#3b82f6',
        'yellow-500': '#eab308',
        'purple-500': '#a855f7',
        'emerald-500': '#10b981',
        'pink-500': '#ec4899',
        'slate-400': '#94a3b8',
        'indigo-500': '#6366f1',
        'indigo-600': '#4f46e5'
    };
    return colors[colorClass] || '#6366f1';
}

// แสดงรายการงบประมาณรายหมวดหมู่บนหน้า Dashboard
function renderCategoryBudgets(totalSpent) {
    const listEl = document.getElementById("dashboard-categories-list");
    listEl.innerHTML = "";

    // 1. คำนวณรายจ่ายสะสมแยกตาม Category ID
    const spentByCatId = {};
    state.transactions.forEach(tx => {
        if (tx.type === 'expense' && tx.category_id) {
            spentByCatId[tx.category_id] = (spentByCatId[tx.category_id] || 0) + parseFloat(tx.amount);
        }
    });

    // 2. วนลูปสร้างรายการการใช้งบ
    // กรองเอาเฉพาะหมวดหมู่ที่เป็น "รายจ่าย" (มีงบประมาณ > 0 หรือชื่อไม่ใช้เกี่ยวกับรายได้)
    const expenseCategories = state.categories.filter(cat => cat.budget > 0 || cat.name !== "รายได้ประจำ");

    if (expenseCategories.length === 0) {
        listEl.innerHTML = `<div class="text-center py-4 text-xs text-slate-400">ยังไม่มีหมวดหมู่รายจ่าย</div>`;
        return;
    }

    expenseCategories.forEach(cat => {
        const spent = spentByCatId[cat.id] || 0;
        const budget = parseFloat(cat.budget) || 0;
        const remains = budget - spent;
        
        let percent = budget > 0 ? Math.round((spent / budget) * 100) : 0;
        let isOver = spent > budget && budget > 0;

        const card = document.createElement("div");
        card.className = "bg-white border border-slate-100 rounded-xl p-3.5 shadow-sm";
        card.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <div class="flex items-center space-x-3">
                    <div class="w-9 h-9 bg-${cat.color}/10 text-${cat.color} rounded-xl flex items-center justify-center text-lg">
                        ${cat.icon}
                    </div>
                    <div>
                        <h4 class="font-medium text-slate-800 text-sm">${cat.name}</h4>
                        ${
                            isOver 
                            ? `<p class="text-[10px] text-rose-500 font-medium"><i class="fa-solid fa-circle-exclamation mr-1"></i>เกินงบแล้ว! ฿${Math.abs(remains).toLocaleString()}</p>`
                            : budget > 0 
                            ? `<p class="text-[10px] text-slate-400 font-light">เหลือ ฿${remains.toLocaleString()}</p>`
                            : `<p class="text-[10px] text-slate-400 font-light">ไม่มีกำหนดงบประมาณ</p>`
                        }
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-sm font-semibold ${isOver ? 'text-rose-600' : 'text-slate-800'}">฿${spent.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</p>
                    ${budget > 0 ? `<p class="text-[10px] text-slate-400">งบ: ฿${budget.toLocaleString()}</p>` : ''}
                </div>
            </div>
            ${
                budget > 0 
                ? `
                <div class="w-full bg-slate-100 rounded-full h-1.5">
                    <div class="bg-${isOver ? 'rose' : cat.color.split('-')[0]}-500 h-1.5 rounded-full transition-all duration-300" style="width: ${Math.min(100, percent)}%"></div>
                </div>
                `
                : ''
            }
        `;
        listEl.appendChild(card);
    });
}

// แสดงรายการธุรกรรมล่าสุดในหน้า Dashboard
function renderRecentTransactions() {
    const listEl = document.getElementById("dashboard-transactions-list");
    listEl.innerHTML = "";

    if (state.transactions.length === 0) {
        listEl.innerHTML = `
            <div class="bg-white border border-slate-100 p-8 rounded-2xl text-center text-xs text-slate-400">
                🫙 ไม่มีรายการธุรกรรมในเดือนนี้
            </div>
        `;
        return;
    }

    state.transactions.forEach(tx => {
        const isIncome = tx.type === 'income';
        const dateObj = new Date(tx.date);
        
        // แปลงฟอร์แมตวันที่แบบสั้นภาษาไทย
        const day = dateObj.getDate();
        const shortMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
        const dateStr = `${day} ${shortMonths[dateObj.getMonth()]}`;

        const item = document.createElement("div");
        item.className = "bg-white p-3 rounded-xl border border-slate-100 flex justify-between items-center group hover:bg-slate-50 transition-all";
        item.innerHTML = `
            <div class="flex items-center space-x-3 truncate">
                <!-- ไอคอนหมวดหมู่ -->
                <div class="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${isIncome ? 'bg-emerald-50 text-emerald-500' : `bg-${tx.categories?.color || 'slate'}-50 text-${tx.categories?.color || 'slate'}-500`}">
                    ${isIncome ? '💰' : (tx.categories?.icon || '❓')}
                </div>
                <div class="truncate">
                    <p class="text-xs font-semibold text-slate-800 truncate">${tx.note || (isIncome ? 'รายรับ' : (tx.categories?.name || 'รายจ่าย'))}</p>
                    <div class="flex items-center space-x-2 text-[10px] text-slate-400 mt-0.5">
                        <span>📅 ${dateStr}</span>
                        <span>•</span>
                        <span>${tx.payment_method === 'cash' ? 'เงินสด' : tx.payment_method === 'transfer' ? 'โอนเงิน' : 'บัตรเครดิต'}</span>
                        ${tx.is_fixed ? `<span class="bg-indigo-50 text-indigo-600 px-1 py-0.2 rounded font-medium text-[8px]">ประจำ</span>` : ''}
                    </div>
                </div>
            </div>
            
            <div class="flex items-center space-x-3 flex-shrink-0">
                <span class="text-sm font-semibold ${isIncome ? 'text-emerald-500' : 'text-slate-700'}">
                    ${isIncome ? '+' : '-'}฿${parseFloat(tx.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                </span>
                
                <!-- ปุ่มลบธุรกรรม -->
                <button data-id="${tx.id}" class="btn-delete-tx text-slate-300 hover:text-rose-500 text-xs w-6 h-6 rounded-full hover:bg-rose-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
        listEl.appendChild(item);
    });

    // ดักฟังการคลิกลบ
    document.querySelectorAll(".btn-delete-tx").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            if (confirm("ต้องการลบรายการธุรกรรมนี้ใช่หรือไม่?")) {
                try {
                    await deleteTransaction(id);
                    await loadAllData();
                } catch (err) {
                    alert("ไม่สามารถลบได้: " + err.message);
                }
            }
        });
    });
}

// เรนเดอร์รายการรายจ่ายประจำใน Page 2
function renderFixedExpenses() {
    const listEl = document.getElementById("fixed-expenses-list");
    listEl.innerHTML = "";

    if (state.fixedExpenses.length === 0) {
        listEl.innerHTML = `
            <div class="bg-white border border-slate-100 p-10 rounded-2xl text-center text-xs text-slate-400">
                📆 ยังไม่มีรายการรายจ่ายประจำรายเดือน
            </div>
        `;
        return;
    }

    state.fixedExpenses.forEach(item => {
        const row = document.createElement("div");
        row.className = "p-4 bg-white rounded-xl border border-slate-100 flex justify-between items-center group hover:bg-slate-50 transition-all";
        row.innerHTML = `
            <div class="flex items-center space-x-3 truncate">
                <div class="w-10 h-10 bg-${item.categories?.color || 'indigo'}-50 text-${item.categories?.color || 'indigo'}-500 rounded-xl flex items-center justify-center text-lg flex-shrink-0">
                    ${item.categories?.icon || '🏠'}
                </div>
                <div class="truncate">
                    <p class="text-sm font-semibold text-slate-800 truncate">${item.note || item.categories?.name || 'รายจ่ายประจำ'}</p>
                    <p class="text-xs text-slate-400 mt-0.5">ตัดยอดทุกวันที่ ${item.day_of_month} ของเดือน • ${item.payment_method === 'cash' ? 'เงินสด' : item.payment_method === 'transfer' ? 'โอนเงิน' : 'บัตรเครดิต'}</p>
                </div>
            </div>
            <div class="flex items-center space-x-3 flex-shrink-0">
                <span class="font-semibold text-slate-800">฿${parseFloat(item.amount).toLocaleString()}</span>
                <!-- ปุ่มลบ -->
                <button data-id="${item.id}" class="btn-delete-fixed text-slate-300 hover:text-rose-500 text-xs w-6 h-6 rounded-full hover:bg-rose-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
        listEl.appendChild(row);
    });

    // ดักฟังการคลิกลบรายจ่ายประจำ
    document.querySelectorAll(".btn-delete-fixed").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            if (confirm("ต้องการยกเลิกรายจ่ายประจำรายการนี้ใช่หรือไม่? (การยกเลิกจะไม่มีผลต่อรายการที่ถูกบันทึกลงบัญชีไปแล้วก่อนหน้า)")) {
                try {
                    await deleteFixedExpense(id);
                    await loadAllData();
                } catch (err) {
                    alert("ลบไม่สำเร็จ: " + err.message);
                }
            }
        });
    });
}

// เรนเดอร์หน้ารวมหมวดหมู่ทั้งหมดใน Page 3
function renderCategories() {
    const gridEl = document.getElementById("categories-grid");
    gridEl.innerHTML = "";

    state.categories.forEach(cat => {
        const item = document.createElement("div");
        item.className = "bg-white p-4 border border-slate-100 rounded-xl shadow-sm text-center relative group hover:bg-slate-50 transition-all cursor-pointer";
        item.innerHTML = `
            <span class="text-2xl block mb-1">${cat.icon}</span>
            <p class="text-xs font-semibold text-slate-700">${cat.name}</p>
            <p class="text-[10px] text-slate-400 mt-1">${cat.budget > 0 ? `งบ: ฿${cat.budget.toLocaleString()}` : 'ไม่มีงบประมาณ'}</p>
            
            <!-- ปุ่มแก้ไขหมวดหมู่ -->
            <button data-id="${cat.id}" class="btn-edit-category absolute top-2 right-2 text-slate-300 hover:text-indigo-600 text-[10px] opacity-0 group-hover:opacity-100 transition-all w-5 h-5 rounded-full hover:bg-slate-100 flex items-center justify-center">
                <i class="fa-solid fa-pen"></i>
            </button>
        `;
        gridEl.appendChild(item);
    });

    // ปุ่มสร้างหมวดหมู่ใหม่แบบ Grid
    const addCard = document.createElement("div");
    addCard.className = "p-4 border border-slate-200 border-dashed rounded-xl text-center cursor-pointer hover:bg-slate-50 transition-all flex flex-col justify-center items-center h-full min-h-[96px]";
    addCard.innerHTML = `
        <span class="text-xl block mb-0.5 text-slate-400">+</span>
        <p class="text-xs font-medium text-slate-400">เพิ่มหมวดหมู่</p>
    `;
    addCard.onclick = () => window.openCategoryModal();
    gridEl.appendChild(addCard);

    // ลิงก์แก้ไขหมวดหมู่
    document.querySelectorAll(".btn-edit-category").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = btn.getAttribute("data-id");
            const cat = state.categories.find(c => c.id === id);
            if (cat) {
                window.openCategoryModal(cat);
            }
        });
    });
}

// อัปเดตข้อมูลหน้าตั้งค่า Page 4
function renderSettingsPage() {
    if (state.currentUser) {
        document.getElementById("profile-email").textContent = state.currentUser.email;
        document.getElementById("settings-display-name").value = state.currentProfile?.display_name || "";
        document.getElementById("profile-name").textContent = state.currentProfile?.display_name || state.currentUser.email.split('@')[0];
        
        // รูปโปรไฟล์สั้นๆ
        const initial = (state.currentProfile?.display_name || state.currentUser.email)[0].toUpperCase();
        document.getElementById("profile-avatar").textContent = initial;
    }

    const conf = getSupabaseConfig();
    document.getElementById("settings-db-url").textContent = conf.supabaseUrl || "ไม่ได้ระบุ";
}

// =========================================================================
// ตัวเลือกหมวดหมู่ใน Modals (Dynamic Category Pickers)
// =========================================================================
function updateCategoryPickers() {
    // 1. หมวดหมู่ใน Modal บันทึกรายการ
    const txPicker = document.getElementById("modal-category-picker");
    txPicker.innerHTML = "";
    
    // 2. หมวดหมู่ใน Modal บันทึกรายจ่ายประจำ
    const fixedPicker = document.getElementById("fixed-category-picker");
    fixedPicker.innerHTML = "";

    // กรองเอาหมวดหมู่รายจ่ายเท่านั้น (ยกเว้น รายได้ประจำ)
    const expenseCategories = state.categories.filter(cat => cat.name !== "รายได้ประจำ");

    if (expenseCategories.length === 0) {
        const errorMsg = `<div class="text-xs text-slate-400 py-1 font-light">กรุณาสร้างหมวดหมู่อย่างน้อย 1 รายการก่อน</div>`;
        txPicker.innerHTML = errorMsg;
        fixedPicker.innerHTML = errorMsg;
        return;
    }

    expenseCategories.forEach(cat => {
        // สำหรับหน้าบันทึกธุรกรรม
        const txBtn = document.createElement("button");
        txBtn.type = "button";
        txBtn.className = `btn-picker-cat flex-shrink-0 px-4 py-2 bg-slate-50 border border-slate-100 rounded-full text-xs font-semibold text-slate-600 flex items-center space-x-1.5 cursor-pointer transition-all`;
        txBtn.setAttribute("data-id", cat.id);
        txBtn.innerHTML = `<span>${cat.icon}</span> <span>${cat.name}</span>`;
        txBtn.onclick = () => selectCategoryForTransaction(cat.id, txBtn);
        txPicker.appendChild(txBtn);

        // สำหรับหน้าบันทึกรายจ่ายประจำ
        const fixedBtn = document.createElement("button");
        fixedBtn.type = "button";
        fixedBtn.className = `btn-picker-fixed-cat flex-shrink-0 px-4 py-2 bg-slate-50 border border-slate-100 rounded-full text-xs font-semibold text-slate-600 flex items-center space-x-1.5 cursor-pointer transition-all`;
        fixedBtn.setAttribute("data-id", cat.id);
        fixedBtn.innerHTML = `<span>${cat.icon}</span> <span>${cat.name}</span>`;
        fixedBtn.onclick = () => selectCategoryForFixed(cat.id, fixedBtn);
        fixedPicker.appendChild(fixedBtn);
    });

    // รีเซ็ตค่าการเลือกเริ่มต้น
    state.selectedTxCategoryId = null;
    state.selectedFixedCategoryId = null;
}

function selectCategoryForTransaction(catId, btnElement) {
    state.selectedTxCategoryId = catId;
    document.querySelectorAll(".btn-picker-cat").forEach(btn => {
        btn.className = "btn-picker-cat flex-shrink-0 px-4 py-2 bg-slate-50 border border-slate-100 rounded-full text-xs font-semibold text-slate-600 flex items-center space-x-1.5 cursor-pointer transition-all";
    });
    // ไฮไลต์ปุ่มที่เลือก
    const selectedCat = state.categories.find(c => c.id === catId);
    btnElement.className = `btn-picker-cat flex-shrink-0 px-4 py-2 bg-indigo-50 border border-indigo-300 text-indigo-700 rounded-full text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-all`;
}

function selectCategoryForFixed(catId, btnElement) {
    state.selectedFixedCategoryId = catId;
    document.querySelectorAll(".btn-picker-fixed-cat").forEach(btn => {
        btn.className = "btn-picker-fixed-cat flex-shrink-0 px-4 py-2 bg-slate-50 border border-slate-100 rounded-full text-xs font-semibold text-slate-600 flex items-center space-x-1.5 cursor-pointer transition-all";
    });
    btnElement.className = `btn-picker-fixed-cat flex-shrink-0 px-4 py-2 bg-indigo-50 border border-indigo-300 text-indigo-700 rounded-full text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-all`;
}

// =========================================================================
// ควบคุมหน้าจอและการเปิด/ปิด Modals (Navigation & Modal Sheets)
// =========================================================================

// ฟังก์ชันสลับเมนูบาร์ด้านล่าง
window.switchTab = function(tabId) {
    state.activeTab = tabId;

    // 1. ซ่อนเนื้อหาทุกหน้าจอ
    document.querySelectorAll('.page-content').forEach(page => {
        page.classList.remove('active');
    });
    // แสดงเฉพาะหน้าที่เลือก
    const pageEl = document.getElementById('page-' + tabId);
    if (pageEl) pageEl.classList.add('active');

    // 2. ปรับสไตล์ปุ่มเมนูให้ทำงาน (Active)
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('text-indigo-600');
        btn.classList.add('text-slate-400');
    });
    const activeBtn = document.getElementById('nav-' + tabId);
    if (activeBtn) {
        activeBtn.classList.remove('text-slate-400');
        activeBtn.classList.add('text-indigo-600');
    }
};

// สลับระหว่าง รายจ่าย/รายรับ ใน Modal
function switchTransactionType(type) {
    state.selectedTxType = type;
    const btnExpense = document.getElementById("type-expense");
    const btnIncome = document.getElementById("type-income");
    const categorySection = document.getElementById("category-picker-section");

    if (type === "expense") {
        btnExpense.className = "flex-1 py-1.5 text-xs font-semibold rounded-lg bg-white text-slate-800 shadow-sm transition-all";
        btnIncome.className = "flex-1 py-1.5 text-xs font-semibold rounded-lg text-slate-500 transition-all";
        categorySection.classList.remove("hidden");
    } else {
        btnIncome.className = "flex-1 py-1.5 text-xs font-semibold rounded-lg bg-white text-slate-800 shadow-sm transition-all";
        btnExpense.className = "flex-1 py-1.5 text-xs font-semibold rounded-lg text-slate-500 transition-all";
        categorySection.classList.add("hidden"); // ปิดการเลือกหมวดหมู่ถ้าลงรายรับ
    }
}

// เปิด/ปิด Modal บันทึกธุรกรรม
window.toggleModal = function(show) {
    const modal = document.getElementById('expense-modal');
    const sheet = modal.querySelector('div');

    if (show) {
        // ค่าเริ่มต้นในฟอร์มเมื่อเปิด Modal บันทึก
        document.getElementById("tx-amount").value = "";
        document.getElementById("tx-note").value = "";
        document.getElementById("tx-date").value = new Date().toISOString().split('T')[0];
        document.getElementById("lbl-tx-date").textContent = "วันนี้";
        document.getElementById("tx-payment").value = "cash";
        
        switchTransactionType("expense");
        updateCategoryPickers();

        modal.classList.remove('opacity-0', 'pointer-events-none');
        setTimeout(() => {
            sheet.classList.remove('translate-y-full');
        }, 50);
    } else {
        sheet.classList.add('translate-y-full');
        setTimeout(() => {
            modal.classList.add('opacity-0', 'pointer-events-none');
        }, 300);
    }
};

// เปิด/ปิด Modal จัดการหมวดหมู่
window.openCategoryModal = function(catObj = null) {
    const modal = document.getElementById("category-modal");
    const sheet = modal.querySelector("div");
    const titleEl = document.getElementById("category-modal-title");
    const btnDelete = document.getElementById("btn-delete-category");

    if (catObj) {
        // โหมดการแก้ไข
        state.editingCategoryId = catObj.id;
        titleEl.textContent = "แก้ไขหมวดหมู่";
        document.getElementById("cat-icon").value = catObj.icon;
        document.getElementById("cat-name").value = catObj.name;
        document.getElementById("cat-budget").value = catObj.budget;
        selectColorDot(catObj.color);
        btnDelete.classList.remove("hidden");
    } else {
        // โหมดการสร้างใหม่
        state.editingCategoryId = null;
        titleEl.textContent = "เพิ่มหมวดหมู่ใหม่";
        document.getElementById("cat-icon").value = "";
        document.getElementById("cat-name").value = "";
        document.getElementById("cat-budget").value = "";
        selectColorDot("rose-500");
        btnDelete.classList.add("hidden");
    }

    modal.classList.remove("opacity-0", "pointer-events-none");
    setTimeout(() => {
        sheet.classList.remove("translate-y-full");
    }, 50);
};

window.closeCategoryModal = function() {
    const modal = document.getElementById("category-modal");
    const sheet = modal.querySelector("div");
    sheet.classList.add("translate-y-full");
    setTimeout(() => {
        modal.classList.add("opacity-0", "pointer-events-none");
    }, 300);
};

// ไฮไลต์จุดเลือกสีหมวดหมู่
function selectColorDot(colorClass) {
    state.selectedCategoryColor = colorClass;
    document.querySelectorAll(".color-dot").forEach(dot => {
        if (dot.getAttribute("data-color") === colorClass) {
            dot.className = "color-dot w-8 h-8 rounded-full bg-" + colorClass + " ring-2 ring-offset-2 ring-indigo-500";
        } else {
            const dc = dot.getAttribute("data-color");
            dot.className = "color-dot w-8 h-8 rounded-full bg-" + dc + " ring-0 ring-offset-2 ring-indigo-500";
        }
    });
}

// เปิด/ปิด Modal บันทึกรายจ่ายประจำ
window.openFixedModal = function() {
    const modal = document.getElementById("fixed-modal");
    const sheet = modal.querySelector("div");

    // เคลียร์ฟอร์ม
    document.getElementById("fixed-amount").value = "";
    document.getElementById("fixed-note").value = "";
    document.getElementById("fixed-day").value = "";
    document.getElementById("fixed-payment").value = "cash";
    updateCategoryPickers();

    modal.classList.remove("opacity-0", "pointer-events-none");
    setTimeout(() => {
        sheet.classList.remove("translate-y-full");
    }, 50);
};

window.closeFixedModal = function() {
    const modal = document.getElementById("fixed-modal");
    const sheet = modal.querySelector("div");
    sheet.classList.add("translate-y-full");
    setTimeout(() => {
        modal.classList.add("opacity-0", "pointer-events-none");
    }, 300);
};

// =========================================================================
// จัดการ Event Listeners (UI Actions & Form Submissions)
// =========================================================================
function setupEventListeners() {
    
    // --- 1. หน้าจอ SETUP SUPABASE ---
    const formSetup = document.getElementById("form-setup");
    if (formSetup) {
        formSetup.addEventListener("submit", (e) => {
            e.preventDefault();
            const url = document.getElementById("setup-url").value;
            const key = document.getElementById("setup-key").value;
            
            try {
                saveSupabaseConfig(url, key);
                resetSupabaseClient();
                alert("บันทึกข้อมูลการตั้งค่าเชื่อมต่อสำเร็จ!");
                
                // รีโหลดหน้านี้ใหม่เพื่อโหลดสคริปต์ Supabase สมบูรณ์
                window.location.reload();
            } catch (err) {
                alert("ข้อผิดพลาดในการตั้งค่า: " + err.message);
            }
        });
    }

    // --- 2. หน้าจอ AUTH (LOGIN / SIGNUP) ---
    // เมนูแท็บสลับฟอร์ม
    const tabLogin = document.getElementById("tab-login");
    const tabSignup = document.getElementById("tab-signup");
    const groupName = document.getElementById("group-display-name");
    const btnSubmit = document.getElementById("btn-auth-submit");

    if (tabLogin && tabSignup) {
        tabLogin.addEventListener("click", () => {
            state.activeAuthTab = "login";
            tabLogin.className = "flex-1 py-2 text-xs font-semibold rounded-lg bg-white/10 text-white transition-all";
            tabSignup.className = "flex-1 py-2 text-xs font-semibold rounded-lg text-slate-400 hover:text-white transition-all";
            groupName.classList.add("hidden");
            document.getElementById("auth-name").required = false;
            btnSubmit.textContent = "เข้าสู่ระบบ";
        });

        tabSignup.addEventListener("click", () => {
            state.activeAuthTab = "signup";
            tabSignup.className = "flex-1 py-2 text-xs font-semibold rounded-lg bg-white/10 text-white transition-all";
            tabLogin.className = "flex-1 py-2 text-xs font-semibold rounded-lg text-slate-400 hover:text-white transition-all";
            groupName.classList.remove("hidden");
            document.getElementById("auth-name").required = true;
            btnSubmit.textContent = "สมัครสมาชิก";
        });
    }

    // จัดการการกดยอมรับฟอร์มล็อกอิน/สมัครสมาชิก
    const formAuth = document.getElementById("form-auth");
    if (formAuth) {
        formAuth.addEventListener("submit", async (e) => {
            e.preventDefault();
            const email = document.getElementById("auth-email").value;
            const password = document.getElementById("auth-password").value;
            const displayName = document.getElementById("auth-name").value;

            try {
                if (state.activeAuthTab === "login") {
                    await signIn(email, password);
                } else {
                    await signUp(email, password, displayName);
                    alert("สมัครสมาชิกสำเร็จ! กรุณาเข้าสู่ระบบด้วยรหัสที่ตั้งไว้");
                    tabLogin.click();
                    return;
                }
                
                // หลังจากล็อกอินสำเร็จ
                checkAppRouting();
            } catch (err) {
                console.error("Auth error:", err);
                alert("ไม่สำเร็จ: " + err.message);
            }
        });
    }

    // แก้ไขตั้งค่า DB ในหน้าล็อกอิน
    const btnChangeConfig = document.getElementById("btn-change-config");
    if (btnChangeConfig) {
        btnChangeConfig.addEventListener("click", () => {
            if (confirm("ต้องการล้างการตั้งค่า Database เดิมใช่หรือไม่?")) {
                clearSupabaseConfig();
                resetSupabaseClient();
                showScreen("setup");
            }
        });
    }

    // --- 3. หน้าจอหลัก (MAIN MAIN MAIN) ---
    // ปุ่มล็อกเอาท์ในหน้าตั้งค่า
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
        btnLogout.addEventListener("click", async () => {
            if (confirm("ต้องการออกจากระบบใช่หรือไม่?")) {
                try {
                    await signOut();
                    state.currentUser = null;
                    state.currentProfile = null;
                    checkAppRouting();
                } catch (err) {
                    alert("ออกจากระบบไม่สำเร็จ: " + err.message);
                }
            }
        });
    }

    // เปลี่ยนแปลง Database จากหน้าตั้งค่าด้านใน
    const btnResetDb = document.getElementById("btn-reset-db");
    if (btnResetDb) {
        btnResetDb.addEventListener("click", () => {
            if (confirm("คุณแน่ใจว่าต้องการล้างฐานข้อมูลเชื่อมต่อเดิม? คุณจะต้องล็อกอินใหม่อีกครั้ง")) {
                clearSupabaseConfig();
                resetSupabaseClient();
                window.location.reload();
            }
        });
    }

    // บันทึกโปรไฟล์ (เปลี่ยนชื่อผู้ใช้)
    const btnSaveProfile = document.getElementById("btn-save-profile");
    if (btnSaveProfile) {
        btnSaveProfile.addEventListener("click", async () => {
            const newName = document.getElementById("settings-display-name").value.trim();
            if (!newName) return alert("กรุณากรอกชื่อ");

            try {
                await updateProfileDisplayName(newName);
                alert("อัปเดตชื่อผู้ใช้งานเรียบร้อยแล้ว!");
                await loadAllData();
            } catch (err) {
                alert("ไม่สามารถบันทึกชื่อได้: " + err.message);
            }
        });
    }

    // --- 4. บันทึกธุรกรรม (TRANSACTION MODAL EVENTS) ---
    // ปุ่มสลับประเภท รายจ่าย/รายรับ
    document.getElementById("type-expense").onclick = () => switchTransactionType("expense");
    document.getElementById("type-income").onclick = () => switchTransactionType("income");

    // ดักฟังอินพุตวันที่เพื่อเปลี่ยนข้อความแสดง (Label) วันที่ให้สอดคล้อง
    document.getElementById("tx-date").addEventListener("input", (e) => {
        const val = e.target.value;
        const lbl = document.getElementById("lbl-tx-date");
        const today = new Date().toISOString().split('T')[0];
        if (val === today) {
            lbl.textContent = "วันนี้";
        } else {
            lbl.textContent = val;
        }
    });

    // ปุ่มบันทึกธุรกรรมลงฐานข้อมูล
    const btnSaveTx = document.getElementById("btn-save-transaction");
    if (btnSaveTx) {
        btnSaveTx.addEventListener("click", async () => {
            const amountVal = document.getElementById("tx-amount").value;
            const noteVal = document.getElementById("tx-note").value;
            const dateVal = document.getElementById("tx-date").value;
            const paymentVal = document.getElementById("tx-payment").value;

            if (!amountVal || parseFloat(amountVal) <= 0) {
                return alert("กรุณากรอกจำนวนเงินให้ถูกต้อง (ต้องมากกว่า 0)");
            }

            // ถ้าเป็นรายจ่าย ต้องระบุหมวดหมู่
            if (state.selectedTxType === 'expense' && !state.selectedTxCategoryId) {
                return alert("กรุณาเลือกหมวดหมู่รายจ่าย");
            }

            try {
                await createTransaction({
                    amount: amountVal,
                    type: state.selectedTxType,
                    categoryId: state.selectedTxType === 'expense' ? state.selectedTxCategoryId : null,
                    note: noteVal,
                    date: dateVal,
                    paymentMethod: paymentVal
                });

                window.toggleModal(false);
                await loadAllData();
            } catch (err) {
                alert("บันทึกธุรกรรมล้มเหลว: " + err.message);
            }
        });
    }

    // --- 5. บันทึกหมวดหมู่ (CATEGORY MODAL EVENTS) ---
    // จุดเลือกสี
    document.querySelectorAll(".color-dot").forEach(dot => {
        dot.addEventListener("click", () => {
            const color = dot.getAttribute("data-color");
            selectColorDot(color);
        });
    });

    // ปุ่มบันทึกหมวดหมู่ (ทั้งแบบสร้างใหม่ และแก้ไข)
    const btnSaveCategory = document.getElementById("btn-save-category");
    if (btnSaveCategory) {
        btnSaveCategory.addEventListener("click", async () => {
            const iconVal = document.getElementById("cat-icon").value.trim();
            const nameVal = document.getElementById("cat-name").value.trim();
            const budgetVal = document.getElementById("cat-budget").value.trim();

            if (!iconVal || !nameVal) {
                return alert("กรุณากรอกไอคอน Emoji และชื่อหมวดหมู่ให้ครบถ้วน");
            }

            try {
                if (state.editingCategoryId) {
                    // แก้ไข
                    await updateCategory(state.editingCategoryId, nameVal, iconVal, state.selectedCategoryColor, budgetVal);
                } else {
                    // สร้างใหม่
                    await createCategory(nameVal, iconVal, state.selectedCategoryColor, budgetVal);
                }

                window.closeCategoryModal();
                await loadAllData();
            } catch (err) {
                alert("บันทึกหมวดหมู่ล้มเหลว: " + err.message);
            }
        });
    }

    // ปุ่มลบหมวดหมู่ภายใน Modal แก้ไข
    const btnDeleteCategory = document.getElementById("btn-delete-category");
    if (btnDeleteCategory) {
        btnDeleteCategory.addEventListener("click", async () => {
            if (!state.editingCategoryId) return;
            if (confirm("แน่ใจว่าต้องการลบหมวดหมู่นี้? รายการรายจ่ายเดิมในหมวดหมู่นี้จะกลายเป็นหมวดหมู่ว่าง แต่จะไม่หายไป")) {
                try {
                    await deleteCategory(state.editingCategoryId);
                    window.closeCategoryModal();
                    await loadAllData();
                } catch (err) {
                    alert("ลบหมวดหมู่ไม่สำเร็จ: " + err.message);
                }
            }
        });
    }

    // --- 6. บันทึกรายจ่ายประจำ (FIXED EXPENSE EVENTS) ---
    const btnSaveFixed = document.getElementById("btn-save-fixed");
    if (btnSaveFixed) {
        btnSaveFixed.addEventListener("click", async () => {
            const amountVal = document.getElementById("fixed-amount").value;
            const noteVal = document.getElementById("fixed-note").value;
            const dayVal = document.getElementById("fixed-day").value;
            const paymentVal = document.getElementById("fixed-payment").value;

            if (!amountVal || parseFloat(amountVal) <= 0) {
                return alert("กรุณากรอกจำนวนเงินให้ถูกต้อง");
            }

            if (!state.selectedFixedCategoryId) {
                return alert("กรุณาเลือกหมวดหมู่รายจ่ายสำหรับตัดยอด");
            }

            const dayInt = parseInt(dayVal);
            if (isNaN(dayInt) || dayInt < 1 || dayInt > 31) {
                return alert("กรุณาระบุวันที่หักเงินรายเดือนที่ถูกต้อง (วันที่ 1 ถึง 31)");
            }

            try {
                await createFixedExpense({
                    amount: amountVal,
                    type: 'expense',
                    categoryId: state.selectedFixedCategoryId,
                    note: noteVal,
                    dayOfMonth: dayVal,
                    paymentMethod: paymentVal
                });

                window.closeFixedModal();
                await loadAllData();
            } catch (err) {
                alert("ไม่สามารถบันทึกรายจ่ายประจำได้: " + err.message);
            }
        });
    }
}
