// app.js
import { isConfigured, saveSupabaseConfig, clearSupabaseConfig, getSupabaseConfig } from './config.js';
import { signUp, signIn, signOut, getCurrentUser, getCurrentProfile, updateProfileDisplayName, subscribeToAuthChanges, resetSupabaseClient } from './auth.js';
import { getCategories, createCategory, updateCategory, deleteCategory, getTransactions, createTransaction, updateTransaction, deleteTransaction, getFixedExpenses, createFixedExpense, updateFixedExpense, deleteFixedExpense, checkAndApplyFixedExpenses, getBudgets, createBudget, updateBudget, deleteBudget } from './db.js';

// =========================================================================
// State
// =========================================================================
let state = {
    currentUser: null,
    currentProfile: null,
    categories: [],
    transactions: [],
    recurring: [],
    budgets: [],
    selectedMonth: "",
    activeTab: "dashboard",
    amountsVisible: true,

    editingTxId: null,
    editingRecurringId: null,
    editingBudgetId: null,
    editingCategoryId: null,
    categoryModalAfterSave: null,

    selectedTxType: "expense",
    selectedTxCategoryId: null,
    selectedRecType: "expense",
    selectedRecCategoryId: null,
    selectedBudgetCategoryId: null,
    selectedBudgetColor: "rose-500",
    selectedCategoryColor: "rose-500",

    batchModeDashboard: false,
    batchModeFixed: false,
    batchModeBudgets: false,

    chartInstance: null
};

// =========================================================================
// Init
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
    initMonthSelector();
    checkAppRouting();
    setupEventListeners();

    if (isConfigured()) {
        subscribeToAuthChanges((event, session) => {
            checkAppRouting();
        });
    }
});

async function checkAppRouting() {
    if (!isConfigured()) { showScreen("setup"); return; }
    try {
        const user = await getCurrentUser();
        state.currentUser = user;
        if (!user) {
            showScreen("auth");
        } else {
            showScreen("main");
            await loadAllData();
        }
    } catch (err) {
        console.error("Routing error:", err);
        showScreen("auth");
    }
}

function showScreen(name) {
    ["setup", "auth", "main"].forEach(s => {
        const el = document.getElementById("screen-" + s);
        if (el) el.classList.toggle("hidden", s !== name);
    });
}

function initMonthSelector() {
    const selector = document.getElementById("month-selector");
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    state.selectedMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    const monthNames = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
    selector.innerHTML = "";

    for (let i = 0; i < 12; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const value = `${y}-${String(m).padStart(2, '0')}`;
        const label = `${monthNames[m - 1]} ${y + 543}`;
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        selector.appendChild(option);
    }
    selector.value = state.selectedMonth;
    selector.addEventListener("change", async (e) => {
        state.selectedMonth = e.target.value;
        await loadAllData();
    });
}

// =========================================================================
// Data Loading
// =========================================================================
async function loadAllData() {
    if (!state.currentUser) return;
    try {
        state.currentProfile = await getCurrentProfile();
        updateUserHeader();

        try {
            await checkAndApplyFixedExpenses();
        } catch (e) {
            console.error("Auto fixed expenses check failed:", e);
        }

        [state.categories, state.transactions, state.recurring, state.budgets] = await Promise.all([
            getCategories(),
            getTransactions({ monthYear: state.selectedMonth }),
            getFixedExpenses(),
            getBudgets()
        ]);

        renderDashboard();
        renderRecurringPage();
        renderBudgetsPage();
        renderSettingsPage();
    } catch (err) {
        console.error("Error loading data:", err);
        alert("ไม่สามารถดึงข้อมูลได้: " + err.message);
    }
}

function updateUserHeader() {
    const pill = document.getElementById("user-pill");
    if (pill) {
        pill.textContent = `👤 ${state.currentProfile?.display_name || state.currentUser?.email?.split('@')[0] || "ผู้ใช้งาน"}`;
    }
}

