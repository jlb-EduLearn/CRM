// EduLearn CRM Database Layer and Storage Manager

const DEFAULT_USERS = [
    // Management
    { id: "admin", name: "System Administrator", role: "System Administrator", password: "123", region: "All", avatarColor: "var(--warning)" },
    { id: "ceo", name: "Delgum Jumalon", role: "President / CEO", password: "123", region: "All", avatarColor: "var(--primary)" },
    { id: "vp_sales", name: "Rolyn Benjamin", role: "VP for Sales and Marketing", password: "123", region: "All", avatarColor: "var(--cyan-600)" },
    { id: "rm_visayas", name: "Phoebe Montizo", role: "Regional Manager", password: "123", region: "Visayas", avatarColor: "var(--teal-600)" },
    { id: "rm_nluzon", name: "Grace Bulan", role: "Regional Manager", password: "123", region: "North Luzon", avatarColor: "var(--orange-600)" },
    { id: "rm_mindanao", name: "Charish", role: "Regional Manager", password: "123", region: "Mindanao", avatarColor: "var(--rose-600)" },
    // Support
    { id: "finance", name: "Jonary Palacio", role: "Finance / Collections", password: "123", region: "All", avatarColor: "var(--success)" },
    { id: "hr", name: "Olivia Oliva", role: "Human Resource", password: "123", region: "All", avatarColor: "var(--teal-700)" },
    { id: "fulfillment", name: "Rashalle Pularan", role: "Training / Fulfillment", password: "123", region: "All", avatarColor: "var(--purple-600)" },
    // 2025 Solution Specialists
    { id: "ss_apg", name: "Antonio Gutierrez", role: "Solution Specialist", password: "123", region: "Visayas", territory: "Leyte", avatarColor: "var(--blue-600)" },
    { id: "ss_capiz", name: "Hannah So", role: "Solution Specialist", password: "123", region: "Visayas", territory: "Panay", avatarColor: "var(--blue-700)" },
    { id: "ss_dav", name: "Jonathan Cuayzon", role: "Solution Specialist", password: "123", region: "Mindanao", territory: "Davao", avatarColor: "var(--yellow-600)" },
    { id: "ss_gencot", name: "James Carlo", role: "Solution Specialist", password: "123", region: "Mindanao", territory: "Gen. Santos", avatarColor: "var(--rose-700)" },
    { id: "ss_oma", name: "Oca Alaman", role: "District Manager", password: "123", region: "North Luzon", district: "Cagayan Valley", avatarColor: "var(--emerald-700)" },
    { id: "ss_tmm", name: "Thomas Manulat", role: "Solution Specialist", password: "123", region: "Visayas", territory: "Visayas (Central)", avatarColor: "var(--blue-600)" },
    { id: "ss_rmd", name: "Rhonna Duran", role: "District Manager", password: "123", region: "Mindanao", district: "Zamboanga", avatarColor: "var(--fuchsia-800)" },
    { id: "ss_tma", name: "Therese Alegado", role: "Solution Specialist", password: "123", region: "Visayas", territory: "Cebu Metro", district: "Cebu Metro", avatarColor: "var(--blue-700)" },
    { id: "ss_pvm", name: "PVM", role: "Regional Manager", password: "123", region: "Visayas", territory: "Bohol & Negros Oriental", avatarColor: "var(--indigo-600)" },
];

const DEFAULT_SCHOOLS = [];

const DEFAULT_PRODUCTS = [
    { id: "PRD-101", name: "ICT", category: "Digital Solutions"},
    { id: "PRD-102", name: "Robotics", category: "Digital Solutions"},
    { id: "PRD-103", name: "SIMS", category: "Digital Solutions"},
    { id: "PRD-104", name: "SAVVY", category: "Digital Solutions"},
    { id: "PRD-105", name: "EVE", category: "Digital Solutions"},
    { id: "PRD-106", name: "EduCast", category: "Print"}
];

const DEFAULT_TASKS = [];

const DEFAULT_PAYROLL = [];

// Seed Deals mapping onto 4 specific pipelines
const DEFAULT_DEALS = [];

// Seed Daily Activity Reports (DAR) history
const DEFAULT_ACTIVITIES = [];

const DB_KEYS = {
    USERS: "edu_users",
    SCHOOLS: "edu_schools",
    DEALS: "edu_deals",
    ACTIVITIES: "edu_activities",
    PRODUCTS: "edu_products",
    TASKS: "edu_tasks",
    PAYROLL: "edu_payroll",
};

const DEFAULT_DATA = {
    [DB_KEYS.USERS]: DEFAULT_USERS,
    [DB_KEYS.SCHOOLS]: DEFAULT_SCHOOLS,
    [DB_KEYS.DEALS]: DEFAULT_DEALS,
    [DB_KEYS.ACTIVITIES]: DEFAULT_ACTIVITIES,
    [DB_KEYS.PRODUCTS]: DEFAULT_PRODUCTS,
    [DB_KEYS.TASKS]: DEFAULT_TASKS,
    [DB_KEYS.PAYROLL]: DEFAULT_PAYROLL,
};

const API_BASE_URL = 'https://edulearn-crm-api.jlb-2fb.workers.dev';

const EduLearnDB = {
    // The init function is no longer needed to seed localStorage.
    // The database will be managed by the backend.
    init() {
        // This function can be used in the future for one-time data migrations
        // or other startup tasks if needed.
        console.log("EduLearnDB Online Mode Initialized.");
    },

    // Helper to fetch data from the backend API
    async _getData(endpoint) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/${endpoint}`);
            if (!response.ok) {
                throw new Error(`Network response was not ok for ${endpoint}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`EduLearnDB: Failed to fetch data from /api/${endpoint}`, error);
            // Return an empty array on failure to prevent app crashes
            return [];
        }
    },

    // Helper to save data to the backend API
    async _saveData(endpoint, data, method = 'POST') {
        try {
            const response = await fetch(`${API_BASE_URL}/api/${endpoint}`, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                throw new Error(`Failed to save data to ${endpoint}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`EduLearnDB: Failed to save data to /api/${endpoint}`, error);
            return null;
        }
    },

    // --- API-driven Data Access Methods ---

    getUsers: async function () { return this._getData('users'); },
    saveUsers: async function (data) { return this._saveData('users', data); },
    getSchools: async function () { return this._getData('schools'); },
    saveSchools: async function (data) { return this._saveData('schools', data); },
    getDeals: async function () { return this._getData('deals'); },
    saveDeals: async function (data) { return this._saveData('deals', data); },
    getActivities: async function () { return this._getData('activities'); },
    saveActivities: async function (data) { return this._saveData('activities', data); },
    getProducts: async function () { return this._getData('products'); },
    saveProducts: async function (data) { return this._saveData('products', data); },
    getTasks: async function () { return this._getData('tasks'); },
    saveTasks: async function (data) { return this._saveData('tasks', data); },
    getPayroll: async function () { return this._getData('payroll'); },
    savePayroll: async function (data) { return this._saveData('payroll', data); },

    validateLogin: async function (userId, password) {
        try {
            const response = await fetch(`${API_BASE_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, password }),
            });
            if (!response.ok) return null;
            return await response.json();
        } catch (error) {
            console.error("Login validation failed:", error);
            return null;
        }
    }
};

EduLearnDB.init();
window.EduLearnDB = EduLearnDB;