// =========================================================================
// Rendering
// =========================================================================
function renderDashboard() {
    let totalIncome = 0, totalExpenses = 0;
    state.transactions.forEach(tx => {
        const a = parseFloat(tx.amount);
        if (tx.type === 'income') totalIncome += a; else totalExpenses += a;
    });
    const balance = totalIncome - totalExpenses;

    const fmt = (v, prefix = '') => state.amountsVisible
        ? `${prefix}฿${Math.abs(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `${prefix}฿****`;

    const el = (id) => document.getElementById(id);
    el("dashboard-income").textContent = fmt(totalIncome, '+');
    el("dashboard-expenses").textContent = fmt(totalExpenses, '-');
    const balEl = el("dashboard-balance");
    if (balEl) {
        balEl.textContent = fmt(balance);
        balEl.className = `text-2xl font-bold tracking-tight ${balance < 0 ? 'text-rose-400' : 'text-white'}`;
    }

    renderExpenseChart();
    renderDashboardBudgets();
    renderRecentTransactions();
}

function renderExpenseChart() {
    const ctx = document.getElementById('expenseChart');
    if (!ctx) return;
    const legendEl = document.getElementById("chart-legend");
    legendEl.innerHTML = "";

    const expenseByCategory = {};
    let totalExpense = 0;

    state.transactions.forEach(tx => {
        if (tx.type === 'expense') {
            const amount = parseFloat(tx.amount);
            totalExpense += amount;
            const catName = tx.categories?.name || "ไม่ระบุ";
            const catColor = tx.categories?.color || "slate-400";
            const catIcon = tx.categories?.icon || "❓";
            if (!expenseByCategory[catName]) {
                expenseByCategory[catName] = { amount: 0, color: getHexColor(catColor), icon: catIcon };
            }
            expenseByCategory[catName].amount += amount;
        }
    });

    if (state.chartInstance) { state.chartInstance.destroy(); state.chartInstance = null; }

    const labels = Object.keys(expenseByCategory);
    const dataValues = labels.map(l => expenseByCategory[l].amount);
    const bgColors = labels.map(l => expenseByCategory[l].color);

    if (totalExpense === 0) {
        legendEl.innerHTML = `<div class="text-center py-4 text-slate-400 font-light text-xs">🪙 ไม่มีรายการรายจ่ายในเดือนนี้</div>`;
        state.chartInstance = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: { labels: ['-'], datasets: [{ data: [1], backgroundColor: ['#e2e8f0'], borderWidth: 0 }] },
            options: { cutout: '70%', plugins: { legend: { display: false }, tooltip: { enabled: false } }, responsive: true, maintainAspectRatio: false }
        });
        return;
    }

    state.chartInstance = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: { labels, datasets: [{ data: dataValues, backgroundColor: bgColors, borderWidth: 1, borderColor: '#fff' }] },
        options: {
            cutout: '70%',
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: (c) => ` ${c.label}: ฿${c.raw.toLocaleString()} (${Math.round((c.raw / totalExpense) * 100)}%)` } }
            },
            responsive: true, maintainAspectRatio: false
        }
    });

    labels.forEach(label => {
        const item = expenseByCategory[label];
        const percent = Math.round((item.amount / totalExpense) * 100);
        const row = document.createElement("div");
        row.className = "flex justify-between items-center text-[11px] text-slate-600";
        row.innerHTML = `
            <div class="flex items-center space-x-1.5 truncate mr-2">
                <span class="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style="background-color:${item.color}"></span>
                <span class="truncate">${item.icon} ${label}</span>
            </div>
            <div class="font-medium text-right flex-shrink-0">
                <span>${state.amountsVisible ? '฿' + Math.round(item.amount).toLocaleString() : '฿****'}</span>
                <span class="text-slate-400 ml-1 font-light">(${percent}%)</span>
            </div>
        `;
        legendEl.appendChild(row);
    });
}

function renderDashboardBudgets() {
    const listEl = document.getElementById("dashboard-budgets-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (state.budgets.length === 0) {
        listEl.innerHTML = `<div class="text-center py-4 text-xs text-slate-400">ยังไม่มีงบประมาณ — <button onclick="window.switchTab('budgets')" class="text-indigo-500 font-medium hover:underline">+ เพิ่มงบ</button></div>`;
        return;
    }

    const spentByCatId = {};
    let totalSpent = 0;
    state.transactions.forEach(tx => {
        if (tx.type === 'expense') {
            totalSpent += parseFloat(tx.amount);
            if (tx.category_id) spentByCatId[tx.category_id] = (spentByCatId[tx.category_id] || 0) + parseFloat(tx.amount);
        }
    });

    const today = new Date();
    const [sy, sm] = state.selectedMonth.split('-');
    const lastDay = new Date(parseInt(sy), parseInt(sm), 0).getDate();
    const daysLeft = Math.max(1, lastDay - today.getDate() + 1);

    state.budgets.forEach(budget => {
        const cat = budget.category_id ? state.categories.find(c => c.id === budget.category_id) : null;
        const spent = budget.category_id ? (spentByCatId[budget.category_id] || 0) : totalSpent;
        const amount = parseFloat(budget.amount);
        const remaining = amount - spent;
        const percent = amount > 0 ? Math.min(100, Math.round((spent / amount) * 100)) : 0;
        const isOver = spent > amount;
        const colorBase = (budget.color || 'rose-500').split('-')[0];

        let subText = '';
        if (isOver) {
            subText = `<p class="text-[10px] text-rose-500 font-medium"><i class="fa-solid fa-circle-exclamation mr-1"></i>เกินงบ!</p>`;
        } else if (budget.show_daily && amount > 0) {
            const daily = remaining / daysLeft;
            subText = `<p class="text-[10px] text-indigo-400">วันละ ${state.amountsVisible ? '฿' + Math.round(daily).toLocaleString() : '฿****'} (เหลือ ${daysLeft} วัน)</p>`;
        } else {
            subText = `<p class="text-[10px] text-slate-400 font-light">เหลือ ${state.amountsVisible ? '฿' + remaining.toLocaleString('th-TH', {minimumFractionDigits: 0}) : '฿****'}</p>`;
        }

        const card = document.createElement("div");
        card.className = "bg-white border border-slate-100 rounded-xl p-3.5 shadow-sm cursor-pointer hover:bg-slate-50 transition-all";
        card.onclick = () => window.openBudgetModal(budget.id);
        card.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <div class="flex items-center space-x-3">
                    ${cat
                        ? `<div class="w-9 h-9 bg-${cat.color}/10 text-${cat.color} rounded-xl flex items-center justify-center text-lg">${cat.icon}</div>`
                        : `<div class="w-9 h-9 bg-${budget.color}/10 rounded-xl flex items-center justify-center"><div class="w-3 h-3 rounded-full bg-${budget.color}"></div></div>`
                    }
                    <div>
                        <h4 class="font-medium text-slate-800 text-sm">${budget.name}</h4>
                        ${subText}
                    </div>
                </div>
                <div class="text-right">
                    <p class="text-sm font-semibold ${isOver ? 'text-rose-600' : 'text-slate-800'}">${state.amountsVisible ? '฿' + spent.toLocaleString('th-TH', {minimumFractionDigits: 2}) : '฿****'}</p>
                    <p class="text-[10px] text-slate-400">งบ: ${state.amountsVisible ? '฿' + amount.toLocaleString() : '฿****'}</p>
                </div>
            </div>
            <div class="w-full bg-slate-100 rounded-full h-1.5">
                <div class="bg-${isOver ? 'rose' : colorBase}-500 h-1.5 rounded-full transition-all duration-300" style="width:${percent}%"></div>
            </div>
        `;
        listEl.appendChild(card);
    });
}

function renderRecentTransactions() {
    const listEl = document.getElementById("dashboard-transactions-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (state.transactions.length === 0) {
        listEl.innerHTML = `<div class="bg-white border border-slate-100 p-8 rounded-2xl text-center text-xs text-slate-400">🫙 ไม่มีรายการธุรกรรมในเดือนนี้</div>`;
        return;
    }

    const shortMonths = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

    state.transactions.forEach(tx => {
        const isIncome = tx.type === 'income';
        const dateObj = new Date(tx.date + 'T00:00:00');
        const dateStr = `${dateObj.getDate()} ${shortMonths[dateObj.getMonth()]}`;
        const payLabel = tx.payment_method === 'cash' ? 'เงินสด' : tx.payment_method === 'transfer' ? 'โอนเงิน' : 'บัตรเครดิต';
        const amtText = state.amountsVisible
            ? `${isIncome ? '+' : '-'}฿${parseFloat(tx.amount).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`
            : `${isIncome ? '+' : '-'}฿****`;

        const item = document.createElement("div");
        item.className = "bg-white p-3 rounded-xl border border-slate-100 flex items-center group hover:bg-slate-50 transition-all";

        const checkbox = state.batchModeDashboard ? `
            <input type="checkbox" class="batch-select-dashboard mr-3 rounded flex-shrink-0" data-id="${tx.id}">
        ` : '';

        item.innerHTML = `
            ${checkbox}
            <div class="flex justify-between items-center flex-1 ${!state.batchModeDashboard ? 'cursor-pointer' : ''}">
                <div class="flex items-center space-x-3 truncate">
                    <div class="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${isIncome ? 'bg-emerald-50 text-emerald-500' : `bg-${tx.categories?.color || 'slate'}-50 text-${tx.categories?.color || 'slate'}-500`}">
                        ${isIncome ? '💰' : (tx.categories?.icon || '❓')}
                    </div>
                    <div class="truncate">
                        <p class="text-xs font-semibold text-slate-800 truncate">${tx.note || (isIncome ? 'รายรับ' : (tx.categories?.name || 'รายจ่าย'))}</p>
                        <div class="flex items-center space-x-2 text-[10px] text-slate-400 mt-0.5">
                            <span>📅 ${dateStr}</span><span>•</span>
                            <span>${payLabel}</span>
                            ${tx.is_fixed ? `<span class="bg-indigo-50 text-indigo-600 px-1 rounded text-[8px] font-medium">ประจำ</span>` : ''}
                        </div>
                    </div>
                </div>
                <span class="text-sm font-semibold flex-shrink-0 ml-2 ${isIncome ? 'text-emerald-500' : 'text-slate-700'}">${amtText}</span>
            </div>
        `;

        if (!state.batchModeDashboard) {
            item.querySelector('.flex-1').addEventListener('click', () => window.openTransactionModal(tx.id));
        }
        listEl.appendChild(item);
    });

    if (state.batchModeDashboard) {
        document.getElementById('chk-all-dashboard').addEventListener('change', function() {
            document.querySelectorAll('.batch-select-dashboard').forEach(cb => { cb.checked = this.checked; });
        });
    }
}

function renderRecurringPage() {
    const listEl = document.getElementById("recurring-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (state.recurring.length === 0) {
        listEl.innerHTML = `<div class="bg-white border border-slate-100 p-10 rounded-2xl text-center text-xs text-slate-400">📆 ยังไม่มีรายการประจำ</div>`;
        return;
    }

    const payLabel = (p) => p === 'cash' ? 'เงินสด' : p === 'transfer' ? 'โอนเงิน' : 'บัตรเครดิต';

    state.recurring.forEach(item => {
        const isIncome = item.type === 'income';
        const cat = item.category_id ? state.categories.find(c => c.id === item.category_id) : null;
        const amtText = state.amountsVisible ? `฿${parseFloat(item.amount).toLocaleString()}` : `฿****`;

        const row = document.createElement("div");
        row.className = "bg-white p-4 rounded-xl border border-slate-100 flex items-center group hover:bg-slate-50 transition-all cursor-pointer";

        const checkbox = state.batchModeFixed ? `
            <input type="checkbox" class="batch-select-fixed mr-3 rounded flex-shrink-0" data-id="${item.id}" onclick="event.stopPropagation()">
        ` : '';

        row.innerHTML = `
            ${checkbox}
            <div class="flex items-center space-x-3 truncate flex-1">
                <div class="w-10 h-10 ${isIncome ? 'bg-emerald-50 text-emerald-600' : `bg-${cat?.color || 'indigo'}-50 text-${cat?.color || 'indigo'}-600`} rounded-xl flex items-center justify-center text-lg flex-shrink-0">
                    ${isIncome ? '💰' : (cat?.icon || '🏠')}
                </div>
                <div class="truncate">
                    <div class="flex items-center space-x-2">
                        <p class="text-sm font-semibold text-slate-800 truncate">${item.note || cat?.name || (isIncome ? 'รายรับประจำ' : 'รายจ่ายประจำ')}</p>
                        <span class="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${isIncome ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}">${isIncome ? 'รายรับ' : 'รายจ่าย'}</span>
                    </div>
                    <p class="text-xs text-slate-400 mt-0.5">ตัดยอดทุกวันที่ ${item.day_of_month} • ${payLabel(item.payment_method)}</p>
                </div>
            </div>
            <span class="font-semibold text-slate-800 flex-shrink-0 ml-2 text-sm">${amtText}</span>
        `;

        if (!state.batchModeFixed) {
            row.addEventListener('click', () => window.openRecurringModal(item.id));
        }
        listEl.appendChild(row);
    });

    if (state.batchModeFixed) {
        document.getElementById('chk-all-fixed').addEventListener('change', function() {
            document.querySelectorAll('.batch-select-fixed').forEach(cb => { cb.checked = this.checked; });
        });
    }
}

function renderBudgetsPage() {
    const listEl = document.getElementById("budgets-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (state.budgets.length === 0) {
        listEl.innerHTML = `<div class="bg-white border border-slate-100 p-10 rounded-2xl text-center text-xs text-slate-400">💰 ยังไม่มีงบประมาณ กดปุ่ม "+ เพิ่มงบ" เพื่อเริ่มสร้าง</div>`;
        return;
    }

    const spentByCatId = {};
    let totalSpent = 0;
    state.transactions.forEach(tx => {
        if (tx.type === 'expense') {
            totalSpent += parseFloat(tx.amount);
            if (tx.category_id) spentByCatId[tx.category_id] = (spentByCatId[tx.category_id] || 0) + parseFloat(tx.amount);
        }
    });

    state.budgets.forEach(budget => {
        const cat = budget.category_id ? state.categories.find(c => c.id === budget.category_id) : null;
        const spent = budget.category_id ? (spentByCatId[budget.category_id] || 0) : totalSpent;
        const amount = parseFloat(budget.amount);
        const remaining = amount - spent;
        const percent = amount > 0 ? Math.min(100, Math.round((spent / amount) * 100)) : 0;
        const isOver = spent > amount;
        const colorBase = (budget.color || 'rose-500').split('-')[0];

        const row = document.createElement("div");
        row.className = "bg-white border border-slate-100 rounded-xl p-4 cursor-pointer hover:bg-slate-50 transition-all";

        const checkbox = state.batchModeBudgets ? `
            <input type="checkbox" class="batch-select-budgets mr-3 rounded flex-shrink-0 self-start mt-1" data-id="${budget.id}" onclick="event.stopPropagation()">
        ` : '';

        row.innerHTML = `
            <div class="flex items-center">
                ${checkbox}
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex items-center space-x-3 min-w-0">
                            ${cat
                                ? `<div class="w-10 h-10 bg-${cat.color}/10 text-${cat.color} rounded-xl flex items-center justify-center text-lg flex-shrink-0">${cat.icon}</div>`
                                : `<div class="w-10 h-10 bg-${budget.color}/10 rounded-xl flex items-center justify-center flex-shrink-0"><div class="w-4 h-4 rounded-full bg-${budget.color}"></div></div>`
                            }
                            <div class="min-w-0">
                                <p class="font-semibold text-slate-800 text-sm truncate">${budget.name}</p>
                                ${cat ? `<p class="text-[10px] text-slate-400">${cat.name}</p>` : '<p class="text-[10px] text-slate-400">ไม่ระบุหมวดหมู่</p>'}
                            </div>
                        </div>
                        <div class="text-right flex-shrink-0 ml-2">
                            <p class="text-sm font-bold ${isOver ? 'text-rose-600' : 'text-slate-800'}">${state.amountsVisible ? '฿' + spent.toLocaleString('th-TH', {minimumFractionDigits: 0}) : '฿****'}</p>
                            <p class="text-[10px] text-slate-400">จาก ${state.amountsVisible ? '฿' + amount.toLocaleString() : '฿****'}</p>
                        </div>
                    </div>
                    <div class="w-full bg-slate-100 rounded-full h-1.5 mb-1">
                        <div class="bg-${isOver ? 'rose' : colorBase}-500 h-1.5 rounded-full" style="width:${percent}%"></div>
                    </div>
                    <div class="flex justify-between items-center text-[10px]">
                        <span class="${isOver ? 'text-rose-500 font-medium' : 'text-slate-400'}">${isOver ? '⚠️ เกินงบ' : `เหลือ ${state.amountsVisible ? '฿' + remaining.toLocaleString() : '฿****'}`}</span>
                        <span class="text-slate-400">${percent}%</span>
                    </div>
                </div>
            </div>
        `;

        if (!state.batchModeBudgets) {
            row.addEventListener('click', () => window.openBudgetModal(budget.id));
        }
        listEl.appendChild(row);
    });

    if (state.batchModeBudgets) {
        document.getElementById('chk-all-budgets').addEventListener('change', function() {
            document.querySelectorAll('.batch-select-budgets').forEach(cb => { cb.checked = this.checked; });
        });
    }
}

function renderSettingsPage() {
    if (state.currentUser) {
        const d = state.currentProfile?.display_name || state.currentUser.email.split('@')[0];
        document.getElementById("profile-email").textContent = state.currentUser.email;
        document.getElementById("settings-display-name").value = state.currentProfile?.display_name || "";
        document.getElementById("profile-name").textContent = d;
        document.getElementById("profile-avatar").textContent = d[0].toUpperCase();
    }
    const conf = getSupabaseConfig();
    document.getElementById("settings-db-url").textContent = conf.supabaseUrl || "ไม่ได้ระบุ";
}

// =========================================================================
// Helpers
// =========================================================================
function getHexColor(colorClass) {
    const map = {
        'rose-500': '#f43f5e', 'blue-500': '#3b82f6', 'yellow-500': '#eab308',
        'purple-500': '#a855f7', 'emerald-500': '#10b981', 'pink-500': '#ec4899',
        'slate-400': '#94a3b8', 'indigo-500': '#6366f1', 'indigo-600': '#4f46e5',
        'amber-500': '#f59e0b', 'teal-500': '#14b8a6', 'cyan-500': '#06b6d4'
    };
    return map[colorClass] || '#6366f1';
}

// =========================================================================
// Visibility Toggle
// =========================================================================
window.toggleVisibility = function() {
    state.amountsVisible = !state.amountsVisible;
    const btn = document.getElementById("btn-toggle-visibility");
    if (btn) {
        btn.innerHTML = state.amountsVisible
            ? '<i class="fa-solid fa-eye text-sm"></i>'
            : '<i class="fa-solid fa-eye-slash text-sm text-slate-300"></i>';
    }
    renderDashboard();
    renderRecurringPage();
    renderBudgetsPage();
};

// =========================================================================
// Navigation
// =========================================================================
window.switchTab = function(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
    const page = document.getElementById('page-' + tabId);
    if (page) page.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => { b.classList.remove('text-indigo-600'); b.classList.add('text-slate-400'); });
    const activeBtn = document.getElementById('nav-' + tabId);
    if (activeBtn) { activeBtn.classList.remove('text-slate-400'); activeBtn.classList.add('text-indigo-600'); }
};

// =========================================================================
// Batch Mode
// =========================================================================
window.toggleBatchMode = function(type) {
    if (type === 'dashboard') {
        state.batchModeDashboard = !state.batchModeDashboard;
        document.getElementById('batch-ctrl-dashboard').classList.toggle('hidden', !state.batchModeDashboard);
        document.getElementById('btn-batch-toggle-dashboard').textContent = state.batchModeDashboard ? 'ยกเลิก' : 'เลือก';
        if (state.batchModeDashboard) document.getElementById('chk-all-dashboard').checked = false;
        renderRecentTransactions();
    } else if (type === 'fixed') {
        state.batchModeFixed = !state.batchModeFixed;
        document.getElementById('batch-ctrl-fixed').classList.toggle('hidden', !state.batchModeFixed);
        document.getElementById('btn-batch-toggle-fixed').textContent = state.batchModeFixed ? 'ยกเลิก' : 'เลือก';
        if (state.batchModeFixed) document.getElementById('chk-all-fixed').checked = false;
        renderRecurringPage();
    } else if (type === 'budgets') {
        state.batchModeBudgets = !state.batchModeBudgets;
        document.getElementById('batch-ctrl-budgets').classList.toggle('hidden', !state.batchModeBudgets);
        document.getElementById('btn-batch-toggle-budgets').textContent = state.batchModeBudgets ? 'ยกเลิก' : 'เลือก';
        if (state.batchModeBudgets) document.getElementById('chk-all-budgets').checked = false;
        renderBudgetsPage();
    }
};

window.deleteSelected = async function(type) {
    const cls = type === 'dashboard' ? 'batch-select-dashboard' : type === 'fixed' ? 'batch-select-fixed' : 'batch-select-budgets';
    const checked = [...document.querySelectorAll(`.${cls}:checked`)];
    if (checked.length === 0) { alert("กรุณาเลือกรายการที่ต้องการลบก่อน"); return; }
    if (!confirm(`ต้องการลบ ${checked.length} รายการที่เลือกใช่หรือไม่?`)) return;
    try {
        const ids = checked.map(cb => cb.dataset.id);
        if (type === 'dashboard') {
            await Promise.all(ids.map(id => deleteTransaction(id)));
            state.batchModeDashboard = false;
        } else if (type === 'fixed') {
            await Promise.all(ids.map(id => deleteFixedExpense(id)));
            state.batchModeFixed = false;
        } else {
            await Promise.all(ids.map(id => deleteBudget(id)));
            state.batchModeBudgets = false;
        }
        document.getElementById(`batch-ctrl-${type}`).classList.add('hidden');
        document.getElementById(`btn-batch-toggle-${type}`).textContent = 'เลือก';
        await loadAllData();
    } catch (err) {
        alert("ลบไม่สำเร็จ: " + err.message);
    }
};

// =========================================================================
// Inline Category Picker
// =========================================================================
function renderCategoryPicker(containerId, getSelected, setSelected) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    const selectedId = getSelected();

    state.categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isSel = selectedId === cat.id;
        btn.className = `flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-1.5 transition-all border ${isSel ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-200'}`;
        btn.innerHTML = `<span>${cat.icon}</span><span>${cat.name}</span>`;
        btn.onclick = () => {
            setSelected(cat.id);
            renderCategoryPicker(containerId, getSelected, setSelected);
        };
        container.appendChild(btn);
    });

    if (selectedId) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 border border-amber-100 text-amber-600 flex items-center space-x-1.5 hover:bg-amber-100 transition-all';
        editBtn.innerHTML = '<i class="fa-solid fa-pen text-[9px]"></i><span>แก้ไข</span>';
        editBtn.onclick = () => {
            const cat = state.categories.find(c => c.id === selectedId);
            if (cat) {
                window.openCategoryModal(cat, (updatedId) => {
                    setSelected(updatedId || selectedId);
                    renderCategoryPicker(containerId, getSelected, setSelected);
                });
            }
        };
        container.appendChild(editBtn);
    }

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center space-x-1.5 hover:bg-emerald-100 transition-all';
    createBtn.innerHTML = '<i class="fa-solid fa-plus text-[9px]"></i><span>สร้างใหม่</span>';
    createBtn.onclick = () => {
        window.openCategoryModal(null, (newId) => {
            setSelected(newId);
            renderCategoryPicker(containerId, getSelected, setSelected);
        });
    };
    container.appendChild(createBtn);
}

function renderBudgetCategoryPicker() {
    const container = document.getElementById('budget-category-picker');
    if (!container) return;
    container.innerHTML = '';

    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    const noneSelected = !state.selectedBudgetCategoryId;
    noneBtn.className = `flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center transition-all border ${noneSelected ? 'bg-slate-200 border-slate-300 text-slate-700' : 'bg-slate-50 border-slate-100 text-slate-400 hover:border-slate-200'}`;
    noneBtn.textContent = 'ไม่ระบุ';
    noneBtn.onclick = () => { state.selectedBudgetCategoryId = null; renderBudgetCategoryPicker(); };
    container.appendChild(noneBtn);

    state.categories.forEach(cat => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isSel = state.selectedBudgetCategoryId === cat.id;
        btn.className = `flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold flex items-center space-x-1.5 transition-all border ${isSel ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-slate-50 border-slate-100 text-slate-600 hover:border-slate-200'}`;
        btn.innerHTML = `<span>${cat.icon}</span><span>${cat.name}</span>`;
        btn.onclick = () => { state.selectedBudgetCategoryId = cat.id; renderBudgetCategoryPicker(); };
        container.appendChild(btn);
    });

    if (state.selectedBudgetCategoryId) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 border border-amber-100 text-amber-600 flex items-center space-x-1.5 hover:bg-amber-100 transition-all';
        editBtn.innerHTML = '<i class="fa-solid fa-pen text-[9px]"></i><span>แก้ไข</span>';
        editBtn.onclick = () => {
            const cat = state.categories.find(c => c.id === state.selectedBudgetCategoryId);
            if (cat) {
                window.openCategoryModal(cat, (updatedId) => {
                    if (updatedId) state.selectedBudgetCategoryId = updatedId;
                    renderBudgetCategoryPicker();
                });
            }
        };
        container.appendChild(editBtn);
    }

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center space-x-1.5 hover:bg-emerald-100 transition-all';
    createBtn.innerHTML = '<i class="fa-solid fa-plus text-[9px]"></i><span>สร้างใหม่</span>';
    createBtn.onclick = () => {
        window.openCategoryModal(null, (newId) => {
            state.selectedBudgetCategoryId = newId;
            renderBudgetCategoryPicker();
        });
    };
    container.appendChild(createBtn);
}

// =========================================================================
// Transaction Modal
// =========================================================================
window.openTransactionModal = function(txId = null) {
    state.editingTxId = txId;
    const modal = document.getElementById('expense-modal');
    const sheet = modal.querySelector('div');
    const titleEl = document.getElementById('tx-modal-title');
    const deleteBtn = document.getElementById('btn-delete-tx-modal');

    if (txId) {
        const tx = state.transactions.find(t => t.id === txId);
        if (!tx) return;
        titleEl.textContent = "แก้ไขรายการเงิน";
        deleteBtn.classList.remove('hidden');
        switchTransactionType(tx.type);
        document.getElementById('tx-amount').value = parseFloat(tx.amount);
        document.getElementById('tx-note').value = tx.note || '';
        document.getElementById('tx-date').value = tx.date;
        document.getElementById('lbl-tx-date').textContent = tx.date;
        document.getElementById('tx-payment').value = tx.payment_method || 'cash';
        state.selectedTxCategoryId = tx.category_id || null;
    } else {
        titleEl.textContent = "บันทึกรายการเงิน";
        deleteBtn.classList.add('hidden');
        document.getElementById('tx-amount').value = '';
        document.getElementById('tx-note').value = '';
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('tx-date').value = today;
        document.getElementById('lbl-tx-date').textContent = 'วันนี้';
        document.getElementById('tx-payment').value = 'cash';
        state.selectedTxCategoryId = null;
        switchTransactionType('expense');
    }

    renderCategoryPicker('modal-category-picker', () => state.selectedTxCategoryId, (id) => { state.selectedTxCategoryId = id; });

    modal.classList.remove('opacity-0', 'pointer-events-none');
    setTimeout(() => sheet.classList.remove('translate-y-full'), 50);
};

window.closeTransactionModal = function() {
    const modal = document.getElementById('expense-modal');
    const sheet = modal.querySelector('div');
    sheet.classList.add('translate-y-full');
    setTimeout(() => modal.classList.add('opacity-0', 'pointer-events-none'), 300);
};

function switchTransactionType(type) {
    state.selectedTxType = type;
    const btnE = document.getElementById('type-expense');
    const btnI = document.getElementById('type-income');
    const catSection = document.getElementById('category-picker-section');
    if (type === 'expense') {
        btnE.className = 'flex-1 py-1.5 text-xs font-semibold rounded-lg bg-white text-slate-800 shadow-sm transition-all';
        btnI.className = 'flex-1 py-1.5 text-xs font-semibold rounded-lg text-slate-500 transition-all';
        catSection.classList.remove('hidden');
    } else {
        btnI.className = 'flex-1 py-1.5 text-xs font-semibold rounded-lg bg-white text-slate-800 shadow-sm transition-all';
        btnE.className = 'flex-1 py-1.5 text-xs font-semibold rounded-lg text-slate-500 transition-all';
        catSection.classList.add('hidden');
    }
}

// =========================================================================
// Recurring Modal
// =========================================================================
window.openRecurringModal = function(recId = null) {
    state.editingRecurringId = recId;
    const modal = document.getElementById('recurring-modal');
    const sheet = modal.querySelector('div');
    const deleteBtn = document.getElementById('btn-delete-rec-modal');

    if (recId) {
        const rec = state.recurring.find(r => r.id === recId);
        if (!rec) return;
        document.getElementById('recurring-modal-title').textContent = 'แก้ไขรายการประจำ';
        deleteBtn.classList.remove('hidden');
        switchRecurringType(rec.type || 'expense');
        document.getElementById('rec-amount').value = parseFloat(rec.amount);
        document.getElementById('rec-note').value = rec.note || '';
        document.getElementById('rec-day').value = rec.day_of_month;
        document.getElementById('rec-payment').value = rec.payment_method || 'cash';
        state.selectedRecCategoryId = rec.category_id || null;
    } else {
        document.getElementById('recurring-modal-title').textContent = 'เพิ่มรายการประจำ';
        deleteBtn.classList.add('hidden');
        document.getElementById('rec-amount').value = '';
        document.getElementById('rec-note').value = '';
        document.getElementById('rec-day').value = '';
        document.getElementById('rec-payment').value = 'cash';
        state.selectedRecCategoryId = null;
        switchRecurringType('expense');
    }

    renderCategoryPicker('recurring-category-picker', () => state.selectedRecCategoryId, (id) => { state.selectedRecCategoryId = id; });

    modal.classList.remove('opacity-0', 'pointer-events-none');
    setTimeout(() => sheet.classList.remove('translate-y-full'), 50);
};

window.closeRecurringModal = function() {
    const modal = document.getElementById('recurring-modal');
    const sheet = modal.querySelector('div');
    sheet.classList.add('translate-y-full');
    setTimeout(() => modal.classList.add('opacity-0', 'pointer-events-none'), 300);
};

function switchRecurringType(type) {
    state.selectedRecType = type;
    const btnE = document.getElementById('rec-type-expense');
    const btnI = document.getElementById('rec-type-income');
    const catSection = document.getElementById('recurring-category-section');
    if (type === 'expense') {
        btnE.className = 'flex-1 py-1.5 text-xs font-semibold rounded-lg bg-white text-slate-800 shadow-sm transition-all';
        btnI.className = 'flex-1 py-1.5 text-xs font-semibold rounded-lg text-slate-500 transition-all';
        catSection.classList.remove('hidden');
    } else {
        btnI.className = 'flex-1 py-1.5 text-xs font-semibold rounded-lg bg-white text-slate-800 shadow-sm transition-all';
        btnE.className = 'flex-1 py-1.5 text-xs font-semibold rounded-lg text-slate-500 transition-all';
        catSection.classList.add('hidden');
    }
}

// =========================================================================
// Budget Modal
// =========================================================================
window.openBudgetModal = function(budgetId = null) {
    state.editingBudgetId = budgetId;
    const modal = document.getElementById('budget-modal');
    const sheet = modal.querySelector('div');
    const deleteBtn = document.getElementById('btn-delete-budget');

    if (budgetId) {
        const b = state.budgets.find(b => b.id === budgetId);
        if (!b) return;
        document.getElementById('budget-modal-title').textContent = 'แก้ไขงบประมาณ';
        deleteBtn.classList.remove('hidden');
        document.getElementById('bg-name').value = b.name;
        document.getElementById('bg-amount').value = parseFloat(b.amount);
        document.getElementById('bg-show-daily').checked = b.show_daily;
        state.selectedBudgetCategoryId = b.category_id || null;
        state.selectedBudgetColor = b.color || 'rose-500';
    } else {
        document.getElementById('budget-modal-title').textContent = 'เพิ่มงบประมาณ';
        deleteBtn.classList.add('hidden');
        document.getElementById('bg-name').value = '';
        document.getElementById('bg-amount').value = '';
        document.getElementById('bg-show-daily').checked = false;
        state.selectedBudgetCategoryId = null;
        state.selectedBudgetColor = 'rose-500';
    }

    selectBudgetColorDot(state.selectedBudgetColor);
    renderBudgetCategoryPicker();

    modal.classList.remove('opacity-0', 'pointer-events-none');
    setTimeout(() => sheet.classList.remove('translate-y-full'), 50);
};

window.closeBudgetModal = function() {
    const modal = document.getElementById('budget-modal');
    const sheet = modal.querySelector('div');
    sheet.classList.add('translate-y-full');
    setTimeout(() => modal.classList.add('opacity-0', 'pointer-events-none'), 300);
};

function selectBudgetColorDot(colorClass) {
    state.selectedBudgetColor = colorClass;
    document.querySelectorAll('.bgcolor-dot').forEach(dot => {
        const dc = dot.getAttribute('data-color');
        dot.className = `bgcolor-dot w-8 h-8 rounded-full bg-${dc} ${dc === colorClass ? 'ring-2 ring-offset-2 ring-indigo-500' : 'ring-0 ring-offset-2 ring-indigo-500'}`;
    });
}

// =========================================================================
// Category Modal
// =========================================================================
window.openCategoryModal = function(catObj = null, afterSave = null) {
    state.editingCategoryId = catObj ? catObj.id : null;
    state.categoryModalAfterSave = afterSave;

    const modal = document.getElementById('category-modal');
    const sheet = modal.querySelector('div');
    const titleEl = document.getElementById('category-modal-title');
    const deleteBtn = document.getElementById('btn-delete-category');

    if (catObj) {
        titleEl.textContent = 'แก้ไขหมวดหมู่';
        document.getElementById('cat-icon').value = catObj.icon;
        document.getElementById('cat-name').value = catObj.name;
        selectColorDot(catObj.color);
        deleteBtn.classList.remove('hidden');
    } else {
        titleEl.textContent = 'เพิ่มหมวดหมู่ใหม่';
        document.getElementById('cat-icon').value = '';
        document.getElementById('cat-name').value = '';
        selectColorDot('rose-500');
        deleteBtn.classList.add('hidden');
    }

    modal.classList.remove('opacity-0', 'pointer-events-none');
    setTimeout(() => sheet.classList.remove('translate-y-full'), 50);
};

window.closeCategoryModal = function() {
    state.categoryModalAfterSave = null;
    const modal = document.getElementById('category-modal');
    const sheet = modal.querySelector('div');
    sheet.classList.add('translate-y-full');
    setTimeout(() => modal.classList.add('opacity-0', 'pointer-events-none'), 300);
};

function selectColorDot(colorClass) {
    state.selectedCategoryColor = colorClass;
    document.querySelectorAll('.color-dot').forEach(dot => {
        const dc = dot.getAttribute('data-color');
        dot.className = `color-dot w-8 h-8 rounded-full bg-${dc} ${dc === colorClass ? 'ring-2 ring-offset-2 ring-indigo-500' : 'ring-0 ring-offset-2 ring-indigo-500'}`;
    });
}

// =========================================================================
// Event Listeners
// =========================================================================
function setupEventListeners() {

    // Setup screen
    const formSetup = document.getElementById('form-setup');
    if (formSetup) {
        formSetup.addEventListener('submit', (e) => {
            e.preventDefault();
            const url = document.getElementById('setup-url').value;
            const key = document.getElementById('setup-key').value;
            try {
                saveSupabaseConfig(url, key);
                resetSupabaseClient();
                window.location.reload();
            } catch (err) { alert('ข้อผิดพลาด: ' + err.message); }
        });
    }

    // Auth tabs (kept in DOM for compatibility)
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    if (tabLogin && tabSignup) {
        tabLogin.addEventListener('click', () => {
            document.getElementById('group-display-name').classList.add('hidden');
            document.getElementById('auth-name').required = false;
            document.getElementById('btn-auth-submit').textContent = 'เข้าสู่ระบบ';
        });
        tabSignup.addEventListener('click', () => {
            document.getElementById('group-display-name').classList.remove('hidden');
            document.getElementById('auth-name').required = true;
            document.getElementById('btn-auth-submit').textContent = 'สมัครสมาชิก';
        });
    }

    // Auth form
    const formAuth = document.getElementById('form-auth');
    if (formAuth) {
        formAuth.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            try {
                await signIn(email, password);
                checkAppRouting();
            } catch (err) { alert('เข้าสู่ระบบไม่สำเร็จ: ' + err.message); }
        });
    }

    const btnChangeConfig = document.getElementById('btn-change-config');
    if (btnChangeConfig) {
        btnChangeConfig.addEventListener('click', () => {
            if (confirm('ต้องการล้างการตั้งค่าฐานข้อมูลเดิมใช่หรือไม่?')) {
                clearSupabaseConfig(); resetSupabaseClient(); showScreen('setup');
            }
        });
    }

    // Settings
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
        if (confirm('ต้องการออกจากระบบใช่หรือไม่?')) {
            try { await signOut(); state.currentUser = null; state.currentProfile = null; checkAppRouting(); }
            catch (err) { alert('ออกจากระบบไม่สำเร็จ: ' + err.message); }
        }
    });

    document.getElementById('btn-reset-db')?.addEventListener('click', () => {
        if (confirm('แน่ใจว่าต้องการเปลี่ยนฐานข้อมูล? คุณจะต้องล็อกอินใหม่')) {
            clearSupabaseConfig(); resetSupabaseClient(); window.location.reload();
        }
    });

    document.getElementById('btn-save-profile')?.addEventListener('click', async () => {
        const newName = document.getElementById('settings-display-name').value.trim();
        if (!newName) return alert('กรุณากรอกชื่อ');
        try { await updateProfileDisplayName(newName); await loadAllData(); }
        catch (err) { alert('บันทึกชื่อไม่สำเร็จ: ' + err.message); }
    });

    // Transaction type toggle
    document.getElementById('type-expense')?.addEventListener('click', () => {
        switchTransactionType('expense');
        renderCategoryPicker('modal-category-picker', () => state.selectedTxCategoryId, (id) => { state.selectedTxCategoryId = id; });
    });
    document.getElementById('type-income')?.addEventListener('click', () => {
        switchTransactionType('income');
    });

    // Recurring type toggle
    document.getElementById('rec-type-expense')?.addEventListener('click', () => {
        switchRecurringType('expense');
        renderCategoryPicker('recurring-category-picker', () => state.selectedRecCategoryId, (id) => { state.selectedRecCategoryId = id; });
    });
    document.getElementById('rec-type-income')?.addEventListener('click', () => switchRecurringType('income'));

    // Date label update
    document.getElementById('tx-date')?.addEventListener('input', (e) => {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('lbl-tx-date').textContent = e.target.value === today ? 'วันนี้' : e.target.value;
    });

    // Save transaction
    document.getElementById('btn-save-transaction')?.addEventListener('click', async () => {
        const amount = document.getElementById('tx-amount').value;
        const note = document.getElementById('tx-note').value;
        const date = document.getElementById('tx-date').value;
        const payment = document.getElementById('tx-payment').value;

        if (!amount || parseFloat(amount) <= 0) return alert('กรุณากรอกจำนวนเงินให้ถูกต้อง');
        if (state.selectedTxType === 'expense' && !state.selectedTxCategoryId) return alert('กรุณาเลือกหมวดหมู่รายจ่าย');

        try {
            if (state.editingTxId) {
                await updateTransaction(state.editingTxId, { amount, type: state.selectedTxType, categoryId: state.selectedTxCategoryId, note, date, paymentMethod: payment });
            } else {
                await createTransaction({ amount, type: state.selectedTxType, categoryId: state.selectedTxCategoryId, note, date, paymentMethod: payment });
            }
            window.closeTransactionModal();
            await loadAllData();
        } catch (err) { alert('บันทึกไม่สำเร็จ: ' + err.message); }
    });

    // Delete transaction from modal
    document.getElementById('btn-delete-tx-modal')?.addEventListener('click', async () => {
        if (!state.editingTxId) return;
        if (!confirm('ต้องการลบรายการนี้ใช่หรือไม่?')) return;
        try {
            await deleteTransaction(state.editingTxId);
            window.closeTransactionModal();
            await loadAllData();
        } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
    });

    // Save recurring
    document.getElementById('btn-save-recurring')?.addEventListener('click', async () => {
        const amount = document.getElementById('rec-amount').value;
        const note = document.getElementById('rec-note').value;
        const day = document.getElementById('rec-day').value;
        const payment = document.getElementById('rec-payment').value;

        if (!amount || parseFloat(amount) <= 0) return alert('กรุณากรอกจำนวนเงินให้ถูกต้อง');
        if (state.selectedRecType === 'expense' && !state.selectedRecCategoryId) return alert('กรุณาเลือกหมวดหมู่รายจ่าย');
        const dayInt = parseInt(day);
        if (isNaN(dayInt) || dayInt < 1 || dayInt > 31) return alert('กรุณาระบุวันที่ตัดยอด (1-31)');

        try {
            if (state.editingRecurringId) {
                await updateFixedExpense(state.editingRecurringId, { amount, type: state.selectedRecType, categoryId: state.selectedRecCategoryId, note, dayOfMonth: dayInt, paymentMethod: payment });
            } else {
                await createFixedExpense({ amount, type: state.selectedRecType, categoryId: state.selectedRecCategoryId, note, dayOfMonth: dayInt, paymentMethod: payment });
            }
            window.closeRecurringModal();
            await loadAllData();
        } catch (err) { alert('บันทึกไม่สำเร็จ: ' + err.message); }
    });

    // Delete recurring from modal
    document.getElementById('btn-delete-rec-modal')?.addEventListener('click', async () => {
        if (!state.editingRecurringId) return;
        if (!confirm('ต้องการลบรายการประจำนี้ใช่หรือไม่?')) return;
        try {
            await deleteFixedExpense(state.editingRecurringId);
            window.closeRecurringModal();
            await loadAllData();
        } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
    });

    // Budget color dots
    document.querySelectorAll('.bgcolor-dot').forEach(dot => {
        dot.addEventListener('click', () => selectBudgetColorDot(dot.getAttribute('data-color')));
    });

    // Save budget
    document.getElementById('btn-save-budget')?.addEventListener('click', async () => {
        const name = document.getElementById('bg-name').value.trim();
        const amount = document.getElementById('bg-amount').value;
        const showDaily = document.getElementById('bg-show-daily').checked;

        if (!name) return alert('กรุณากรอกชื่องบประมาณ');
        if (!amount || parseFloat(amount) <= 0) return alert('กรุณากรอกจำนวนงบ');

        try {
            if (state.editingBudgetId) {
                await updateBudget(state.editingBudgetId, { name, amount, categoryId: state.selectedBudgetCategoryId, color: state.selectedBudgetColor, showDaily });
            } else {
                await createBudget({ name, amount, categoryId: state.selectedBudgetCategoryId, color: state.selectedBudgetColor, showDaily });
            }
            window.closeBudgetModal();
            await loadAllData();
        } catch (err) { alert('บันทึกงบประมาณไม่สำเร็จ: ' + err.message); }
    });

    // Delete budget from modal
    document.getElementById('btn-delete-budget')?.addEventListener('click', async () => {
        if (!state.editingBudgetId) return;
        if (!confirm('ต้องการลบงบประมาณนี้ใช่หรือไม่?')) return;
        try {
            await deleteBudget(state.editingBudgetId);
            window.closeBudgetModal();
            await loadAllData();
        } catch (err) { alert('ลบไม่สำเร็จ: ' + err.message); }
    });

    // Category color dots
    document.querySelectorAll('.color-dot').forEach(dot => {
        dot.addEventListener('click', () => selectColorDot(dot.getAttribute('data-color')));
    });

    // Save category
    document.getElementById('btn-save-category')?.addEventListener('click', async () => {
        const icon = document.getElementById('cat-icon').value.trim();
        const name = document.getElementById('cat-name').value.trim();
        if (!icon || !name) return alert('กรุณากรอกไอคอน Emoji และชื่อหมวดหมู่');

        try {
            let saved;
            if (state.editingCategoryId) {
                saved = await updateCategory(state.editingCategoryId, name, icon, state.selectedCategoryColor, 0);
            } else {
                saved = await createCategory(name, icon, state.selectedCategoryColor, 0);
            }
            state.categories = await getCategories();

            const cb = state.categoryModalAfterSave;
            state.categoryModalAfterSave = null;
            window.closeCategoryModal();

            if (cb) {
                cb(saved.id);
            } else {
                await loadAllData();
            }
        } catch (err) { alert('บันทึกหมวดหมู่ล้มเหลว: ' + err.message); }
    });

    // Delete category from modal
    document.getElementById('btn-delete-category')?.addEventListener('click', async () => {
        if (!state.editingCategoryId) return;
        if (!confirm('แน่ใจว่าต้องการลบหมวดหมู่นี้? รายการที่เกี่ยวข้องจะกลายเป็นหมวดหมู่ว่าง')) {
            return;
        }
        try {
            await deleteCategory(state.editingCategoryId);
            state.categoryModalAfterSave = null;
            window.closeCategoryModal();
            await loadAllData();
        } catch (err) { alert('ลบหมวดหมู่ไม่สำเร็จ: ' + err.message); }
    });
}
