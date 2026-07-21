// EduLearn CRM Command Controller Logic

(async () => {
    // Check if database layer is active
    if (!window.EduLearnDB) {
        console.error("EduLearnDB module not loaded!");
        return;
    }

    // Local State
    const state = {
        session: null,
        activeTab: "dashboard",
        activePipeline: "main",

        schools: [],
        deals: [],
        activities: [],
        tasks: [],
        products: [],
        payroll: [],
        users: [],

        // Searches
        schoolQuery: "",
        schoolRegion: "all",
        schoolAccountType: "all",
    financialsQuery: "",
        taskQuery: "",
        activityQuery: "",
        activityEmployee: "all",
        activityStartDate: "",
        activityEndDate: "",
        // DAR photo capture state
        darPhotos: [],
        darPhotoLocations: [],
        darPhotoOut: null,
        darLocationOut: null,
        stream: null,
    };

    // Chart References
    let salesChart = null;

    // Toast Notifications System
    function showToast(title, message, type = "info") {
        const holder = document.getElementById("toast-holder");
        if (!holder) return;

        const toast = document.createElement("div");
        toast.className = `toast ${type}`;

        let icon = "fa-info-circle";
        if (type === "success") icon = "fa-circle-check";
        if (type === "warning") icon = "fa-triangle-exclamation";
        if (type === "danger") icon = "fa-circle-xmark";

        toast.innerHTML = `
            <i class="fa-solid ${icon}"></i>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-msg">${message}</div>
            </div>
        `;
        holder.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = "fadeOut 0.3s forwards";
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // ================= CLOUDFLARE R2 INTEGRATION =================

    // Cloudflare R2 Configuration - IMPORTANT: PLEASE READ
    // This application uploads files directly from the client to Cloudflare R2.
    // The most secure way to do this is by using pre-signed URLs.
    //
    // TO SET THIS UP:
    // 1. You need a backend endpoint (like a Cloudflare Worker) that can safely use your
    //    R2 credentials to generate a pre-signed URL for uploading.
    // 2. This backend should return a JSON object with `uploadURL` and `publicURL`.
    // 3. The `uploadToCloudflareR2` function below is written to work with such a backend.
    //    You will need to create this backend endpoint yourself.
    // 4. Update the `fetch` path inside `uploadToCloudflareR2` if your endpoint is different.

    function dataURLtoBlob(dataurl) {
        const arr = dataurl.split(',');
        const mimeMatch = arr[0].match(/:(.*?);/);
        if (!mimeMatch) return null;
        const mime = mimeMatch[1];
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }

    async function uploadToCloudflareR2(blob, fileName) {
        try {
            // Step 1: Request a pre-signed URL from your backend endpoint.
            // This endpoint securely generates a temporary URL for the upload.
            // We pass the desired fileName to the backend.
            const presignResponse = await fetch(`/api/generate-r2-upload-url?fileName=${encodeURIComponent(fileName)}`);

            if (!presignResponse.ok) {
                const errorText = await presignResponse.text();
                throw new Error(`Server error getting pre-signed URL: ${errorText}`);
            }

            const { uploadURL, publicURL } = await presignResponse.json();

            if (!uploadURL || !publicURL) {
                throw new Error('Invalid response from pre-signed URL endpoint.');
            }

            // Step 2: Upload the file directly to R2 using the pre-signed URL.
            const uploadResponse = await fetch(uploadURL, {
                method: 'PUT',
                body: blob,
                headers: {
                    'Content-Type': blob.type,
                },
            });

            if (!uploadResponse.ok) {
                throw new Error('Cloudflare R2 upload failed.');
            }

            // Step 3: Return the public URL of the uploaded file for storage in the database.
            return publicURL;
        } catch (error) {
            console.error("Error during Cloudflare R2 upload:", error);
            showToast("Upload Failed", "Could not save photo to Cloudflare R2. See console for details.", "danger");
            return null;
        }
    }

    // Refresh memory states
    async function refreshData() {
        const safeArray = (value) => Array.isArray(value) ? value : [];
        // Use Promise.all to fetch data concurrently for better performance
        const [schools, deals, activities, tasks, products, payroll, users] = await Promise.all([
            window.EduLearnDB.getSchools(),
            window.EduLearnDB.getDeals(),
            window.EduLearnDB.getActivities(),
            window.EduLearnDB.getTasks(),
            window.EduLearnDB.getProducts(),
            window.EduLearnDB.getPayroll(),
            window.EduLearnDB.getUsers()
        ]);

        state.schools = safeArray(schools);
        state.deals = safeArray(deals);
        state.activities = safeArray(activities);
        state.tasks = safeArray(tasks);
        state.products = safeArray(products);
        state.payroll = safeArray(payroll);
        state.users = safeArray(users);
    }

    function getSessionContext() {
        const session = state.session || {};
        const user = session.user || session || {};
        const role = session.role || user.role || "";
        return { session, user, role };
    }

    function isGlobalVisibilityRole(role) {
        return ["President / CEO", "VP for Sales and Marketing", "Finance / Collections", "Training / Fulfillment", "System Administrator"].includes(role);
    }

    function isApproverRole(role) {
        return ["Regional Manager", "VP for Sales and Marketing", "President / CEO", "System Administrator"].includes(role);
    }

    function isScopedSalesRole(role) {
        return role === "Solution Specialist" || role === "Sales Account";
    }

    function canViewSalesCompliance(role) {
        return ["President / CEO", "VP for Sales and Marketing", "System Administrator", "Regional Manager", "District Manager"].includes(role);
    }

    function getVisibleSpecialistsForCurrentUser() {
        const { role, user } = getSessionContext();
        const fieldworkRoles = ["Solution Specialist", "Sales Account", "District Manager", "Regional Manager", "VP for Sales and Marketing"];

        // For global roles, get all fieldwork personnel.
        if (["President / CEO", "System Administrator"].includes(role)) {
            return state.users.filter(u => fieldworkRoles.includes(u.role));
        }

        // For a VP, get all RMs, DMs, and SS.
        if (role === "VP for Sales and Marketing") {
            return state.users.filter(u => fieldworkRoles.includes(u.role) && u.role !== "VP for Sales and Marketing");
        }

        // For an RM, get all DMs and SS in their region.
        if (role === "Regional Manager") {
            return state.users.filter(u => u.region === user.region && (u.role === 'District Manager' || isScopedSalesRole(u.role)));
        }

        // For a DM, get all SS in their district.
        if (role === "District Manager") {
            return state.users.filter(u => u.district === user.district && isScopedSalesRole(u.role));
        }

        // For other roles (HR, Finance, etc.), return an empty list as they shouldn't see this widget.
        return [];
    }


    // ================= DUAL ROLE & ACCESS GATEWAYS =================

    const loginScreen = document.getElementById("login-screen");
    const appPortal = document.getElementById("app-portal");
    const loginForm = document.getElementById("login-form");
    const btnLogout = document.getElementById("btn-logout");
    const btnAddUser = document.getElementById("btn-add-user");
    const userModal = document.getElementById("user-modal");
    const btnUserClose = document.getElementById("btn-user-close");
    const btnUserCancel = document.getElementById("btn-user-cancel");
    const userForm = document.getElementById("user-form");

    // ================= NAVIGATION ROUTING =================

    const navItems = document.querySelectorAll(".nav-menu .nav-item");
    const pagePanels = document.querySelectorAll(".page-panel");
    const pageTitleHeader = document.getElementById("page-title-header");
    const pageSubtitleHeader = document.getElementById("page-subtitle-header");

    const tabMeta = {
        dashboard: { title: "Sales Command Center", subtitle: "Daily fieldwork, pipeline monitoring, territory controls and quota tracking" },
        schools: { title: "Schools Database", subtitle: "EduLearn Technologies master institutional directory and relationships health" },
        financials: { title: "Financials Reconciliation", subtitle: "Update PO values, deliveries, and returns for won deals." },
        "business-report": { title: "Business Report", subtitle: "Sales performance analysis by region and specialist" },
        tasks: { title: "Task Board", subtitle: "Team tasks, collection follow-ups, training schedules and pipeline action items" },
        kanban: { title: "Progress Report", subtitle: "Visual tracker for the entire account lifecycle" },
        activities: { title: "Daily Activities (DAR)", subtitle: "Solution Specialists fieldwork logs, demo outcomes and photos audit checks" },
        payroll: { title: "Payroll Overview", subtitle: "Compensation records for approved finance, HR, and executive users" },
        settings: { title: "Command Configurations", subtitle: "Perform local database synchronization and metadata maintenance" }
    };

    const appContainer = document.getElementById("app-portal");
    const sidebarToggleBtn = document.getElementById("btn-sidebar-toggle");
    const sidebarOverlay = document.getElementById("sidebar-overlay");

    function closeMobileSidebar() {
        appContainer.classList.remove("sidebar-open");
    }

    function openMobileSidebar() {
        appContainer.classList.add("sidebar-open");
    }

    function navigateTo(targetTab) {
        if (!targetTab || !tabMeta[targetTab]) return;

        navItems.forEach(n => n.classList.remove("active"));
        const navButton = document.querySelector(`.nav-item[data-tab="${targetTab}"]`);
        if (navButton) navButton.classList.add("active");

        pagePanels.forEach(p => p.classList.remove("active"));
        const targetPanel = document.getElementById(`${targetTab}-panel`);
        if (targetPanel) targetPanel.classList.add("active");

        pageTitleHeader.textContent = tabMeta[targetTab].title;
        pageSubtitleHeader.textContent = tabMeta[targetTab].subtitle;

        state.activeTab = targetTab;

        if (window.innerWidth <= 860) {
            closeMobileSidebar();
        }

        // Render view updates for the new tab
        await refreshActiveView();
    }

    navItems.forEach(item => {
        item.addEventListener("click", () => {
            const targetTab = item.getAttribute("data-tab");
            navigateTo(targetTab);
        });
    });

    // Load initial data from the backend
    await refreshData();

    // Check existing session
    const savedSession = localStorage.getItem("edu_session");
    if (savedSession) {
        try {
            await setSession(JSON.parse(savedSession));
        } catch (e) {
            localStorage.removeItem("edu_session");
            showLoginGate();
        }
    } else {
        showLoginGate();
    }

    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const username = document.getElementById("login-username").value.trim();
        const secret = document.getElementById("login-password").value;

        const result = await window.EduLearnDB.validateLogin(username, secret);

        if (!result) {
            showToast("Access Denied", "Invalid account ID or passcode.", "danger");
            return;
        }

        localStorage.setItem("edu_session", JSON.stringify(result));
        await setSession(result);
        showToast("Authenticated", `Welcome, ${result.user.name}! Connected to command node.`, "success");
    });

    btnLogout.addEventListener("click", () => {
        stopCameras();
        localStorage.removeItem("edu_session");
        state.session = null;
        showLoginGate();
        showToast("Logged Out", "Session destroyed successfully.", "info");
    });

    function showLoginGate() {
        loginScreen.style.display = "flex";
        appPortal.style.display = "none";
    }

    async function setSession(sessionObj) {
        state.session = sessionObj;
        loginScreen.style.display = "none";
        appPortal.style.display = "flex";

        // Display profile properties
        document.getElementById("sidebar-profile-name").textContent = sessionObj.user.name;
        document.getElementById("sidebar-profile-role").textContent = sessionObj.user.role;

        const initials = sessionObj.user.name.split(' ').map(n => n[0]).join('');
        const avatar = document.getElementById("sidebar-profile-avatar");
        avatar.textContent = initials;
        avatar.style.background = sessionObj.user.avatarColor || "var(--primary)";
        avatar.style.color = "var(--text-on-primary, white)";

        // Configure dynamic sidebar visibility rules if role has narrow scopes
        applyRoleMenuConfig();
        applyTaskPermissions();

        // Trigger page view default
        await navigateTo('dashboard');
    }

    function applyRoleMenuConfig() {
        const { role } = getSessionContext();
        const settingsItem = document.querySelector('[data-tab="settings"]');
        const payrollItem = document.querySelector('[data-tab="payroll"]');
        const businessReportItem = document.querySelector('[data-tab="business-report"]');
        const financialsItem = document.querySelector('[data-tab="financials"]');

        // Default all to visible, then apply restrictions
        if (settingsItem) settingsItem.style.display = "block";
        if (payrollItem) payrollItem.style.display = "block";
        if (businessReportItem) businessReportItem.style.display = "block";
        if (financialsItem) financialsItem.style.display = "block";

        // --- Role-based restrictions ---

        // Per review, hide manager-level tabs from Solution Specialists to focus the training.
        if (isScopedSalesRole(role)) {
            if (businessReportItem) businessReportItem.style.display = "none";
            if (financialsItem) financialsItem.style.display = "none";
        }

        // Non-sales support roles don't need administrative config settings
        if (["Finance / Collections", "Training / Fulfillment"].includes(role)) {
            if (settingsItem) settingsItem.style.display = "none";
        }

        // Restrict payroll visibility
        const payrollVisibleTo = ["System Administrator", "President / CEO", "Finance / Collections", "Human Resource"];
        if (payrollItem && !payrollVisibleTo.includes(role)) {
            payrollItem.style.display = "none";
        }
    }

    function applyTaskPermissions() {
        const btnAddTaskPage = document.getElementById("btn-add-task");
        if (!btnAddTaskPage) return;

        const { role } = getSessionContext();
        // Allow managers to create tasks. SS can only be assigned tasks.
        const canCreateTasks = ["President / CEO", "VP for Sales and Marketing", "System Administrator", "Regional Manager", "District Manager"].includes(role);
        btnAddTaskPage.style.display = canCreateTasks ? "inline-flex" : "none";
    }

    async function renderUserAccounts() {
        const userCard = document.getElementById("user-management-card");
        const tableBody = document.getElementById("user-table-body");
        if (!tableBody || !userCard) return;

        const { role } = getSessionContext();
        const allowed = ["System Administrator", "President / CEO", "VP for Sales and Marketing"].includes(role);
        userCard.style.display = allowed ? "block" : "none";
        if (!allowed) return;

        const users = await window.EduLearnDB.getUsers();
        tableBody.innerHTML = "";

        users.forEach(user => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="font-family: monospace; font-weight: 700; color: var(--text-muted);">${user.id}</td>
                <td>${user.name}</td>
                <td>${user.role}</td>
                <td>${user.region || "All"}</td>
                <td>
                    <div class="actions-cell">
                        <button class="action-icon-btn edit-user-btn" data-id="${user.id}" title="Edit Account">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button class="action-icon-btn delete-user-btn" data-id="${user.id}" title="Delete Account">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </td>
            `;
            tableBody.appendChild(tr);
        });

        tableBody.querySelectorAll(".edit-user-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-id");
                const userObj = state.users.find(u => u.id === id);
                openUserModal(userObj);
            });
        });

        tableBody.querySelectorAll(".delete-user-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                const userObj = state.users.find(u => u.id === id);
                if (!userObj) return;
                if (!confirm(`Delete ${userObj.name} (${userObj.id}) from the system?`)) return;

                let users = await window.EduLearnDB.getUsers();
                users = users.filter(u => u.id !== id);
                await window.EduLearnDB.saveUsers(users);
                showToast("Account Removed", `${userObj.name} has been removed.`, "danger");

                if (state.session.user.id === id) {
                    btnLogout.click();
                    return;
                }

                await refreshData();
                await refreshActiveView();
            });
        });
    }

    function openUserModal(user = null) {
        const userFormId = document.getElementById("user-form-id");
        const userId = document.getElementById("user-id");
        const userName = document.getElementById("user-name");
        const userRole = document.getElementById("user-role");
        const userRegion = document.getElementById("user-region");
        const userPassword = document.getElementById("user-password");

        if (!user) {
            userFormId.value = "";
            userId.value = "";
            userName.value = "";
            userRole.value = "Solution Specialist";
            userRegion.value = "Visayas";
            userPassword.value = "";
            document.getElementById("user-modal-title").textContent = "Create User Account";
        } else {
            userFormId.value = user.id;
            userId.value = user.id;
            userName.value = user.name;
            userRole.value = user.role;
            userRegion.value = user.region || "All";
            userPassword.value = user.password;
            document.getElementById("user-modal-title").textContent = `Edit Account: ${user.id}`;
        }

        if (userModal) userModal.classList.add("active");
    }

    function closeUserModal() {
        if (userModal) userModal.classList.remove("active");
        if (userForm) userForm.reset();
        const userFormId = document.getElementById("user-form-id");
        if (userFormId) userFormId.value = "";
    }

    if (btnAddUser) {
        btnAddUser.addEventListener("click", () => openUserModal());
    }

    if (btnUserClose) btnUserClose.addEventListener("click", closeUserModal);
    if (btnUserCancel) btnUserCancel.addEventListener("click", closeUserModal);

    if (userForm) {
        userForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const userFormId = document.getElementById("user-form-id").value.trim();
            const userId = document.getElementById("user-id").value.trim().toLowerCase();
            const userName = document.getElementById("user-name").value.trim();
            const userRole = document.getElementById("user-role").value;
            const userRegion = document.getElementById("user-region").value;
            const userPassword = document.getElementById("user-password").value;
            if (!userId || !userName || !userPassword) {
                showToast("Invalid Input", "Please complete all required fields.", "warning");
                return;
            }

            const roleColors = {
                "System Administrator": "var(--warning)",
                "President / CEO": "var(--primary)",
                "VP for Sales and Marketing": "var(--cyan-600)",
                "Regional Manager": "var(--teal-600)",
                "District Manager": "var(--rose-600)",
                "Solution Specialist": "var(--blue-600)",
                "Finance / Collections": "var(--success)",
                "Training / Fulfillment": "var(--purple-600)",
                "Human Resource": "var(--teal-700)"
            };

            const users = await window.EduLearnDB.getUsers();
            const existingIndex = users.findIndex(u => u.id === userId);
            const avatarColor = roleColors[userRole] || "#64748b";

            if (userFormId && existingIndex !== -1) {
                users[existingIndex] = {
                    ...users[existingIndex],
                    id: userId,
                    name: userName,
                    role: userRole,
                    region: userRegion,
                    password: userPassword,
                    avatarColor
                };
                showToast("Account Updated", `${userName} has been updated.`, "success");
            } else {
                if (existingIndex !== -1) {
                    showToast("Duplicate ID", "Account ID already exists.", "danger");
                    return;
                }
                users.push({
                    id: userId,
                    name: userName,
                    role: userRole,
                    password: userPassword,
                    region: userRegion,
                    avatarColor
                });
                showToast("Account Created", `${userName} is now added to the system.`, "success");
            }

            await window.EduLearnDB.saveUsers(users);
            await refreshData();
            await refreshActiveView();
            closeUserModal();
        });
    }

    async function refreshActiveView() {
        // This function re-renders the currently active tab.
        // It assumes data has already been refreshed via refreshData() in each render function.
        const activeTab = state.activeTab;
        if (activeTab === "dashboard") await renderDashboard();
        else if (activeTab === "schools") await renderSchoolsList();
        else if (activeTab === "business-report") await renderBusinessReport();
        else if (activeTab === "financials") await renderFinancials();
        else if (activeTab === "tasks") await renderTasksList();
        else if (activeTab === "kanban") await renderKanban();
        else if (activeTab === "activities") await renderActivitiesList();
        else if (activeTab === "payroll") await renderPayroll();
        else if (activeTab === "settings") await loadSettingsView();
    }

    const roleFilterStrategies = {
        "Regional Manager": (item, user) => {
            // For items with a `region` property (like schools)
            if (item.region === user.region) return true;
            // For items linked to a school (like deals or activities)
            if (item.schoolId) {
                const school = state.schools.find(s => s.id === item.schoolId);
                return school && school.region === user.region;
            }
            return false;
        },
        "District Manager": (item, user, userField) => {
            const itemUserId = item[userField];
            if (!itemUserId) return false;
            if (itemUserId === user.id) return true; // DM can see their own items.
            const itemUser = state.users.find(u => u.id === itemUserId);
            // A DM can see items assigned to an SS in their district.
            return itemUser && itemUser.district === user.district;
        },
        // Consolidates the isScopedSalesRole check
        "Solution Specialist": (item, user, userField) => item[userField] === user.id,
        "Sales Account": (item, user, userField) => item[userField] === user.id,
    };

    // ================= ROLE-BASED ACCESS DATA FILTERING =================

    /**
     * Filters a generic dataset (like schools, leads, deals, activities) based on the current user's role and scope.
     * @param {Array} dataset The array of items to filter.
     * @param {string} userField The property on each item that holds the assigned user's ID (e.g., 'assignedSS' or 'ssId').
     * @returns {Array} The filtered array of items.
     */
    function filterByRoleVisibility(dataset, userField = "assignedSS") {
        const safeDataset = Array.isArray(dataset) ? dataset : [];
        if (safeDataset.length === 0) return [];

        const { role, user } = getSessionContext();

        if (isGlobalVisibilityRole(role)) {
            return safeDataset;
        }

        const filterStrategy = roleFilterStrategies[role];
        if (filterStrategy) {
            return safeDataset.filter(item => filterStrategy(item, user, userField));
        }

        return [];
    }

    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener("click", () => {
            if (appContainer.classList.contains("sidebar-open")) {
                closeMobileSidebar();
            } else {
                openMobileSidebar();
            }
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener("click", closeMobileSidebar);
    }

    // Theme Switcher Logic
    const themeBtns = document.querySelectorAll(".theme-btn");
    themeBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const themeVal = btn.getAttribute("data-theme-val");
            document.documentElement.setAttribute("data-theme", themeVal);
            localStorage.setItem("crm_theme", themeVal);
            themeBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            showToast("Appearance Updated", `Switched to ${themeVal.charAt(0).toUpperCase() + themeVal.slice(1)} Mode`, "success");

            if (state.activeTab === "dashboard") renderCharts();
        });
    });

    // Dashboard Compliance Filter
    const compliancePersonnelFilter = document.getElementById("compliance-personnel-filter");
    if (compliancePersonnelFilter) {
        compliancePersonnelFilter.addEventListener("change", renderComplianceWidget);
    }

    // Financials Search Filter
    const financialsSearchInput = document.getElementById("financials-search");
    if (financialsSearchInput) {
        financialsSearchInput.addEventListener("input", (e) => {
            state.financialsQuery = e.target.value.toLowerCase();
            renderFinancials();
        });
    }

    const btnSubmitDayReport = document.getElementById("btn-submit-day-report");
    if (btnSubmitDayReport) {
        btnSubmitDayReport.addEventListener("click", handleSubmitDayReport);
    }

    // Clock tickers
    function tickClock() {
        const timeSpan = document.getElementById("live-clock-time");
        const now = new Date();
        const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
        const timeStr = now.toLocaleTimeString('en-US', timeOptions);
        if (timeSpan) timeSpan.textContent = timeStr;
    }
    tickClock();
    setInterval(tickClock, 1000);

    // ================= TAB: SALES COMMAND DASHBOARD =================

    async function renderDashboard() {
        await refreshData();
        calculateDashboardKPIs();
        await renderComplianceWidget();
        await renderTaskSummaryWidget();
        renderCharts();
    }

    async function renderTaskSummaryWidget() {
        const widget = document.getElementById("task-summary-widget");
        const tableBody = document.getElementById("task-summary-table-body");
        if (!widget || !tableBody) return;
    
        const { role } = getSessionContext();
        const canView = ["President / CEO", "VP for Sales and Marketing", "System Administrator"].includes(role);
    
        if (!canView) {
            widget.style.display = "none";
            return;
        }
    
        widget.style.display = "block";
    
        const specialistIds = new Set(
            state.users.filter(u => u.role === 'Solution Specialist').map(u => u.id)
        );
    
        const relevantTasks = state.tasks.filter(task =>
            specialistIds.has(task.assignedTo) &&
            (task.status === 'In Progress' || task.status === 'Completed')
        );
    
        tableBody.innerHTML = "";
    
        if (relevantTasks.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 40px;">
                        <i class="fa-solid fa-check-double" style="font-size: 32px; margin-bottom: 12px;"></i>
                        <p>No 'In Progress' or 'Completed' tasks found for Solution Specialists.</p>
                    </td>
                </tr>
            `;
            return;
        }
    
        relevantTasks.sort((a, b) => a.status.localeCompare(b.status));
    
        relevantTasks.forEach(task => {
            const assignee = state.users.find(u => u.id === task.assignedTo) || { name: 'N/A' };
            const school = state.schools.find(s => s.id === task.relatedSchoolId) || { name: 'N/A' };
            const statusBadgeClass = task.status === 'Completed' ? 'badge-present' : 'badge-info';
    
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <div style="font-weight: 600;">${task.title}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${task.category}</div>
                </td>
                <td>${assignee.name}</td>
                <td>${school.name}</td>
                <td><span class="badge ${statusBadgeClass}">${task.status}</span></td>
            `;
            tableBody.appendChild(tr);
        });
    }

    function calculateDashboardKPIs() {
        // Apply access locks to dashboards values
        const visibleDeals = filterByRoleVisibility(state.deals, "assignedSS");
        const visibleActivities = filterByRoleVisibility(state.activities, "ssId");

        const { grossValue, netWonValue, wonDealsCount, totalCollected } = visibleDeals.reduce((acc, deal) => {
            acc.grossValue += deal.grossValue || 0;
            const isWon = deal.stage.toLowerCase().includes("won") || deal.stage === "Fully Collected" || deal.stage === "Completed";
            if (isWon) {
                acc.netWonValue += deal.netValue || 0;
                acc.wonDealsCount++;
            }
            acc.totalCollected += deal.amountCollected || 0;
            return acc;
        }, { grossValue: 0, netWonValue: 0, wonDealsCount: 0, totalCollected: 0 });

        // Compute collect rate matching deals
        const dealsWithPayments = visibleDeals.filter(d => d.collectionPercent > 0);
        let averageCollectionRate = 0;
        if (dealsWithPayments.length > 0) {
            const sumPercents = dealsWithPayments.reduce((acc, curr) => acc + (curr.collectionPercent || 0), 0);
            averageCollectionRate = Math.round(sumPercents / dealsWithPayments.length);
        }

        // Format PHP currency values
        document.getElementById("kpi-gross-value").textContent = `₱${grossValue.toLocaleString()}`;
        document.getElementById("kpi-net-won").textContent = `₱${netWonValue.toLocaleString()}`;
        document.getElementById("kpi-won-deals-count").textContent = `${wonDealsCount} pipeline opportunities won`;
        document.getElementById("kpi-collected").textContent = `₱${totalCollected.toLocaleString()}`;
        document.getElementById("kpi-collect-percent").textContent = `${averageCollectionRate}% average invoice collection`;

        // Field compliance rate today
        const specialists = getVisibleSpecialistsForCurrentUser();
        const todayStr = new Date().toISOString().split('T')[0];

        let compliantCount = 0;
        specialists.forEach(ss => {
            const ssActivitiesToday = state.activities.filter(a => a.ssId === ss.id && a.date === todayStr && a.type === "School Visit");
            const uniqueSchoolIds = new Set(ssActivitiesToday.map(a => a.schoolId));
            const uniqueVisitsCount = uniqueSchoolIds.size;
            if (uniqueVisitsCount >= 4) compliantCount++;
        });

        const complianceRate = specialists.length > 0 ? Math.round((compliantCount / specialists.length) * 100) : 100;
        document.getElementById("kpi-compliance-rate").textContent = `${complianceRate}%`;
    }

    async function renderComplianceWidget() {
        const parentContainer = document.querySelector("#dashboard-panel .compliance-container");
        if (!parentContainer) return;

        const { role } = getSessionContext();

        if (!canViewSalesCompliance(role)) {
            parentContainer.style.display = 'none';
            return;
        }

        parentContainer.style.display = 'block';
        const container = document.getElementById("dashboard-compliance-list");
        const personnelFilter = document.getElementById("compliance-personnel-filter");
        if (!container || !personnelFilter) return;

        container.innerHTML = "";

        const todayStr = new Date().toISOString().split('T')[0];

        // Determine which personnel to display based on user role
        const allVisiblePersonnel = getVisibleSpecialistsForCurrentUser();

        // Populate the filter dropdown with individual personnel
        const currentSelection = personnelFilter.value;
        personnelFilter.innerHTML = '<option value="all">All Personnel</option>';
        allVisiblePersonnel.forEach(person => {
            const opt = document.createElement('option');
            opt.value = person.id;
            opt.textContent = `${person.name} (${person.role})`;
            personnelFilter.appendChild(opt);
        });
        // Restore selection if possible
        if ([...personnelFilter.options].some(o => o.value === currentSelection)) {
            personnelFilter.value = currentSelection;
        } else {
            personnelFilter.value = 'all';
        }

        // Filter personnel to render based on the dropdown selection
        let personnelToRender = allVisiblePersonnel;
        const selectedPersonnelId = personnelFilter.value;
        if (selectedPersonnelId !== 'all') {
            personnelToRender = allVisiblePersonnel.filter(p => p.id === selectedPersonnelId);
        }

        if (personnelToRender.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 30px 0;">
                    <i class="fa-solid fa-users-slash" style="font-size: 24px; margin-bottom: 8px;"></i>
                    <p>No personnel found for the selected filter.</p>
                </div>
            `;
            return;
        }

        personnelToRender.forEach(person => {
            let complianceLabel = person.territory ? `${person.territory} Territory` : (person.district ? `${person.district} District` : (person.region ? `${person.region} Region` : 'All'));
            let isCompliant, percent;

            const target = 4;

            const activitiesToday = state.activities.filter(a => a.ssId === person.id && a.date === todayStr && a.type === "School Visit");
            const uniqueSchoolIds = new Set(activitiesToday.map(a => a.schoolId));
            const visitCount = uniqueSchoolIds.size;
            isCompliant = visitCount >= target;
            percent = Math.min(Math.round((visitCount / target) * 100), 100);

            const displayValue = `${percent}%`;
            const displayLabel = `${visitCount} / ${target} visits`;

            const card = document.createElement("div");
            card.className = "compliance-ss-card";
            card.innerHTML = ` 
                <div class="compliance-ss-header">
                    <div class="avatar" style="width: 28px; height: 28px; border-radius: 50%; background: ${person.avatarColor || 'var(--primary)'}; color: var(--text-on-primary, white); display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700;">
                        ${person.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div style="min-width: 0;">
                        <h5 style="font-size: 13px; font-weight: 700;">${person.name}</h5>
                        <p style="font-size: 10px; color: var(--text-muted);">${complianceLabel}</p>
                    </div>
                </div>
                <div class="compliance-progress-box">
                    <div class="compliance-progress-bar">
                        <div class="compliance-progress-fill ${isCompliant ? '' : 'under'}" style="width: ${percent}%;"></div>
                    </div>
                    <div class="compliance-count" style="margin-top: 6px;">
                        <span style="color: var(${isCompliant ? '--success' : '--danger'}); font-size: 14px; font-weight: 700;">${displayValue}</span>
                        <span style="color: var(--text-muted);">${displayLabel}</span>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    async function renderCharts() {
        const ctxSales = document.getElementById("regionSalesChart");

        if (!ctxSales) return;

        if (salesChart) salesChart.destroy();

        // Helper to read CSS variables for theme-aware charts
        const getCssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

        const gridColor = getCssVar('--border-color');
        const textColor = getCssVar('--text-secondary');
        const primaryColor = getCssVar('--primary');
        const successColor = getCssVar('--success');
        // Group values by region using the current user's scoped view
        const visibleDeals = filterByRoleVisibility(state.deals, "assignedSS");
        const visibleSchools = filterByRoleVisibility(state.schools, "assignedSS");
        const visibleSchoolIds = new Set(visibleSchools.map(s => s.id));
        const regions = ["North Luzon", "South Luzon", "Visayas", "Mindanao"];
        const grossSums = regions.map(reg => {
            const deals = visibleDeals.filter(d => {
                const school = visibleSchools.find(s => s.id === d.schoolId);
                return school && school.region === reg;
            });
            return deals.reduce((acc, curr) => acc + (curr.grossValue || 0), 0);
        });

        const netWonSums = regions.map(reg => {
            const deals = visibleDeals.filter(d => {
                const school = visibleSchools.find(s => s.id === d.schoolId);
                const isWon = d.stage.toLowerCase().includes("won") || d.stage === "Fully Collected" || d.stage === "Completed";
                return school && school.region === reg && isWon;
            });
            return deals.reduce((acc, curr) => acc + (curr.netValue || 0), 0);
        });

        // 1. Sales by Region Chart
        salesChart = new Chart(ctxSales, {
            type: 'bar',
            data: {
                labels: regions,
                datasets: [
                    {
                        label: 'Gross Value (₱)',
                        data: grossSums,
                        backgroundColor: primaryColor,
                        borderRadius: 6
                    },
                    {
                        label: 'Net Sales Won (₱)',
                        data: netWonSums,
                        backgroundColor: successColor,
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: textColor, font: { family: 'Outfit' } } }
                },
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: textColor } },
                    y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => `₱${v / 1000}k` } }
                }
            }
        });
    }

    // ================= TAB: MASTER SCHOOLS DATABASE =================

    const schoolSearch = document.getElementById("school-search");
    const schoolRegionFilter = document.getElementById("school-region-filter");
    const schoolAccountTypeFilter = document.getElementById("school-account-type-filter");
    const btnAddSchool = document.getElementById("btn-add-school");
    const schoolModal = document.getElementById("school-modal");
    const btnSchoolClose = document.getElementById("btn-school-close");
    const btnSchoolCancel = document.getElementById("btn-school-cancel");
    const schoolForm = document.getElementById("school-form");
    const schoolViewModal = document.getElementById("school-view-modal");
    const btnSchoolViewClose = document.getElementById("btn-school-view-close");
    const btnSchoolViewCancel = document.getElementById("btn-school-view-cancel");
    const btnSchoolViewEdit = document.getElementById("btn-school-view-edit");



    if (schoolSearch) {
        schoolSearch.addEventListener("input", (e) => {
            state.schoolQuery = e.target.value.toLowerCase();
            renderSchoolsList(); // This will be async, but input can be sync
        });
    }

    if (schoolRegionFilter) {
        schoolRegionFilter.addEventListener("change", (e) => {
            state.schoolRegion = e.target.value;
            renderSchoolsList();
        });
    }

    if (schoolAccountTypeFilter) {
        schoolAccountTypeFilter.addEventListener("change", (e) => {
            state.schoolAccountType = e.target.value;
            renderSchoolsList();
        });
    }

    if (btnAddSchool) btnAddSchool.addEventListener("click", () => openSchoolModal());
    if (btnSchoolClose) btnSchoolClose.addEventListener("click", closeSchoolModal);
    if (btnSchoolCancel) btnSchoolCancel.addEventListener("click", closeSchoolModal);
    if (btnSchoolViewClose) btnSchoolViewClose.addEventListener("click", closeSchoolViewModal);
    if (btnSchoolViewCancel) btnSchoolViewCancel.addEventListener("click", closeSchoolViewModal);

    function updateProductValueTotal() {
        let total = 0;
        const valueInputs = document.querySelectorAll('#school-products-checklist .product-value-input');
        valueInputs.forEach(input => {
            if (input.style.display !== 'none' && input.value) {
                total += parseInt(input.value, 10) || 0;
            }
        });
        const schoolValueInput = document.getElementById('school-value');
        if (schoolValueInput) schoolValueInput.value = total;
    }

    const TERRITORIES_DATA = {
        "North Luzon": [
            { name: "NCR East-Central & Rizal Territory", sub: ["Quezon City", "Marikina", "Rizal", "Manila", "San Juan", "Mandaluyong"] },
            { name: "NCR South / Metro Manila South Territory", sub: ["Pasig", "Makati", "Taguig", "Paranaque", "Alabang", "Muntinlupa", "Las Pinas", "Pasay"] },
            { name: "Cagayan Valley Territory", sub: ["Cagayan Valley"] }
        ],
        "South Luzon": [
            { name: "Bicol Territory", sub: ["Bicol"] }
        ],
        "Visayas": [
            { name: "North Cebu Territory", sub: ["North Cebu"] },
            { name: "South Cebu Territory", sub: ["South Cebu"] },
            { name: "Bohol & Negros Oriental Territory", sub: ["Bohol", "Negros Oriental"] },
            { name: "Eastern Visayas Territory", sub: ["Samar", "Leyte"] },
            { name: "Western Visayas-Negros Territory", sub: ["Iloilo", "Negros Occidental"] },
            { name: "Panay Island Territory", sub: ["Capiz", "Aklan", "Antique"] }
        ],
        "Mindanao": [
            { name: "Zamboanga Peninsula Territory", sub: ["Zamboanga", "Pagadian"] },
            { name: "Zamboanga del Norte & Misamis Occidental Territory", sub: ["Dipolog", "Ozamiz"] },
            { name: "Northern Mindanao Territory", sub: ["Iligan", "Misamis Oriental", "Bukidnon"] },
            { name: "Davao Region - South Territory", sub: ["South Davao"] },
            { name: "Davao Region - North Territory", sub: ["North Davao"] },
            { name: "SOCCSKSARGEN Territory", sub: ["SOCCSKSARGEN"] },
            { name: "Caraga Territory", sub: ["Caraga Region"] }
        ]
    };

    let contactCounter = 1;

    function addContactField(contactData = null) {
        const container = document.getElementById("dynamic-contacts-container");
        if (!container) return;

        const contactIndex = container.children.length + 2; // +2 because primary is #1

        const fieldset = document.createElement('div');
        fieldset.className = 'dynamic-contact-fieldset';
        fieldset.style.borderTop = '1px dashed var(--border-color)';
        fieldset.style.paddingTop = '16px';

        fieldset.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <label style="font-weight: 600; font-size: 13px; color: var(--text-secondary);">Contact #${contactIndex}</label>
                <button type="button" class="btn-remove-contact action-icon-btn delete" title="Remove Contact"><i class="fa-solid fa-trash-can"></i></button>
            </div>
            <div class="form-grid form-grid-3-col">
                <div class="form-group"><label>Full Name</label><input type="text" class="form-input dynamic-contact-name"></div>
                <div class="form-group"><label>Designation</label><input type="text" class="form-input dynamic-contact-designation"></div>
                <div class="form-group"><label>Role</label><input type="text" class="form-input dynamic-contact-role"></div>
            </div>
            <div class="form-grid form-grid-3-col">
                <div class="form-group"><label>Contact No.</label><input type="text" class="form-input dynamic-contact-phone"></div>
                <div class="form-group"><label>Email Address</label><input type="email" class="form-input dynamic-contact-email"></div>
                <div class="form-group"><label>Birthday</label><input type="date" class="form-input dynamic-contact-birthday"></div>
            </div>
        `;

        if (contactData) {
            fieldset.querySelector('.dynamic-contact-name').value = contactData.name || '';
            fieldset.querySelector('.dynamic-contact-designation').value = contactData.designation || '';
            fieldset.querySelector('.dynamic-contact-role').value = contactData.role || '';
            fieldset.querySelector('.dynamic-contact-phone').value = contactData.phone || '';
            fieldset.querySelector('.dynamic-contact-email').value = contactData.email || '';
            fieldset.querySelector('.dynamic-contact-birthday').value = contactData.birthday || '';
        }

        fieldset.querySelector('.btn-remove-contact').addEventListener('click', () => {
            fieldset.remove();
            // Re-number the remaining contacts
            const allContactSets = document.querySelectorAll('#dynamic-contacts-container .dynamic-contact-fieldset');
            allContactSets.forEach((set, index) => {
                const label = set.querySelector('label');
                if (label) {
                    label.textContent = `Contact #${index + 2}`;
                }
            });
        });

        container.appendChild(fieldset);
    }

    function openSchoolModal(schoolObj = null) {
        schoolModal.classList.add("active");
        contactCounter = 1;

        const { role } = getSessionContext();
        const ssGroup = document.getElementById("school-ss-group");
        const ssSelect = document.getElementById("school-ss");
        const canAssign = isApproverRole(role);

        if (canAssign) {
            ssGroup.style.display = "block";
            ssSelect.innerHTML = '<option value="">Unassigned</option>';

            // Populate with all SS users
            state.users.filter(u => isScopedSalesRole(u.role)).forEach(ss => {
                const opt = document.createElement("option");
                opt.value = ss.id;
                opt.textContent = `${ss.name} (${ss.territory || ss.region})`;
                ssSelect.appendChild(opt);
            });
        } else {
            ssGroup.style.display = "none";
        }

        const regionSelect = document.getElementById("school-region");
        const territorySelect = document.getElementById("school-territory");
        const subTerritorySelect = document.getElementById("school-sub-territory");

        function populateTerritories(region) {
            territorySelect.innerHTML = '<option value="">Select Territory</option>';
            subTerritorySelect.innerHTML = '<option value="">Select Sub-Territory</option>';
            const territories = TERRITORIES_DATA[region] || [];
            territories.forEach(terr => {
                const opt = document.createElement("option");
                opt.value = terr.name;
                opt.textContent = terr.name;
                territorySelect.appendChild(opt);
            });
        }

        const productsChecklist = document.getElementById("school-products-checklist");
        productsChecklist.innerHTML = "";
        state.products.forEach(product => {
            const itemContainer = document.createElement('div');
            itemContainer.className = 'form-grid form-grid-2-col';
            itemContainer.style.alignItems = 'center';
            itemContainer.style.gap = '8px';

            const checkboxHtml = `
                <label style="display: flex; align-items: center; gap: 6px; font-size: 13px;">
                    <input type="checkbox" name="school-product" value="${product.id}">
                    <span>${product.name}</span>
                </label>
            `;

            const inputHtml = `
                <input type="number" class="product-value-input form-input" data-product-id="${product.id}" style="display: none; font-size: 12px; padding: 8px 10px;" placeholder="Value (₱)">
            `;

            itemContainer.innerHTML = checkboxHtml + inputHtml;
            productsChecklist.appendChild(itemContainer);

            const checkbox = itemContainer.querySelector('input[type="checkbox"]');
            const valueInput = itemContainer.querySelector('.product-value-input');

            checkbox.addEventListener('change', () => {
                valueInput.style.display = checkbox.checked ? 'block' : 'none';
                if (!checkbox.checked) valueInput.value = '';
                updateProductValueTotal();
            });

            valueInput.addEventListener('input', updateProductValueTotal);
        });

        const healthSelect = document.getElementById("school-health");
        healthSelect.innerHTML = "";
        pipelineStages.main.forEach(stage => {
            const opt = document.createElement("option");
            opt.value = stage;
            opt.textContent = stage;
            healthSelect.appendChild(opt);
        });

        function populateSubTerritories(region, territoryName) {
            subTerritorySelect.innerHTML = '<option value="">Select Sub-Territory</option>';
            const territories = TERRITORIES_DATA[region] || [];
            const selectedTerritory = territories.find(t => t.name === territoryName);
            if (selectedTerritory) {
                selectedTerritory.sub.forEach(sub => {
                    const opt = document.createElement("option");
                    opt.value = sub;
                    opt.textContent = sub;
                    subTerritorySelect.appendChild(opt);
                });
            }
        }

        regionSelect.onchange = () => {
            populateTerritories(regionSelect.value);
        };

        territorySelect.onchange = () => {
            populateSubTerritories(regionSelect.value, territorySelect.value);
        };

        // Clear dynamic contacts and set up the add button listener
        const dynamicContactsContainer = document.getElementById("dynamic-contacts-container");
        dynamicContactsContainer.innerHTML = '';
        const addContactBtn = document.getElementById("btn-add-contact");

        // To avoid multiple listeners, clone the button to remove old ones.
        const newAddContactBtn = addContactBtn.cloneNode(true);
        addContactBtn.parentNode.replaceChild(newAddContactBtn, addContactBtn);
        newAddContactBtn.addEventListener('click', () => addContactField());


        if (schoolObj) {
            document.getElementById("school-modal-title").textContent = "Edit School Profile";
            document.getElementById("school-form-id").value = schoolObj.id;
            document.getElementById("school-name").value = schoolObj.name;
            if (canAssign) {
                ssSelect.value = schoolObj.assignedSS || "";
            }
            document.getElementById("school-short-name").value = schoolObj.shortName || '';
            document.getElementById("school-landline").value = schoolObj.landline || '';
            document.getElementById("school-account-type-select").value = schoolObj.accountType || 'Prospect Account';
            document.getElementById("school-address").value = schoolObj.address || '';
            document.getElementById("school-email").value = schoolObj.schoolEmail || '';
            document.getElementById("school-region").value = schoolObj.region;

            populateTerritories(schoolObj.region);
            let officialTerritoryName = schoolObj.officialTerritory;
            if (!officialTerritoryName) {
                const regionTerritories = TERRITORIES_DATA[schoolObj.region] || [];
                for (const terr of regionTerritories) {
                    if (terr.sub.includes(schoolObj.territory)) {
                        officialTerritoryName = terr.name;
                        break;
                    }
                }
            }

            if (officialTerritoryName) {
                territorySelect.value = officialTerritoryName;
                populateSubTerritories(schoolObj.region, officialTerritoryName);
                subTerritorySelect.value = schoolObj.territory;
            }

            document.getElementById("school-progress").value = schoolObj.accountProgress || 'GATHERING INFORMATION';
            document.getElementById("school-health").value = schoolObj.health || 'Prospect Account';

            // Populate General Information using loops
            const gi = schoolObj.genInfo || {};
            const levels = [
                'k1', 'k2', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6',
                'g7', 'g8', 'g9', 'g10', 'g11', 'g12'
            ];
            const fields = ['pop', 'fees', 'labs'];
            levels.forEach(level => {
                fields.forEach(field => {
                    const element = document.getElementById(`gen-info-${level}-${field}`);
                    if (element) element.value = gi[level]?.[field] || '';
                });
            });

            // Populate Learning Modalities using a loop
            const lm = schoolObj.learningModality || {};
            const modalities = ['dl-online-sync', 'dl-online-async', 'dl-offline-modular', 'bl-online', 'bl-modular', 'bl-lftf', 'dftf'];
            modalities.forEach(modality => {
                const element = document.getElementById(`modality-${modality}`);
                if (element) element.checked = lm[modality] || false;
            });

            // Populate all contact fields
            const schoolContacts = schoolObj.contacts || [];
            const primaryContact = schoolContacts[0] || {};
            document.getElementById("contact-primary-name").value = primaryContact.name || '';
            document.getElementById("contact-primary-designation").value = primaryContact.designation || '';
            document.getElementById("contact-primary-role").value = primaryContact.role || '';
            document.getElementById("contact-primary-phone").value = primaryContact.phone || '';
            document.getElementById("contact-primary-email").value = primaryContact.email || '';
            document.getElementById("contact-primary-birthday").value = primaryContact.birthday || '';

            // Populate dynamic contacts
            if (schoolContacts.length > 1) {
                schoolContacts.slice(1).forEach(contact => addContactField(contact));
            }

            document.getElementById("school-competitors").value = (schoolObj.competitors || []).join(', ');

            if (schoolObj.currentProducts && Array.isArray(schoolObj.currentProducts)) {
                schoolObj.currentProducts.forEach(productInfo => {
                    const checkbox = productsChecklist.querySelector(`input[value="${productInfo.id}"]`);
                    if (checkbox) checkbox.checked = true;
                    const valueInput = productsChecklist.querySelector(`.product-value-input[data-product-id="${productInfo.id}"]`);
                    if (valueInput) {
                        valueInput.style.display = 'block';
                        valueInput.value = productInfo.value;
                    }
                });
            }
            updateProductValueTotal();
        } else {
            document.getElementById("school-modal-title").textContent = "Register School Profile";
            schoolForm.reset();
            document.getElementById("school-form-id").value = "";
            document.getElementById("school-health").value = 'Prospect Account';
            if (canAssign) {
                ssSelect.value = "";
            }
            populateTerritories(regionSelect.value);
            updateProductValueTotal();
        }
    }

    function closeSchoolModal() { schoolModal.classList.remove("active"); }

    function closeSchoolViewModal() { schoolViewModal?.classList.remove("active"); }

    function openSchoolViewModal(schoolObj) {
        if (!schoolObj || !schoolViewModal) return;
        schoolViewModal.classList.add("active");

        const content = document.getElementById("school-view-content");
        document.getElementById("school-view-title").textContent = schoolObj.name;
        document.getElementById("school-view-subtitle").textContent = schoolObj.address || "School Profile Details";

        const ssUser = state.users.find(u => u.id === schoolObj.assignedSS) || { name: "Unassigned" };

        const renderItem = (label, value, isCurrency = false) => {
            let displayValue = value;
            if (!displayValue || (displayValue === '0' && !isCurrency)) {
                displayValue = '<span style="color: var(--text-muted);">-</span>';
            } else if (isCurrency) {
                displayValue = `₱${parseInt(value || 0).toLocaleString()}`;
            }
            return `
                <div class="school-view-item">
                    <label>${label}</label>
                    <span>${displayValue}</span>
                </div>
            `;
        };

        const renderBadgeItem = (label, value, badgeClass) => {
            const displayValue = `<span class="badge ${badgeClass}">${value}</span>`;
            return `
                <div class="school-view-item">
                    <label>${label}</label>
                    <span>${displayValue}</span>
                </div>
            `;
        };

        const gi = schoolObj.genInfo || {};
        const lm = schoolObj.learningModality || {};
        const learningModalities = Object.entries(lm)
            .filter(([, checked]) => checked)
            .map(([key]) => {
                const map = {
                    'dl-online-sync': 'DL Online Sync', 'dl-online-async': 'DL Online Async', 'dl-offline-modular': 'DL Offline Modular',
                    'bl-online': 'Blended Online', 'bl-modular': 'Blended Modular', 'bl-lftf': 'Blended Limited F2F', 'dftf': 'Daily F2F'
                };
                return map[key] || key;
            });

        const productNames = (schoolObj.currentProducts || [])
            .map(pInfo => {
                const product = state.products.find(p => p.id === pInfo.id);
                return product ? product.name : pInfo.id;
            })
            .join(', ');

        const schoolContacts = schoolObj.contacts || [];
        let contactsHtml = `
            <div class="school-view-section">
                <div class="school-view-section-title">Customer Contacts</div>
        `;

        if (schoolContacts.length > 0) {
            contactsHtml += schoolContacts.map((contact, index) => `
                <div class="school-view-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); ${index > 0 ? 'border-top: 1px solid var(--border-color); padding-top: 16px; margin-top: 16px;' : ''}">
                    ${renderItem("Full Name", contact.name)}
                    ${renderItem("Designation", contact.designation)}
                    ${renderItem("Role", contact.role)}
                    ${renderItem("Contact No.", contact.phone)}
                    ${renderItem("Email", contact.email)}
                    ${renderItem("Birthday", contact.birthday)}
                </div>
            `).join('');
        } else {
            contactsHtml += `<p style="font-size: 13px; color: var(--text-muted);">No contacts registered for this school.</p>`;
        }
        contactsHtml += `</div>`;


        const health = schoolObj.health || 'Stable';
        const healthClass = getHealthBadgeClass(health);

        content.innerHTML = `
            <div class="school-view-section">
                <div class="school-view-section-title">Account Plan</div>
                <div class="school-view-grid" style="grid-template-columns: 2fr 1fr 1fr;">
                    ${renderItem("Assigned SS", ssUser.name)}
                    ${renderItem("Account Type", schoolObj.accountType)}
                    ${renderBadgeItem("Account Health", health, healthClass)}
                </div>
                <div class="school-view-grid" style="grid-template-columns: 1fr 1fr 1fr;">
                    ${renderItem("Short Name", schoolObj.shortName)}
                    ${renderItem("Landline No.", schoolObj.landline)}
                    ${renderItem("School Email", schoolObj.schoolEmail)}
                </div>
                <div class="school-view-grid">
                    ${renderItem("Region", schoolObj.region)}
                    ${renderItem("Territory", schoolObj.territory)}
                </div>
            </div>
    
            <div class="school-view-section">
                <div class="school-view-section-title">General Information</div>
                <div class="school-view-grid">
                    ${renderItem("Account Progress", schoolObj.accountProgress)}
                    ${renderItem("Learning Modalities", learningModalities.length > 0 ? learningModalities.join(', ') : '-')}
                </div>
            </div>
    
            ${contactsHtml}

            <div class="school-view-section">
                <div class="school-view-section-title">Business Goal</div>
                <div class="school-view-grid">
                    ${renderItem("Total Business Value", schoolObj.annualValue, true)}
                    ${renderItem("Current Products", productNames)}
                    ${renderItem("Competitors", (schoolObj.competitors || []).join(', '))}
                </div>
            </div>
        `;

        if (btnSchoolViewEdit) {
            btnSchoolViewEdit.onclick = () => {
                closeSchoolViewModal();
                openSchoolModal(schoolObj);
            };
        }
    }

    schoolForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const id = document.getElementById("school-form-id").value;
        const { role, user } = getSessionContext();

        let assignedSS;
        const canAssign = isApproverRole(role);

        if (canAssign) {
            assignedSS = document.getElementById("school-ss").value;
        } else {
            if (!id) { // New school by SS
                assignedSS = user.id;
            } else { // Editing existing school by SS
                const existingSchool = state.schools.find(s => s.id === id);
                assignedSS = existingSchool ? existingSchool.assignedSS : user.id;
            }
        }

        const name = document.getElementById("school-name").value;
        const shortName = document.getElementById("school-short-name").value;
        const landline = document.getElementById("school-landline").value;
        const accountType = document.getElementById("school-account-type-select").value;
        const address = document.getElementById("school-address").value;
        const schoolEmail = document.getElementById("school-email").value;
        const region = document.getElementById("school-region").value;
        const officialTerritory = document.getElementById("school-territory").value;
        const territory = document.getElementById("school-sub-territory").value;
        const accountProgress = document.getElementById("school-progress").value;
        const annualValue = parseInt(document.getElementById('school-value').value) || 0;
        const competitors = document.getElementById("school-competitors").value.split(',').map(c => c.trim()).filter(Boolean);
        const health = document.getElementById("school-health").value;
        const currentProducts = [];
        const productCheckboxes = document.querySelectorAll('#school-products-checklist input[name="school-product"]:checked');
        productCheckboxes.forEach(cb => {
            const productId = cb.value;
            const valueInput = document.querySelector(`#school-products-checklist .product-value-input[data-product-id="${productId}"]`);
            const productValue = parseInt(valueInput.value, 10) || 0;
            if (productValue > 0) {
                currentProducts.push({ id: productId, value: productValue });
            }
        });

        const getVal = (elId) => parseInt(document.getElementById(elId).value) || 0;
        const genInfo = {};
        const levels = [
            'k1', 'k2', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6',
            'g7', 'g8', 'g9', 'g10', 'g11', 'g12'
        ];
        const fields = ['pop', 'fees', 'labs'];
        levels.forEach(level => {
            genInfo[level] = {};
            fields.forEach(field => {
                const input = document.getElementById(`gen-info-${level}-${field}`);
                if (input) genInfo[level][field] = parseInt(input.value) || 0;
            });
        });

        const learningModality = {
            'dl-online-sync': document.getElementById('modality-dl-online-sync').checked,
            'dl-online-async': document.getElementById('modality-dl-online-async').checked,
            'dl-offline-modular': document.getElementById('modality-dl-offline-modular').checked,
            'bl-online': document.getElementById('modality-bl-online').checked,
            'bl-modular': document.getElementById('modality-bl-modular').checked,
            'bl-lftf': document.getElementById('modality-bl-lftf').checked,
            'dftf': document.getElementById('modality-dftf').checked,
        };

        const contacts = [];
        const primaryName = document.getElementById('contact-primary-name').value.trim();
        if (primaryName) {
            contacts.push({
                name: primaryName,
                designation: document.getElementById('contact-primary-designation').value,
                role: document.getElementById('contact-primary-role').value,
                phone: document.getElementById('contact-primary-phone').value,
                email: document.getElementById('contact-primary-email').value,
                birthday: document.getElementById('contact-primary-birthday').value,
            });
        }

        document.querySelectorAll('.dynamic-contact-fieldset').forEach(fieldset => {
            const name = fieldset.querySelector('.dynamic-contact-name').value.trim();
            if (name) {
                contacts.push({
                    name: name,
                    designation: fieldset.querySelector('.dynamic-contact-designation').value,
                    role: fieldset.querySelector('.dynamic-contact-role').value,
                    phone: fieldset.querySelector('.dynamic-contact-phone').value,
                    email: fieldset.querySelector('.dynamic-contact-email').value,
                    birthday: fieldset.querySelector('.dynamic-contact-birthday').value,
                });
            }
        });

        const schools = await window.EduLearnDB.getSchools();
        const totalEnrollment = Object.values(genInfo).reduce((sum, level) => sum + (level.pop || 0), 0);

        let status;
        if (['Prospect Account', 'Pipeline Account'].includes(accountType)) {
            status = 'New';
        } else if (accountType === 'At-Risk Account') {
            status = 'At Risk';
        } else if (accountType === 'Lost Account') {
            status = 'Lost';
        } else if (accountType === 'Reactivated Account') {
            status = 'Renewal';
        } else {
            status = 'Existing';
        }

        const schoolData = {
            name, assignedSS, shortName, landline, accountType, address, schoolEmail, region, territory, officialTerritory, accountProgress, annualValue, competitors, genInfo, learningModality, contacts, health, currentProducts,
            code: shortName,
            status: status,
            estimatedEnrollment: totalEnrollment,
        };

        if (id) {
            const index = schools.findIndex(s => s.id === id);
            if (index !== -1) {
                const oldAnnualValue = schools[index].annualValue;

                schools[index] = {
                    ...schools[index], // Preserve fields not in the form
                    ...schoolData
                };
                await window.EduLearnDB.saveSchools(schools);
                showToast("Roster Sync", `Updated school file for ${name} successfully.`, "success");

                // Sync deal stage with the new progress from the form
                const deals = await window.EduLearnDB.getDeals();
                const dealToUpdate = deals.find(d => d.schoolId === id && !d.stage.toLowerCase().includes('lost'));
                if (dealToUpdate && dealToUpdate.stage !== health) {
                    dealToUpdate.stage = health;
                    await window.EduLearnDB.saveDeals(deals);
                    showToast("Progress Synced", `Deal progress updated to '${health}'.`, "info");
                }

                // Automatically sync the deal value if the school's annual value changes.
                if (annualValue !== oldAnnualValue) {
                    const deals = await window.EduLearnDB.getDeals();
                    // Find an open deal in the acquisition or renewal pipeline to update.
                    const dealToUpdate = deals.find(d =>
                        d.schoolId === id &&
                        (d.pipeline === 'acquisition' || d.pipeline === 'renewal') &&
                        !d.stage.toLowerCase().includes('won') &&
                        !d.stage.toLowerCase().includes('lost') &&
                        !d.stage.toLowerCase().includes('completed')
                    );

                    if (dealToUpdate) {
                        // To avoid overwriting manually adjusted deals, only sync if the old deal value matched the old school value.
                        if (dealToUpdate.grossValue === oldAnnualValue) {
                            dealToUpdate.grossValue = annualValue;
                            dealToUpdate.netValue = annualValue; // Keep it simple: net value syncs to gross value.
                            dealToUpdate.markup = 0;
                            dealToUpdate.remainingBalance = annualValue - (dealToUpdate.amountCollected || 0);
                            await window.EduLearnDB.saveDeals(deals);
                            showToast("Deal Synced", `Deal ${dealToUpdate.id} value updated to ₱${annualValue.toLocaleString()}.`, "success");
                        } else {
                            showToast("Sync Skipped", `Deal ${dealToUpdate.id} has a custom value and was not auto-synced.`, "info");
                        }
                    }
                }
            }
        } else {
            const nextId = `SCH-${Math.floor(Math.random() * 900) + 100}`;

            let approvalStatus = 'Approved';
            let toastTitle = "School Enrolled";
            let toastMessage = `Registered ${name} under ID ${nextId}.`;

            if (isScopedSalesRole(role)) {
                approvalStatus = 'Pending';
                toastTitle = "School Submitted";
                toastMessage = `Registration for ${name} is now pending approval.`;
            }

            schools.push({
                id: nextId,
                ...schoolData,
                approvalStatus,
                type: "Private",
                yearCovered: "SY 2026-2027",
                lastVisit: "", nextVisit: "", collectionStatus: "Billing Pending",
                serviceStatus: "Resolved", remarks: ""
            });
            await window.EduLearnDB.saveSchools(schools);
            showToast(toastTitle, toastMessage, "success");

            // If an annual value is provided, automatically create a corresponding deal in the acquisition pipeline.
            if (annualValue > 0) {
                const deals = await window.EduLearnDB.getDeals();
                const nextDealId = `DEL-${Math.floor(Math.random() * 900) + 100}`;

                const productNames = currentProducts.map(pInfo => {
                    const product = state.products.find(p => p.id === pInfo.id);
                    return product ? product.name : 'Unknown Product';
                });

                const newDealStage = health;

                deals.push({
                    id: nextDealId,
                    schoolId: nextId,
                    schoolName: name,
                    pipeline: 'main',
                    stage: newDealStage,
                    yearCovered: "SY 2026-2027",
                    products: productNames.length > 0 ? productNames : ["LMS"], // Default to LMS if no products selected
                    grossValue: annualValue,
                    netValue: annualValue, // Default net value to gross value initially
                    markup: 0,
                    baseValue: annualValue,
                    students: totalEnrollment,
                    proposalDate: new Date().toISOString().split('T')[0],
                    expectedClose: new Date().toISOString().split('T')[0],
                    contractStatus: "Draft", poStatus: "Pending", billingStatus: "Pending",
                    collectionPercent: 0, amountCollected: 0, remainingBalance: annualValue,
                    commissionEligible: "No", deliveryStatus: "Pending", mgrApproval: "No",
                    pricingExceptionApprovedBy: "", remarks: "Auto-generated deal from new school registration.",
                    assignedSS: assignedSS,
                    returns: 0,
                    siDeliveredValue: 0
                });
                await window.EduLearnDB.saveDeals(deals);
                showToast("Deal Auto-Created", `New deal ${nextDealId} added to Progress Report.`, "success");

                // Find the school just added and update its health to match the new deal's stage
                const schoolIndex = schools.findIndex(s => s.id === nextId);
                if (schoolIndex !== -1) {
                    schools[schoolIndex].health = newDealStage;
                    await window.EduLearnDB.saveSchools(schools); // Save the updated schools array
                }
            }
        }

        closeSchoolModal();
        await refreshActiveView();
    });

    function getHealthBadgeClass(health) {
        const healthLower = (health || 'stable').toLowerCase();
        const badgeMap = [
            { keywords: ['risk', 'lost', 'dormant'], className: 'badge-absent' },
            { keywords: ['won', 'signed', 'active', 'completed', 'onboarding', 'issued'], className: 'badge-present' },
            { keywords: ['renewal', 'reactivated', 'negotiation'], className: 'badge-late' }
        ];
    
        for (const entry of badgeMap) {
            if (entry.keywords.some(kw => healthLower.includes(kw))) {
                return entry.className;
            }
        }
        // Default for stages like 'Prospect', 'Qualified', 'Proposal'
        return 'badge-info';
    }

    async function renderSchoolsList() {
        await refreshData();
        const tableBody = document.getElementById("school-table-body");
        if (!tableBody) return;

        // Filter schools based on role scope
        const visibleSchools = filterByRoleVisibility(state.schools, "assignedSS");

        const filtered = visibleSchools.filter(school => {
            const queryMatch = school.name.toLowerCase().includes(state.schoolQuery) ||
                (school.shortName || school.code || '').toLowerCase().includes(state.schoolQuery) ||
                school.territory.toLowerCase().includes(state.schoolQuery);
            const regionMatch = state.schoolRegion === "all" || school.region === state.schoolRegion;
            const accountTypeMatch = state.schoolAccountType === "all" || school.accountType === state.schoolAccountType;

            return queryMatch && regionMatch && accountTypeMatch;
        });

        tableBody.innerHTML = "";

        if (filtered.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 40px;">
                        <i class="fa-solid fa-school" style="font-size: 32px; margin-bottom: 12px;"></i>
                        <p>No schools registered match the filters.</p>
                    </td>
                </tr>
            `;
            return;
        }

        filtered.forEach(school => {
            const ssUser = state.users.find(u => u.id === school.assignedSS) || { name: "Unassigned" };
            const rmUser = state.users.find(u => u.role === 'Regional Manager' && u.region === school.region) || { name: "Unassigned" };
            const tr = document.createElement("tr");
            tr.setAttribute('data-id', school.id);
            tr.classList.add('clickable-row');

            const healthClass = getHealthBadgeClass(school.health);

            const productNames = (school.currentProducts || []).map(pInfo => {
                const product = state.products.find(p => p.id === pInfo.id);
                return product ? product.name : pInfo.id;
            }).join(', ');

            const { role } = getSessionContext();
            const isApprover = isApproverRole(role);
            const isPending = school.approvalStatus === 'Pending';

            let actionButtonsHTML = `
                <div class="actions-cell">
                    <button class="action-icon-btn edit-school-btn" data-id="${school.id}" title="Edit School Details">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button class="action-icon-btn delete-school-btn" data-id="${school.id}" title="Remove School">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;
            let statusCellHTML = `<span class="badge ${school.status === 'Lost' ? 'badge-absent' : 'badge-info'}">${school.status}</span>`;

            if (isPending) {
                statusCellHTML = `<span class="badge badge-late">Pending Approval</span>`;
                if (isApprover) {
                    actionButtonsHTML = `
                        <div class="actions-cell" style="display: flex; gap: 4px;">
                            <button class="action-icon-btn edit-school-btn" data-id="${school.id}" title="Edit & Review"><i class="fa-solid fa-pen-to-square"></i></button>
                            <button class="action-icon-btn approve-school-btn" data-id="${school.id}" title="Approve School"><i class="fa-solid fa-check-circle" style="color: var(--success);"></i></button>
                            <button class="action-icon-btn reject-school-btn" data-id="${school.id}" title="Reject School"><i class="fa-solid fa-times-circle" style="color: var(--danger);"></i></button>
                        </div>
                    `;
                } else {
                    // For the SS who submitted it, or other non-approvers
                    actionButtonsHTML = `<div class="actions-cell"><span style="font-size: 11px; color: var(--text-muted);">Reviewing</span></div>`;
                }
            }

            tr.innerHTML = `
                <td>
                    <div style="font-weight: 600; color: var(--text-primary);">${school.name}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${school.address || 'No address'}</div>
                </td>
                <td style="font-family: monospace; font-weight: 700; color: var(--text-secondary);">${school.shortName || school.code || '-'}</td>
                <td>
                    <div>${school.region}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">${school.territory}</div>
                </td>
                <td>
                    <div style="font-weight: 500;">${ssUser.name}</div>
                    <div style="font-size: 11px; color: var(--text-muted);">RM: ${rmUser.name}</div>
                </td>
                <td>${productNames || '-'}</td>
                <td style="font-weight: 700; color: var(--primary-light);">₱${school.annualValue.toLocaleString()}</td>
                <td><span class="badge ${healthClass}">${school.health || 'Stable'}</span></td>
                <td>${statusCellHTML}</td>
                <td>${actionButtonsHTML}</td>
            `;
            tableBody.appendChild(tr);
        });

        // Add click listener for viewing school details
        tableBody.querySelectorAll(".clickable-row").forEach(row => {
            row.addEventListener("click", (e) => {
                if (e.target.closest('.actions-cell')) {
                    return;
                }
                const id = row.getAttribute("data-id");
                const schoolObj = state.schools.find(s => s.id === id);
                if (schoolObj) openSchoolViewModal(schoolObj);
            });
        });

        tableBody.querySelectorAll(".edit-school-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-id");
                const schoolObj = state.schools.find(s => s.id === id);
                openSchoolModal(schoolObj);
            });
        });

        tableBody.querySelectorAll(".delete-school-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                const schoolObj = state.schools.find(s => s.id === id);
                if (!schoolObj) return;
                const confirmed = confirm(`Remove ${schoolObj.name} from the schools database?`);
                if (!confirmed) return;
                let schools = await window.EduLearnDB.getSchools();
                schools = schools.filter(s => s.id !== id);
                await window.EduLearnDB.saveSchools(schools);
                showToast("School Removed", `${schoolObj.name} has been removed.`, "danger");
                await refreshActiveView();
            });
        });

        tableBody.querySelectorAll(".approve-school-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                const schools = await window.EduLearnDB.getSchools();
                const school = schools.find(s => s.id === id);
                if (school) {
                    school.approvalStatus = 'Approved';

                    // If the status was 'New' (from a Prospect/Pipeline account type),
                    // update it to 'Existing' upon approval.
                    if (school.status === 'New') {
                        school.status = 'Existing';
                    }

                    await window.EduLearnDB.saveSchools(schools);
                    showToast("School Approved", `${school.name} is now active in the database.`, "success");
                    await refreshActiveView();
                }
            });
        });

        tableBody.querySelectorAll(".reject-school-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-id");
                const school = state.schools.find(s => s.id === id);
                if (school && confirm(`Are you sure you want to reject and delete the submission for ${school.name}?`)) {
                    let schools = (await window.EduLearnDB.getSchools()).filter(s => s.id !== id);
                    await window.EduLearnDB.saveSchools(schools);
                    showToast("Submission Rejected", `The school registration for ${school.name} has been deleted.`, "danger");
                    await refreshActiveView();
                }
            });
        });
    }

    // ================= TAB: CONTACTS DIRECTORY & TASK BOARD =================

    const taskSearchInput = document.getElementById("task-search");
    const activitySearchInput = document.getElementById("activity-search");
    const activityEmployeeFilter = document.getElementById("activity-employee-filter");
    const activityStartDateInput = document.getElementById("activity-start-date");
    const activityEndDateInput = document.getElementById("activity-end-date");
    const btnAddTaskPage = document.getElementById("btn-add-task");
    const taskModal = document.getElementById("task-modal");

    if (taskSearchInput) {
        taskSearchInput.addEventListener("input", (e) => {
            state.taskQuery = e.target.value.toLowerCase();
            renderTasksList();
        });
    }

    if (activitySearchInput) {
        activitySearchInput.addEventListener("input", (e) => {
            state.activityQuery = e.target.value.toLowerCase();
            renderActivitiesList();
        });
    }

    if (activityEmployeeFilter) {
        activityEmployeeFilter.addEventListener("change", (e) => {
            state.activityEmployee = e.target.value;
            renderActivitiesList();
        });
    }

    if (activityStartDateInput) {
        activityStartDateInput.addEventListener("change", (e) => {
            state.activityStartDate = e.target.value;
            renderActivitiesList();
        });
    }

    if (activityEndDateInput) {
        activityEndDateInput.addEventListener("change", (e) => {
            state.activityEndDate = e.target.value;
            renderActivitiesList();
        });
    }

    const btnTaskClose = document.getElementById("btn-task-close");
    const btnTaskCancel = document.getElementById("btn-task-cancel");
    const taskForm = document.getElementById("task-form");

    if (btnAddTaskPage) {
        btnAddTaskPage.addEventListener("click", () => openTaskModal());
    }
    if (btnTaskClose) btnTaskClose.addEventListener("click", closeTaskModal);
    if (btnTaskCancel) btnTaskCancel.addEventListener("click", closeTaskModal);

    function filterTasksByRoleVisibility(dataset) {
        const safeDataset = Array.isArray(dataset) ? dataset : [];
        if (!state.session) return safeDataset;

        const { role, user } = getSessionContext();
        if (isGlobalVisibilityRole(role)) {
            return safeDataset;
        }

        return safeDataset.filter(task => {
            const school = state.schools.find(s => s.id === task.relatedSchoolId);
            if (role === "Regional Manager") {
                return school && school.region === user.region;
            }

            if (role === "District Manager") {
                const ssList = user.ssIds || [];
                return task.assignedTo === user.id || (school && (school.assignedDM === user.id || ssList.includes(school.assignedSS) || school.assignedSS === user.id));
            }

            if (isScopedSalesRole(role)) {
                // An SS can only see tasks explicitly assigned to them.
                return task.assignedTo === user.id;
            }

            if (["Finance / Collections", "Training / Fulfillment"].includes(role)) {
                return task.assignedTo === user.id;
            }

            return false;
        });
    }

    function getScopedTaskSchools() {
        const { role, user } = getSessionContext();
        if (isGlobalVisibilityRole(role) || ["President / CEO", "VP for Sales and Marketing", "System Administrator"].includes(role)) {
            return state.schools;
        }

        if (role === "Regional Manager") {
            return state.schools.filter(school => school.region === user.region);
        }

        if (role === "District Manager") {
            const ssList = user.ssIds || [];
            return state.schools.filter(school => school.assignedDM === user.id || ssList.includes(school.assignedSS));
        }

        if (isScopedSalesRole(role)) {
            return state.schools.filter(school => school.assignedSS === user.id);
        }

        return [];
    }

    function getScopedTaskAssignees() {
        const { role, user } = getSessionContext();
        if (isGlobalVisibilityRole(role) || ["President / CEO", "VP for Sales and Marketing", "System Administrator"].includes(role)) {
            return state.users;
        }

        if (role === "Regional Manager") {
            return state.users.filter(userEntry => {
                if (userEntry.id === user.id) return true;
                return userEntry.role === "Solution Specialist" && userEntry.region === user.region;
            });
        }

        if (role === "District Manager") {
            const ssList = user.ssIds || [];
            return state.users.filter(userEntry => {
                if (userEntry.id === user.id) return true;
                return ssList.includes(userEntry.id);
            });
        }

        if (isScopedSalesRole(role)) {
            return state.users.filter(userEntry => userEntry.id === user.id);
        }

        return [];
    }

    async function renderTasksList() {
        await refreshData();
        const tableBody = document.getElementById("task-table-body");
        if (!tableBody) return;

        const visibleTasks = filterTasksByRoleVisibility(state.tasks);
        const filtered = visibleTasks.filter(task => {
            const school = state.schools.find(s => s.id === task.relatedSchoolId) || {};
            const assignee = state.users.find(u => u.id === task.assignedTo) || {};
            const query = state.taskQuery;
            return [task.title, task.category, task.status, task.priority, assignee.name, school.name]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(query);
        });

        tableBody.innerHTML = "";
        if (filtered.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 40px;">
                        <i class="fa-solid fa-list-check" style="font-size: 32px; margin-bottom: 12px;"></i>
                        <p>No tasks found matching the filters.</p>
                    </td>
                </tr>
            `;
            return;
        }

        filtered.forEach(task => {
            const school = state.schools.find(s => s.id === task.relatedSchoolId) || { name: "Unknown School" };
            const assignee = state.users.find(u => u.id === task.assignedTo) || { name: "Unassigned" };
            const tr = document.createElement("tr");
            const completionStatus = task.completionStatus || "Pending";
            const completionBadgeClass = completionStatus === "Completed" ? "badge-present" : "badge-warning";
            const completionLabel = completionStatus === "Completed" ? "Completed" : "Pending";
            tr.innerHTML = `
                <td>${task.title}</td>
                <td>${task.category}</td>
                <td>${assignee.name}</td>
                <td>${school.name}</td>
                <td>${task.dueDate}</td>
                <td><span class="badge badge-info">${task.status}</span></td>
                <td><span class="badge ${completionBadgeClass} task-complete-toggle" data-id="${task.id}" title="${completionLabel} for leadership visibility">${completionLabel}</span></td>
                <td><span class="badge badge-present">${task.priority}</span></td>
                <td>
                    <div class="actions-cell">
                        <button class="action-icon-btn edit-task-btn" data-id="${task.id}" title="Edit task">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button class="action-icon-btn delete-task-btn" data-id="${task.id}" title="Remove task">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </td>
            `;
            tableBody.appendChild(tr);
        });

        tableBody.querySelectorAll(".task-complete-toggle").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                const tasks = await window.EduLearnDB.getTasks();
                const task = tasks.find(t => t.id === id);
                if (!task) return;
                task.completionStatus = task.completionStatus === "Completed" ? "Pending" : "Completed";
                await window.EduLearnDB.saveTasks(tasks);
                showToast(task.completionStatus === "Completed" ? "Task Marked Complete" : "Task Reopened", `Leadership now sees this task as ${task.completionStatus.toLowerCase()}.`, task.completionStatus === "Completed" ? "success" : "warning");
                await refreshActiveView();
            });
        });

        tableBody.querySelectorAll(".edit-task-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-id");
                const taskObj = state.tasks.find(t => t.id === id);
                openTaskModal(taskObj);
            });
        });

        tableBody.querySelectorAll(".delete-task-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                if (confirm("Delete this task from the board?")) {
                    const tasks = (await window.EduLearnDB.getTasks()).filter(t => t.id !== id);
                    await window.EduLearnDB.saveTasks(tasks);
                    showToast("Task Removed", "The task has been deleted.", "danger");
                    await refreshActiveView();
                }
            });
        });
    }

    function openTaskModal(taskObj = null) {
        if (!taskModal) return;
        taskModal.classList.add("active");

        const schoolSelect = document.getElementById("task-school");
        const assigneeSelect = document.getElementById("task-assigned-to");
        const dealSelect = document.getElementById("task-related-deal");

        const scopedSchools = getScopedTaskSchools();
        const scopedAssignees = getScopedTaskAssignees();

        // Populate schools
        schoolSelect.innerHTML = "";
        scopedSchools.forEach(school => {
            const opt = document.createElement("option");
            opt.value = school.id;
            opt.textContent = `${school.name} (${school.region})`;
            schoolSelect.appendChild(opt);
        });

        // Populate assignees
        assigneeSelect.innerHTML = "";
        scopedAssignees.forEach(user => {
            const opt = document.createElement("option");
            opt.value = user.id;
            opt.textContent = `${user.name} — ${user.role}`;
            assigneeSelect.appendChild(opt);
        });

        // Function to update deals based on selected school
        const updateRelatedDeals = (selectedSchoolId) => {
            const currentDealValue = dealSelect.value;
            dealSelect.innerHTML = "<option value=\"\">None</option>";
            const relatedDeals = state.deals.filter(d => d.schoolId === selectedSchoolId);

            relatedDeals.forEach(deal => {
                const opt = document.createElement("option");
                opt.value = deal.id;
                opt.textContent = `${deal.id} • ${deal.schoolName}`;
                dealSelect.appendChild(opt);
            });

            // Restore selection if it exists in the new list
            if (relatedDeals.find(d => d.id === currentDealValue)) {
                dealSelect.value = currentDealValue;
            }
        };

        schoolSelect.onchange = () => updateRelatedDeals(schoolSelect.value);

        if (taskObj) {
            document.getElementById("task-modal-title").textContent = "Edit Task";
            document.getElementById("task-form-id").value = taskObj.id;
            document.getElementById("task-title").value = taskObj.title;
            document.getElementById("task-category").value = taskObj.category;
            if ([...assigneeSelect.options].some(option => option.value === taskObj.assignedTo)) {
                assigneeSelect.value = taskObj.assignedTo;
            } else if (assigneeSelect.options.length > 0) {
                assigneeSelect.value = assigneeSelect.options[0].value;
            }
            if ([...schoolSelect.options].some(option => option.value === taskObj.relatedSchoolId)) {
                schoolSelect.value = taskObj.relatedSchoolId;
            } else if (schoolSelect.options.length > 0) {
                schoolSelect.value = schoolSelect.options[0].value;
            }
            document.getElementById("task-due-date").value = taskObj.dueDate;
            document.getElementById("task-status").value = taskObj.status;
            document.getElementById("task-priority").value = taskObj.priority;
            document.getElementById("task-completion-status").value = taskObj.completionStatus || "Pending";
            document.getElementById("task-description").value = taskObj.description || "";

            // Populate deals for the task's school and set the value
            updateRelatedDeals(schoolSelect.value);
            dealSelect.value = taskObj.relatedDealId || "";
        } else {
            document.getElementById("task-modal-title").textContent = "Create New Task";
            taskForm.reset();
            document.getElementById("task-form-id").value = "";
            document.getElementById("task-completion-status").value = "Pending";
            document.getElementById("task-due-date").value = new Date().toISOString().split('T')[0];
            if (assigneeSelect.options.length > 0) {
                assigneeSelect.value = assigneeSelect.options[0].value;
            }
            if (schoolSelect.options.length > 0) {
                schoolSelect.value = schoolSelect.options[0].value;
            }
            // Populate deals for the default selected school
            if (schoolSelect.value) {
                updateRelatedDeals(schoolSelect.value);
            }
        }
    }

    function closeTaskModal() {
        taskModal?.classList.remove("active");
    }

    taskForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = document.getElementById("task-form-id").value;
        const title = document.getElementById("task-title").value.trim();
        const category = document.getElementById("task-category").value;
        const assignedTo = document.getElementById("task-assigned-to").value;
        const relatedSchoolId = document.getElementById("task-school").value;
        const relatedDealId = document.getElementById("task-related-deal").value;
        const dueDate = document.getElementById("task-due-date").value;
        const status = document.getElementById("task-status").value;
        const priority = document.getElementById("task-priority").value;
        const completionStatus = document.getElementById("task-completion-status").value;
        const description = document.getElementById("task-description").value.trim();

        const tasks = await window.EduLearnDB.getTasks();
        if (id) {
            const index = tasks.findIndex(t => t.id === id);
            if (index !== -1) {
                tasks[index] = { ...tasks[index], title, category, assignedTo, relatedSchoolId, relatedDealId, dueDate, status, priority, completionStatus, description };
                await window.EduLearnDB.saveTasks(tasks);
                showToast("Task Updated", `Task ${title} has been updated.`, "success");
            }
        } else {
            const nextId = `TSK-${Math.floor(Math.random() * 900) + 100}`;
            tasks.push({ id: nextId, title, category, assignedTo, relatedSchoolId, relatedDealId, dueDate, status, priority, completionStatus, description });
            await window.EduLearnDB.saveTasks(tasks);
            showToast("Task Created", `Task ${title} has been created.`, "success");
        }

        closeTaskModal();
        await refreshActiveView();
    });

    // ================= TAB: KANBAN SALES PIPELINES =================

    const kanbanBoard = document.getElementById("kanban-board");
    const btnAddDeal = document.getElementById("btn-add-deal");

    // Dynamic definitions of column stages per pipeline
    const pipelineStages = {
        main: [
            "Unassigned / Market Lead",
            "Prospect Account",
            "Qualified Account",
            "Presentation Completed",
            "Proposal Submitted",
            "Negotiation / Approval",
            "Closed / Signed / PO Issued",
            "Onboarding / Fulfillment",
            "Active Account",
            "Renewal / Expansion",
            "At-Risk Account",
            "Dormant / Lost",
            "Reactivated Account"
        ]
    };

    if (btnAddDeal) {
        btnAddDeal.addEventListener("click", () => openDealModal());
    }

    async function renderKanban() {
        await refreshData();
        if (!kanbanBoard) return;

        kanbanBoard.innerHTML = "";

        // One-time migration of old deal stages to the new unified pipeline
        if (!localStorage.getItem('migrated_to_main_pipeline')) {
            const allDeals = await window.EduLearnDB.getDeals();
            const stageMap = {
                // acquisition
                "New Target": "Prospect Account", "Initial Contact": "Prospect Account", "School Visit Completed": "Qualified Account",
                "Needs Assessment Done": "Qualified Account", "Proposal Submitted": "Proposal Submitted", "Negotiation": "Negotiation / Approval",
                "PO Processing": "Closed / Signed / PO Issued", "Won – Billing": "Onboarding / Fulfillment", "Lost": "Dormant / Lost",
                // renewal
                "Existing Account Review": "Active Account", "Account Health Check": "Active Account", "Renewal Opportunity": "Renewal / Expansion",
                "Offer Prepared": "Renewal / Expansion", "Client Negotiation": "Negotiation / Approval",
                "Contract Renewal Processing": "Closed / Signed / PO Issued", "Won – Renewed": "Active Account", "At Risk": "At-Risk Account",
                // collection
                "Billing Pending": "Onboarding / Fulfillment", "Billing Sent": "Onboarding / Fulfillment", "For Follow-Up": "Active Account",
                "Below 60% Collected": "Active Account", "75% Collected": "Active Account", "90% Collected": "Active Account",
                "Fully Collected": "Active Account", "Collection Escalation": "At-Risk Account",
                // implementation
                "Contract Confirmed": "Onboarding / Fulfillment", "Finance Validation": "Onboarding / Fulfillment",
                "System Allocation": "Onboarding / Fulfillment", "Training Scheduled": "Onboarding / Fulfillment",
                "Deployment Ongoing": "Onboarding / Fulfillment", "Training Completed": "Onboarding / Fulfillment",
                "Client Acceptance": "Active Account", "Completed": "Active Account",
            };

            allDeals.forEach(deal => {
                if (stageMap[deal.stage]) deal.stage = stageMap[deal.stage];
                deal.pipeline = 'main';
            });
            await window.EduLearnDB.saveDeals(allDeals);
            localStorage.setItem('migrated_to_main_pipeline', 'true');
            await refreshData(); // To get the updated deals into the state
            showToast("Pipeline Updated", "Pipelines migrated to the new Progress Report.", "success");
        }

        // Scope filtration
        const visibleDeals = filterByRoleVisibility(state.deals, "assignedSS");
        const pipelineDeals = visibleDeals.filter(d => d.pipeline === state.activePipeline);
        const stages = pipelineStages[state.activePipeline] || [];

        stages.forEach(stage => {
            const column = document.createElement("div");
            column.className = "kanban-column";

            const columnDeals = pipelineDeals.filter(d => d.stage === stage);

            column.innerHTML = `
                <div class="kanban-column-header">
                    <span class="kanban-column-title" title="${stage}">${stage}</span>
                    <span class="kanban-column-count">${columnDeals.length}</span>
                </div>
                <div class="kanban-cards-wrapper" data-stage-name="${stage}"></div>
            `;

            const cardsContainer = column.querySelector(".kanban-cards-wrapper");

            if (columnDeals.length > 0) {
                columnDeals.forEach(deal => {
                    const ssUser = state.users.find(u => u.id === deal.assignedSS) || { name: "N/A", avatarColor: "var(--primary)" };
                    const initials = ssUser.name.split(' ').map(n => n[0]).join('');

                    const card = document.createElement("div");
                    card.className = "kanban-card";
                    card.setAttribute("data-deal-id", deal.id);
                    card.setAttribute("draggable", "true");

                    // Check if the deal is overdue
                    const isOverdue = new Date(deal.expectedClose) < new Date() && !deal.stage.toLowerCase().includes("won") && !deal.stage.toLowerCase().includes("lost");

                    card.innerHTML = `
                        <div class="kanban-card-id">${deal.id}</div>
                        <div class="kanban-card-title">${deal.schoolName}</div>
                        <div class="kanban-card-meta">${deal.products.join(', ')}</div>
                        <div class="kanban-card-value">
                            <span>₱${deal.grossValue.toLocaleString()}</span>
                            ${deal.collectionPercent > 0 ? `<span style="font-size: 11px; color: var(--success); font-weight: 600;">${deal.collectionPercent}% In</span>` : ''}
                        </div>
                        <div class="kanban-card-footer">
                            <div class="kanban-card-user">
                                <div class="kanban-card-avatar" style="background: ${ssUser.avatarColor || 'var(--primary)'}; color: var(--text-on-primary, white);">
                                    ${initials}
                                </div>
                                <span class="kanban-card-ss-name">${ssUser.name}</span>
                            </div>
                            <div class="kanban-card-action-date ${isOverdue ? 'overdue' : ''}" title="Expected Close Date">
                                <i class="fa-solid fa-calendar-day"></i> ${deal.expectedClose}
                            </div>
                        </div>
                    `;

                    // Click card triggers editor modal
                    card.addEventListener("click", (e) => {
                        // Prevent opening if clicking nested avatar buttons
                        if (e.target.closest('.kanban-card-avatar')) return;
                        openDealModal(deal);
                    });

                    cardsContainer.appendChild(card);
                });
            }

            kanbanBoard.appendChild(column);
        });

        // Add Drag and Drop event listeners after rendering
        const cards = document.querySelectorAll(".kanban-card");
        const columns = document.querySelectorAll(".kanban-cards-wrapper");

        cards.forEach(card => {
            card.addEventListener("dragstart", () => {
                card.classList.add("dragging");
                const dealId = card.getAttribute("data-deal-id");
                event.dataTransfer.setData("text/plain", dealId);
            });

            card.addEventListener("dragend", () => {
                card.classList.remove("dragging");
            });
        });

        columns.forEach(column => {
            column.addEventListener("dragover", (e) => {
                e.preventDefault();
                column.classList.add("drag-over");
            });

            column.addEventListener("dragleave", () => {
                column.classList.remove("drag-over");
            });

            column.addEventListener("drop", (e) => {
                e.preventDefault();
                column.classList.remove("drag-over");
                const dealId = e.dataTransfer.getData("text/plain");
                const targetStage = column.getAttribute("data-stage-name");
                moveDealStage(dealId, targetStage); // This will be async
            });
        });
    }

    async function moveDealStage(dealId, targetStage) {
        const deals = await window.EduLearnDB.getDeals();
        const deal = deals.find(d => d.id === dealId);

        if (!deal) return;

        // Block SS from moving deals to won stages if managers approve (pricing exceptions)
        const { role } = getSessionContext();
        if (targetStage.toLowerCase().includes("won") && deal.markup < 15000 && role === "Solution Specialist") {
            showToast("Validation Locked", "Deal requires VP approval for custom discount values.", "warning");
            return;
        }

        // If target is "Dormant / Lost", require a reason before saving.
        if (targetStage === "Dormant / Lost") {
            openLostReasonModal(dealId, targetStage);
            return;
        }

        // Normal drag updates
        deal.stage = targetStage;
        
        // Sync school health status based on the new deal stage
        const schools = await window.EduLearnDB.getSchools();
        const schoolIndex = schools.findIndex(s => s.id === deal.schoolId);
        if (schoolIndex !== -1) {
            const newHealthStatus = targetStage;

            if (schools[schoolIndex].health !== newHealthStatus) {
                schools[schoolIndex].health = newHealthStatus;
                await window.EduLearnDB.saveSchools(schools);
                showToast("School Health Synced", `${deal.schoolName} progress is now '${newHealthStatus}'.`, "info");
            }
        }

        await window.EduLearnDB.saveDeals(deals);
        showToast("Pipeline Movement", `Deal ${dealId} moved to ${targetStage}.`, "success");
        await refreshActiveView();
    }

    // Lost Reasons Dialog logic
    const lostReasonModal = document.getElementById("lost-reason-modal");
    const lostReasonForm = document.getElementById("lost-reason-form");

    function openLostReasonModal(dealId, targetStage) {
        lostReasonModal.classList.add("active");
        document.getElementById("lost-deal-id").value = dealId;
        document.getElementById("lost-deal-stage").value = targetStage;
        lostReasonForm.reset();
    }

    lostReasonForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const dealId = document.getElementById("lost-deal-id").value;
        const targetStage = document.getElementById("lost-deal-stage").value;
        const reason = document.getElementById("lost-reason-select").value;
        const remarks = document.getElementById("lost-reason-remarks").value;

        const deals = await window.EduLearnDB.getDeals();
        const deal = deals.find(d => d.id === dealId);

        if (deal) {
            deal.stage = targetStage;
            deal.lostReason = reason;
            deal.remarks = `Lost Reason Details: ${remarks}. Previous Notes: ${deal.remarks || ''}`;

            // Sync school health to the new stage
            const schools = await window.EduLearnDB.getSchools();
            const schoolIndex = schools.findIndex(s => s.id === deal.schoolId);
            if (schoolIndex !== -1 && schools[schoolIndex].health !== targetStage) {
                schools[schoolIndex].health = targetStage;
                await window.EduLearnDB.saveSchools(schools);
                showToast("School Health Synced", `${deal.schoolName} progress is now '${targetStage}'.`, "info");
            }

            await window.EduLearnDB.saveDeals(deals);
            showToast("Deal Lost Audited", `Deal ${dealId} marked Lost: ${reason}.`, "danger");
        }

        lostReasonModal.classList.remove("active");
        await refreshActiveView();
    });

    // Add / Edit Deal Modal Controllers
    const dealModal = document.getElementById("deal-modal");
    const btnDealClose = document.getElementById("btn-deal-close");
    const btnDealCancel = document.getElementById("btn-deal-cancel");
    const dealForm = document.getElementById("deal-form");

    if (btnDealClose) btnDealClose.addEventListener("click", closeDealModal);
    if (btnDealCancel) btnDealCancel.addEventListener("click", closeDealModal);

    function openDealModal(dealObj = null) {
        dealModal.classList.add("active");

        // Handle delivery fields visibility
        const deliveryWrapper = document.getElementById("deal-delivery-fields-wrapper");
        const { role } = getSessionContext();
        const canEditDelivery = ["Finance / Collections", "Training / Fulfillment", "Regional Manager", "VP for Sales and Marketing", "President / CEO", "System Administrator"].includes(role);
        deliveryWrapper.style.display = canEditDelivery ? "block" : "none";

        // Populate schools options list
        const schoolSelect = document.getElementById("deal-school");
        schoolSelect.innerHTML = "";
        state.schools.forEach(sch => {
            const opt = document.createElement("option");
            opt.value = sch.id;
            opt.textContent = sch.name;
            schoolSelect.appendChild(opt);
        });

        // Populate SS list
        const ssSelect = document.getElementById("deal-ss");
        ssSelect.innerHTML = "";
        state.users.filter(u => u.role === "Solution Specialist").forEach(ss => {
            const opt = document.createElement("option");
            opt.value = ss.id;
            opt.textContent = ss.name;
            ssSelect.appendChild(opt);
        });

        // Populate products list
        const productSelect = document.getElementById("deal-product");
        productSelect.innerHTML = "";
        state.products.forEach(product => {
            const opt = document.createElement("option");
            opt.value = product.name;
            opt.textContent = `${product.name} (${product.category})`;
            productSelect.appendChild(opt);
        });

        // Toggle collection custom fields if looking at collections monitoring
        const colWrapper = document.getElementById("deal-collection-fields-wrapper");
        if (state.activePipeline === "collection") {
            colWrapper.style.display = "block";
        } else {
            colWrapper.style.display = "none";
        }

        if (dealObj) {
            document.getElementById("deal-modal-title").textContent = "Edit Opportunity Deal";
            document.getElementById("deal-form-id").value = dealObj.id;
            document.getElementById("deal-form-pipeline").value = dealObj.pipeline;
            document.getElementById("deal-form-stage").value = dealObj.stage;
            document.getElementById("deal-school").value = dealObj.schoolId;
            document.getElementById("deal-gross").value = dealObj.grossValue;
            document.getElementById("deal-students").value = dealObj.students;
            document.getElementById("deal-ss").value = dealObj.assignedSS;
            document.getElementById("deal-si-delivered").value = dealObj.siDeliveredValue || 0;

            if (dealObj.products && dealObj.products.length > 0) {
                // Assuming a single product for now, as per the original hardcoded value
                document.getElementById("deal-product").value = dealObj.products[0];
            }

            if (state.activePipeline === "collection") {
                document.getElementById("deal-collected-percent").value = dealObj.collectionPercent || 0;
                document.getElementById("deal-amount-collected").value = dealObj.amountCollected || 0;
            }
        } else {
            document.getElementById("deal-modal-title").textContent = "Register Opportunity Deal";
            dealForm.reset();
            document.getElementById("deal-si-delivered").value = 0;
            document.getElementById("deal-form-id").value = "";
            document.getElementById("deal-form-pipeline").value = state.activePipeline;
            document.getElementById("deal-form-stage").value = pipelineStages[state.activePipeline][0];
        }
    }

    function closeDealModal() { dealModal.classList.remove("active"); }

    dealForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const id = document.getElementById("deal-form-id").value;
        const pipeline = document.getElementById("deal-form-pipeline").value;
        const stage = document.getElementById("deal-form-stage").value;
        const schoolId = document.getElementById("deal-school").value;
        const grossValue = parseInt(document.getElementById("deal-gross").value) || 0;
        const netValue = grossValue; // Net value is now the same as gross value
        const students = parseInt(document.getElementById("deal-students").value);
        const assignedSS = document.getElementById("deal-ss").value;
        const selectedProduct = document.getElementById("deal-product").value;
        const siDeliveredValue = parseInt(document.getElementById("deal-si-delivered").value) || 0;

        const schoolObj = state.schools.find(s => s.id === schoolId) || { name: "Unknown school" };

        const deals = await window.EduLearnDB.getDeals();

        let collectionPercent = 0;
        let amountCollected = 0;
        if (state.activePipeline === "collection") {
            collectionPercent = parseInt(document.getElementById("deal-collected-percent").value) || 0;
            amountCollected = parseInt(document.getElementById("deal-amount-collected").value) || 0;
        }

        if (id) {
            const index = deals.findIndex(d => d.id === id);
            if (index !== -1) {
                deals[index] = {
                    ...deals[index],
                    schoolId, schoolName: schoolObj.name, grossValue, netValue, students, assignedSS, products: [selectedProduct],
                    collectionPercent, amountCollected, remainingBalance: grossValue - amountCollected,
                    siDeliveredValue
                };
                await window.EduLearnDB.saveDeals(deals);
                showToast("Deal File Saved", `Opportunities for ${schoolObj.name} updated.`, "success");
            }
        } else {
            const nextId = `DEL-${Math.floor(Math.random() * 900) + 100}`;
            deals.push({
                id: nextId, schoolId, schoolName: schoolObj.name, pipeline, stage,
                yearCovered: "SY 2026-2027", products: [selectedProduct], grossValue, netValue,
                markup: grossValue - netValue, baseValue: netValue, students,
                proposalDate: new Date().toISOString().split('T')[0],
                expectedClose: new Date().toISOString().split('T')[0],
                contractStatus: "Draft", poStatus: "Pending", billingStatus: "Pending",
                collectionPercent, amountCollected, remainingBalance: grossValue - amountCollected,
                commissionEligible: "No", deliveryStatus: "Pending", mgrApproval: "No",
                pricingExceptionApprovedBy: "", remarks: "", assignedSS,
                returns: 0, siDeliveredValue
            });
            await window.EduLearnDB.saveDeals(deals);
            showToast("Deal Created", `Created opportunity card ${nextId}.`, "success");
        }

        closeDealModal();
        await refreshActiveView();
    });

    // ================= TAB: BUSINESS REPORT =================

    async function renderBusinessReport() {
        await refreshData();

        const salesSummaryContainer = document.getElementById("sales-summary-report");
        const ssReportContainer = document.getElementById("ss-business-report");
        const ssFilterDropdown = document.getElementById("ss-report-filter");
        const ssSchoolDetailsContainer = document.getElementById("ss-school-details-report");


        if (!salesSummaryContainer || !ssReportContainer || !ssFilterDropdown || !ssSchoolDetailsContainer) return;

        // Helper to check if a deal is "won" for reporting purposes
        const isDealWon = (deal) => {
            const wonStages = [
                "Closed / Signed / PO Issued",
                "Onboarding / Fulfillment",
                "Active Account",
                "Completed",
                "Fully Collected",
                "Won – Renewed",
                "Won – Billing"
            ];
            // Also consider deals with collection > 0 as "won" for business value reporting
            return wonStages.includes(deal.stage) || (deal.collectionPercent > 0);
        };

        const wonDeals = state.deals.filter(isDealWon);
        const allSchools = state.schools;
        const allUsers = state.users;

        const formatCurrency = (num) => `₱${(num || 0).toLocaleString()}`;
        const formatPercent = (val, total) => total > 0 ? `${Math.round((val / total) * 100)}%` : '0%';

        const generateReportTable = (title, dataRows, isSummary = false, isTotalRowBold = false) => {
            const headers = isSummary 
                ? ['Area', 'RM', '# of Schools', '# of schools reconciled', '%', 'PO Value', 'SI Delivered (Actual)', 'Undelivered', '% Delivery', 'Total Returns+ Adjustments', '% of Returns + Adjustments', 'Business Value']
                : ['Area', 'SS', '# of Schools', '# of schools reconciled', '%', 'PO Value', 'SI Delivered (Actual)', 'Undelivered', '% Delivery', 'Total Returns+ Adjustments', '% of Returns', 'Business Value'];

            let tableHTML = `
                <h4 style="font-size: 16px; font-weight: 700; margin-bottom: 16px;">${title}</h4>
                <div class="table-container">
                    <table class="crm-table">
                        <thead>
                            <tr>
                                ${headers.map(h => `<th>${h}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${dataRows.map(row => `
                                <tr ${isTotalRowBold && row.area === 'Total' ? 'style="font-weight: 700;"' : ''}>
                                    <td>${row.area}</td>
                                    <td>${row.manager}</td>
                                    <td>${row.schoolCount}</td>
                                    <td>${row.reconciledCount}</td>
                                    <td>${formatPercent(row.reconciledCount, row.schoolCount)}</td>
                                    <td>${formatCurrency(row.poValue)}</td>
                                    <td>${formatCurrency(row.siDelivered)}</td>
                                    <td>${formatCurrency(row.undelivered)}</td>
                                    <td>${row.deliveryPercent}</td>
                                    <td>${formatCurrency(row.returns)}</td>
                                    <td>${formatPercent(row.returns, row.poValue)}</td>
                                    <td style="font-weight: 700;">${formatCurrency(row.businessValue)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
            return tableHTML;
        };

        const generateSchoolDetailReportTable = (title, dataRows) => {
            const headers = ['School Name', 'PO Value', 'SI Delivered (Actual)', 'Total Returns+ Adjustments', 'Business Value'];

            if (dataRows.length === 0) {
                return `
                    <div style="border-top: 1px solid var(--border-color); padding-top: 24px; margin-top: 24px;">
                        <h4 style="font-size: 16px; font-weight: 700; margin-bottom: 16px;">${title}</h4>
                        <p style="font-size: 13px; color: var(--text-muted);">No schools with business value found for this specialist.</p>
                    </div>
                `;
            }

            let tableHTML = `
                <div style="border-top: 1px solid var(--border-color); padding-top: 24px; margin-top: 24px;">
                    <h4 style="font-size: 16px; font-weight: 700; margin-bottom: 16px;">${title}</h4>
                    <div class="table-container">
                        <table class="crm-table">
                            <thead>
                                <tr>
                                    ${headers.map(h => `<th>${h}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${dataRows.map(row => `
                                    <tr>
                                        <td>${row.schoolName}</td>
                                        <td>${formatCurrency(row.poValue)}</td>
                                        <td>${formatCurrency(row.siDelivered)}</td>
                                        <td>${formatCurrency(row.returns)}</td>
                                        <td style="font-weight: 700;">${formatCurrency(row.businessValue)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            return tableHTML;
        };

        const calculateRowData = (deals, schools) => {
            const schoolCount = schools.length;
            const reconciledCount = schools.filter(s => s.approvalStatus !== 'Pending').length;
            const poValue = deals.reduce((sum, deal) => sum + (deal.grossValue || 0), 0);
            const returns = deals.reduce((sum, deal) => sum + (deal.returns || 0), 0);
            const siDelivered = deals.reduce((sum, deal) => sum + (deal.siDeliveredValue || 0), 0);
            const undelivered = poValue - siDelivered;
            const deliveryPercent = poValue > 0 ? `${Math.round((siDelivered / poValue) * 100)}%` : '0%';
            return {
                schoolCount,
                reconciledCount,
                poValue,
                siDelivered,
                undelivered,
                deliveryPercent,
                returns,
                businessValue: poValue - returns,
            };
        };

        // 1. Sales Summary Report
        const summaryData = [];
        const regionGroups = { 'LUZON': ['North Luzon', 'South Luzon'], 'VISAYAS': ['Visayas'], 'MINDANAO': ['Mindanao'] };
        for (const [groupName, subRegions] of Object.entries(regionGroups)) {
            const regionalSchools = allSchools.filter(s => subRegions.includes(s.region));
            const regionalSchoolIds = new Set(regionalSchools.map(s => s.id));
            const regionalDeals = wonDeals.filter(d => regionalSchoolIds.has(d.schoolId));
            const rm = allUsers.find(u => u.role === 'Regional Manager' && subRegions.includes(u.region));
            
            summaryData.push({
                area: groupName,
                manager: rm ? rm.name : 'N/A',
                ...calculateRowData(regionalDeals, regionalSchools)
            });
        }
        const totalSchools = allSchools.filter(s => Object.values(regionGroups).flat().includes(s.region));
        const totalRow = { area: 'Total', manager: '', ...calculateRowData(wonDeals, totalSchools) };
        summaryData.push(totalRow);
        salesSummaryContainer.innerHTML = generateReportTable('Sales Summary Report', summaryData, true, true);
        
        // 2. Specialist Report with Filter
        const specialists = allUsers.filter(u => {
            const isFieldPersonnel = u.role === 'Solution Specialist' || u.role === 'District Manager';
            // Also include RMs if they have schools directly assigned to them, to handle dual roles.
            const isActingSpecialist = u.role === 'Regional Manager' && allSchools.some(s => s.assignedSS === u.id);
            return isFieldPersonnel || isActingSpecialist;
        });
        
        // Populate dropdown
        const currentFilterValue = ssFilterDropdown.value;
        ssFilterDropdown.innerHTML = '<option value="all">All Specialists</option>';
        specialists.forEach(ss => {
            const opt = document.createElement('option');
            opt.value = ss.id;
            opt.textContent = `${ss.name} (${ss.territory || ss.district || ss.region})`;
            ssFilterDropdown.appendChild(opt);
        });

        if (Array.from(ssFilterDropdown.options).some(o => o.value === currentFilterValue)) {
            ssFilterDropdown.value = currentFilterValue;
        } else {
            ssFilterDropdown.value = 'all';
        }

        // Function to render the table based on filter
        const renderSSReportTable = () => {
            const selectedSSId = ssFilterDropdown.value;

            const ssData = [];
            let usersToReportOn = [];

            if (selectedSSId === 'all') {
                usersToReportOn = specialists;
            } else {
                const selectedUser = allUsers.find(u => u.id === selectedSSId);
                if (selectedUser) usersToReportOn.push(selectedUser);
            }

            let totalSchools = [], totalDeals = [];

            for (const ss of usersToReportOn) {
                const ssSchools = allSchools.filter(s => s.assignedSS === ss.id);
                if (ssSchools.length === 0 && selectedSSId === 'all') continue;

                const ssSchoolIds = new Set(ssSchools.map(s => s.id));
                const ssDeals = wonDeals.filter(d => ssSchoolIds.has(d.schoolId));
                
                totalSchools.push(...ssSchools);
                totalDeals.push(...ssDeals);

                const territory = ss.territory || ss.district || (ssSchools.length > 0 ? ssSchools[0].territory : 'N/A');
                ssData.push({
                    area: territory,
                    manager: ss.name,
                    ...calculateRowData(ssDeals, ssSchools)
                });
            }

            if (selectedSSId === 'all' && usersToReportOn.length > 0) {
                const totalRow = { area: 'Total', manager: '', ...calculateRowData(totalDeals, totalSchools) };
                ssData.push(totalRow);
            }
            
            ssReportContainer.innerHTML = generateReportTable('Specialist Business Report', ssData, false, true);

            // --- NEW LOGIC FOR SCHOOL DETAILS ---
            if (selectedSSId === 'all') {
                ssSchoolDetailsContainer.innerHTML = ''; // Clear details if 'All' is selected
                return;
            }

            const selectedUser = allUsers.find(u => u.id === selectedSSId);
            if (!selectedUser) {
                ssSchoolDetailsContainer.innerHTML = '';
                return;
            }

            const ssSchools = allSchools.filter(s => s.assignedSS === selectedSSId);
            const schoolDetailsData = [];

            for (const school of ssSchools) {
                const schoolDeals = wonDeals.filter(d => d.schoolId === school.id);
                
                if (schoolDeals.length > 0) {
                    const poValue = schoolDeals.reduce((sum, deal) => sum + (deal.grossValue || 0), 0);
                    const returns = schoolDeals.reduce((sum, deal) => sum + (deal.returns || 0), 0);
                    const siDelivered = schoolDeals.reduce((sum, deal) => sum + (deal.siDeliveredValue || 0), 0);

                    schoolDetailsData.push({
                        schoolName: school.name,
                        poValue,
                        siDelivered: siDelivered,
                        returns,
                        businessValue: poValue - returns
                    });
                }
            }
            
            ssSchoolDetailsContainer.innerHTML = generateSchoolDetailReportTable(
                `School Breakdown for ${selectedUser.name}`,
                schoolDetailsData
            );
        };

        // Attach listener and render for the first time
        ssFilterDropdown.onchange = renderSSReportTable;
        renderSSReportTable();
    }

    async function renderFinancials() {
        await refreshData();
        const tableBody = document.getElementById("financials-table-body");
        const saveAllBtn = document.getElementById("btn-save-all-financials");
        const searchInput = document.getElementById("financials-search");
        if (!tableBody || !saveAllBtn || !searchInput) return;

        // Set the search input value from state, in case of re-render
        searchInput.value = state.financialsQuery || '';
        
        // Hide the save button initially
        saveAllBtn.style.display = 'none';

        const isDealWon = (deal) => {
            const wonStages = [
                "Closed / Signed / PO Issued",
                "Onboarding / Fulfillment",
                "Active Account",
                "Completed",
                "Fully Collected",
                "Won – Renewed",
                "Won – Billing"
            ];
            return wonStages.includes(deal.stage) || (deal.collectionPercent > 0);
        };

        let wonDeals = filterByRoleVisibility(state.deals, "assignedSS").filter(isDealWon);

        // Apply search filter
        if (state.financialsQuery) {
            wonDeals = wonDeals.filter(deal => {
                const query = state.financialsQuery;
                return deal.schoolName.toLowerCase().includes(query) ||
                       deal.id.toLowerCase().includes(query);
            });
        }

        tableBody.innerHTML = "";

        if (wonDeals.length === 0) {
            const isSearching = !!state.financialsQuery;
            const message = isSearching ? 'No deals found matching your search.' : 'No "Won" deals found to reconcile.';
            const iconClass = isSearching ? 'fa-search' : 'fa-file-invoice-dollar';
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 40px;">
                        <i class="fa-solid ${iconClass}" style="font-size: 32px; margin-bottom: 12px;"></i>
                        <p>${message}</p>
                    </td>
                </tr>
            `;
            return;
        }

        wonDeals.forEach(deal => {
            const ssUser = state.users.find(u => u.id === deal.assignedSS) || { name: "Unassigned" };
            const tr = document.createElement("tr");
            tr.setAttribute('data-deal-id', deal.id);

            const netValue = (deal.grossValue || 0) - (deal.returns || 0);

            tr.innerHTML = `
                <td>
                    <div style="font-weight: 600;">${deal.schoolName}</div>
                    <div style="font-size: 11px; color: var(--text-muted); font-family: monospace;">DEAL ID: ${deal.id}</div>
                </td>
                <td>${ssUser.name}</td>
                <td><input type="number" class="form-input financial-input" data-field="grossValue" value="${deal.grossValue || 0}" style="font-size: 13px; padding: 8px 10px;"></td>
                <td><input type="number" class="form-input financial-input" data-field="siDeliveredValue" value="${deal.siDeliveredValue || 0}" style="font-size: 13px; padding: 8px 10px;"></td>
                <td><input type="number" class="form-input financial-input" data-field="returns" value="${deal.returns || 0}" style="font-size: 13px; padding: 8px 10px;"></td>
                <td class="net-value-cell">
                    <span class="financial-net-value">₱${netValue.toLocaleString()}</span>
                </td>
            `;
            tableBody.appendChild(tr);

            // Add listeners to update net value and mark row as dirty
            const inputs = tr.querySelectorAll('.financial-input');
            const netValueSpan = tr.querySelector('.financial-net-value');
            inputs.forEach(input => {
                input.addEventListener('input', () => {
                    tr.classList.add('is-dirty');
                    saveAllBtn.style.display = 'inline-flex';

                    const grossValue = parseInt(tr.querySelector('[data-field="grossValue"]').value) || 0;
                    const returns = parseInt(tr.querySelector('[data-field="returns"]').value) || 0;
                    netValueSpan.textContent = `₱${(grossValue - returns).toLocaleString()}`;
                });
            });
        });

        // Setup the "Save All" button listener (cloning to prevent multiple listeners)
        const newSaveAllBtn = saveAllBtn.cloneNode(true);
        saveAllBtn.parentNode.replaceChild(newSaveAllBtn, saveAllBtn);

        newSaveAllBtn.addEventListener('click', async () => {
            const dirtyRows = tableBody.querySelectorAll('tr.is-dirty');
            if (dirtyRows.length === 0) {
                showToast("No Changes", "There are no pending financial updates to save.", "info");
                return;
            }

            const deals = await window.EduLearnDB.getDeals();
            let updatedCount = 0;

            dirtyRows.forEach(row => {
                const dealId = row.getAttribute('data-deal-id');
                const dealIndex = deals.findIndex(d => d.id === dealId);
                if (dealIndex !== -1) {
                    const grossValue = parseInt(row.querySelector('[data-field="grossValue"]').value) || 0;
                    deals[dealIndex].grossValue = grossValue;
                    deals[dealIndex].siDeliveredValue = parseInt(row.querySelector('[data-field="siDeliveredValue"]').value) || 0;
                    deals[dealIndex].returns = parseInt(row.querySelector('[data-field="returns"]').value) || 0;
                    deals[dealIndex].netValue = grossValue;
                    deals[dealIndex].remainingBalance = grossValue - (deals[dealIndex].amountCollected || 0);
                    
                    updatedCount++;
                    row.classList.remove('is-dirty');
                }
            });

            if (updatedCount > 0) {
                await window.EduLearnDB.saveDeals(deals);
                showToast("Financials Updated", `${updatedCount} deal(s) have been saved successfully.`, "success");
                newSaveAllBtn.style.display = 'none'; // Hide button after saving
            }
        });
    }

    // ================= TAB: DAILY ACTIVITIES (DAR) =================

    const btnLogDar = document.getElementById("btn-log-dar");
    const darModal = document.getElementById("dar-modal");
    const darForm = document.getElementById("dar-form");
    const btnDarClose = document.getElementById("btn-dar-close");
    const btnDarCancel = document.getElementById("btn-dar-cancel");

    if (btnLogDar) btnLogDar.addEventListener("click", () => openDarModal());
    if (btnDarClose) btnDarClose.addEventListener("click", () => closeDarModal());
    if (btnDarCancel) btnDarCancel.addEventListener("click", () => closeDarModal());

    // Webcam snap handlers for DAR
    // (Moved to global scope for easier access by new functions)
    /**
     * Populates the DAR school datalist based on the current user's role and scope. This function
     * filters the schools to ensure that users only see schools within their assigned region or
     * scope, improving relevance and data security.
     * @private
     */
    function populateDarSchoolDatalist() {
        const schoolDatalist = document.getElementById("dar-school-list");
        schoolDatalist.innerHTML = "";
        const { role, user } = getSessionContext();
        
        let schoolsToShow = state.schools;
        const isFieldworkRole = ["Regional Manager", "District Manager", "Solution Specialist", "Sales Account"].includes(role);

        if (isFieldworkRole && user && user.region && user.region !== 'All') {
            const regionalSchools = state.schools.filter(s => s.region === user.region);
            if (regionalSchools.length > 0) {
                schoolsToShow = regionalSchools;
            }
        }

        if (!isGlobalVisibilityRole(role) && !isFieldworkRole) {
            schoolsToShow = [];
        }

        schoolsToShow.forEach(sch => {
            const opt = document.createElement("option");
            opt.value = sch.name;
            opt.setAttribute("data-id", sch.id);
            schoolDatalist.appendChild(opt);
        });
    }

    /**
     * Resets and prepares the DAR form for creating a new activity. It clears all fields,
     * sets a default follow-up date, and resets the photo capture state.
     * @private
     */
    function resetDarFormForNew() {
        document.getElementById("dar-modal-title").textContent = "Log Fieldwork Activity";
        document.getElementById("dar-form-id").value = "";
        document.getElementById("dar-school").value = "";
        document.getElementById("dar-type").value = "School Visit";
        const contactsContainer = document.getElementById('dar-contacts-container');
        if (contactsContainer) {
            contactsContainer.innerHTML = '';
            addDarContactInput();
        }
        document.getElementById("dar-product").value = "SAVVY";
        document.getElementById("dar-result").value = "";
        document.getElementById("dar-next-action").value = "";
        
        const nextW = new Date();
        nextW.setDate(nextW.getDate() + 7);
        document.getElementById("dar-followup-date").value = nextW.toISOString().split('T')[0];
        
        resetAllPhotos();
    }

    /**
     * Populates the DAR form with data from an existing activity for editing. It also
     * reconstructs the photo preview state from the saved activity data.
     * @param {object} activityObj The activity object to edit.
     * @private
     */
    function populateDarFormForEdit(activityObj) {
        document.getElementById("dar-modal-title").textContent = "Edit Fieldwork Activity";
        document.getElementById("dar-form-id").value = activityObj.id;
        document.getElementById("dar-school").value = activityObj.schoolName;
        document.getElementById("dar-type").value = activityObj.type;
        const contactsContainer = document.getElementById('dar-contacts-container');
        if (contactsContainer) {
            contactsContainer.innerHTML = '';
            const personsMet = activityObj.personsMet || (activityObj.personMet ? [activityObj.personMet] : []);
            if (personsMet.length > 0) {
                personsMet.forEach(person => addDarContactInput(person));
            } else {
                addDarContactInput(); // Add one empty input if none exist
            }
        }
        document.getElementById("dar-product").value = activityObj.productDiscussed;
        document.getElementById("dar-followup-date").value = activityObj.nextFollowUp;
        document.getElementById("dar-result").value = activityObj.result;
        document.getElementById("dar-next-action").value = activityObj.nextAction;

        resetAllPhotos();
        // Directly assign the arrays from the object to the state.
        state.darPhotos = activityObj.photos || [];
        state.darPhotoLocations = activityObj.locations || [];
        state.darPhotoOut = activityObj.photoOut || null;
        state.darLocationOut = activityObj.locationOut || null;
        renderPhotoPreviews();
        updateSnapButtonState();
    }

    /**
     * Opens the DAR modal for creating or editing a fieldwork activity.
     * @param {object|null} activityObj - The activity object to edit, or null to create a new one.
     */
    async function openDarModal(activityObj = null) {
        await refreshData();
        darModal.classList.add("active");
        
        populateDarSchoolDatalist();

        if (activityObj) {
            populateDarFormForEdit(activityObj);
        } else {
            resetDarFormForNew();
        }
    }

    function closeDarModal() {
        stopCameras();
        darModal.classList.remove("active");
    }

    const btnAddDarContact = document.getElementById('btn-add-dar-contact');

    function addDarContactInput(value = '') {
        const container = document.getElementById('dar-contacts-container');
        if (!container) return;
    
        const isFirst = container.children.length === 0;
    
        const inputWrapper = document.createElement('div');
        inputWrapper.style.display = 'flex';
        inputWrapper.style.gap = '8px';
        inputWrapper.style.alignItems = 'center';
    
        const newInput = document.createElement('input');
        newInput.type = 'text';
        newInput.className = 'form-input dar-contact-input';
        newInput.value = value;
        newInput.placeholder = isFirst ? 'e.g. Principal Santos' : 'Another person...';
        if (isFirst) newInput.required = true;
        newInput.style.flexGrow = '1';
    
        inputWrapper.appendChild(newInput);
    
        if (!isFirst) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'action-icon-btn delete';
            removeBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
            removeBtn.title = 'Remove Person';
            removeBtn.onclick = () => inputWrapper.remove();
            inputWrapper.appendChild(removeBtn);
        }
        
        container.appendChild(inputWrapper);
    }
    
    if (btnAddDarContact) {
        btnAddDarContact.addEventListener('click', () => addDarContactInput());
    }

    // Webcam snap handlers for DAR
    const btnCam = document.getElementById("btn-camera");
    const btnSnap = document.getElementById("btn-snap");
    const btnResetPhotos = document.getElementById("btn-reset-photos");
    const feed = document.getElementById("webcam-feed");
    const placeholder = document.getElementById("webcam-placeholder");
    const snapCountEl = document.getElementById("snap-count");

    if (btnCam) {
        btnCam.addEventListener("click", () => {
            navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
                .then(stream => {
                    state.stream = stream;
                    feed.srcObject = stream;
                    feed.style.display = "block";
                    placeholder.style.display = "none";
                    btnCam.style.display = "none";
                    btnSnap.style.display = "inline-flex";
                })
                .catch(err => {
                    showToast("Webcam Offline", "Camera hardware missing. Loading vector placeholder.", "warning");
                    simulateWebcamFrame();
                });
        });
    }

    if (btnSnap) {
        btnSnap.addEventListener("click", () => {
            // If stream is gone or has been stopped by the browser, simulate.
            if (!state.stream || !state.stream.active) {
                simulateWebcamFrame();
                return;
            }
            const canvas = document.getElementById("webcam-canvas");
            const ctx = canvas.getContext("2d");
            canvas.width = feed.videoWidth || 320;
            canvas.height = feed.videoHeight || 240;
            ctx.drawImage(feed, 0, 0, canvas.width, canvas.height);
            const dataURL = canvas.toDataURL("image/jpeg", 0.7);
            setCapturedPhoto(dataURL);
        });
    }

    if (btnResetPhotos) btnResetPhotos.addEventListener("click", () => resetAllPhotos());

    function simulateWebcamFrame() {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 240;
        const ctx = canvas.getContext("2d");

        const grad = ctx.createLinearGradient(0, 0, 320, 240);
        grad.addColorStop(0, "#1e40af");
        grad.addColorStop(1, "#4f46e5");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 320, 240);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px Outfit, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`SIMULATED PHOTO`, 160, 110);
        ctx.font = "9px monospace";
        ctx.fillText(new Date().toLocaleString(), 160, 130);
        setCapturedPhoto(canvas.toDataURL("image/jpeg")); // This is intentionally not awaited
    }

    async function getLocationMetadata() {
        if (!navigator.geolocation) {
            return { latitude: null, longitude: null, address: "Location unavailable", timestamp: new Date().toISOString() };
        }

        return new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const { latitude, longitude } = position.coords;
                    let placeLabel = "Location unavailable";

                    try {
                        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`);
                        if (response.ok) {
                            const data = await response.json();
                            placeLabel = data.display_name || placeLabel;
                        }
                    } catch (error) {
                        console.warn("DAR location lookup failed", error);
                    }

                    resolve({ latitude, longitude, address: placeLabel, timestamp: new Date().toISOString() });
                },
                () => resolve({ latitude: null, longitude: null, address: "Location unavailable", timestamp: new Date().toISOString() }),
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
            );
        });
    }

    /**
     * Wraps text to fit within a max width on a canvas.
     * @param {CanvasRenderingContext2D} context The canvas rendering context.
     * @param {string} text The text to wrap.
     * @param {number} maxWidth The maximum width for a line of text.
     * @returns {string[]} An array of strings, each representing a line.
     * @private
     */
    function _wrapText(context, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = words[0] || '';

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = context.measureText(currentLine + " " + word).width;
            if (width < maxWidth) {
                currentLine += " " + word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
        return lines;
    }

    /**
     * Applies a watermark to a given image with location and time metadata.
     * @param {string} base64Image The base64 string of the source image.
     * @param {object} locationData The metadata object containing lat, lon, address, and timestamp.
     * @returns {Promise<string>} A promise that resolves with the base64 string of the watermarked image.
     * @private_
     */
    function _applyWatermark(base64Image, locationData) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);

                // Watermark styling
                const padding = Math.max(15, Math.floor(img.width / 60));
                const fontSize = Math.max(14, Math.floor(img.width / 50));
                ctx.font = `700 ${fontSize}px Outfit, sans-serif`;
                ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
                ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
                ctx.shadowBlur = 5;
                ctx.shadowOffsetX = 1;
                ctx.shadowOffsetY = 1;

                // Prepare text lines
                const timestamp = new Date(locationData.timestamp);
                const dateStr = timestamp.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                const timeStr = timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const latStr = `Lat: ${locationData.latitude ? locationData.latitude.toFixed(6) : 'N/A'}`;
                const lonStr = `Lon: ${locationData.longitude ? locationData.longitude.toFixed(6) : 'N/A'}`;
                const addressLines = _wrapText(ctx, locationData.address || 'Location Unavailable', canvas.width - (padding * 2));

                const lines = [dateStr, timeStr, '', latStr, lonStr, '', ...addressLines];

                // Draw text from bottom-left
                let y = canvas.height - padding;
                for (let i = lines.length - 1; i >= 0; i--) {
                    ctx.fillText(lines[i], padding, y);
                    y -= (fontSize * 1.3); // Line height
                }

                resolve(canvas.toDataURL('image/jpeg', 0.9)); // Export as high-quality JPEG
            };
            img.onerror = () => {
                console.error("Failed to load image for watermarking.");
                resolve(base64Image); // Return original image on error
            };
            img.src = base64Image;
        });
    }

    /**
     * Captures a photo, applies a watermark, uploads it to Backblaze B2,
     * and stores the resulting URL.
     * @param {string} base64 The base64 string of the source image.
     */
    async function setCapturedPhoto(base64) {
        showToast("Processing...", "Applying watermark and location data.", "info");
        const locationData = await getLocationMetadata();
        const watermarkedPhotoBase64 = await _applyWatermark(base64, locationData);

        // Instead of uploading, save the base64 data locally for now.
        state.darPhotos.push(watermarkedPhotoBase64);
        state.darPhotoLocations.push(locationData);
        renderPhotoPreviews();
        updateSnapButtonState();
        showToast("Photo Saved Locally", "This photo will be uploaded when you submit the day's report.", "success");
    }

    function renderPhotoPreviews() {
        const container = document.getElementById("dar-photo-previews");
        container.innerHTML = "";

        const createThumbnail = (photo, index, type) => {
            const thumbWrapper = document.createElement('div');
            thumbWrapper.className = 'dar-photo-thumbnail';

            let labelText = '';
            if (type === 'in') {
                thumbWrapper.classList.add('timein-photo');
                labelText = 'Time In';
            } else if (type === 'out') {
                thumbWrapper.classList.add('timeout-photo');
                labelText = 'Time Out';
            }

            const thumbImg = document.createElement('img');
            thumbImg.src = photo;
            // Simplified lightbox call
            thumbImg.onclick = () => openLightbox({ photos: [photo] }, 0);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'delete-photo-btn';
            deleteBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
            deleteBtn.title = 'Delete Photo';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm('Are you sure you want to delete this photo?')) {
                    if (type === 'out') {
                        state.darPhotoOut = null;
                        state.darLocationOut = null;
                    } else {
                        state.darPhotos.splice(index, 1);
                        state.darPhotoLocations.splice(index, 1);
                    }
                    renderPhotoPreviews();
                    updateSnapButtonState();
                }
            };
            thumbWrapper.appendChild(deleteBtn);

            if (labelText) {
                const labelEl = document.createElement('div');
                labelEl.className = 'thumbnail-label';
                labelEl.textContent = labelText;
                thumbWrapper.appendChild(labelEl);
            }

            thumbWrapper.insertBefore(thumbImg, thumbWrapper.firstChild);
            return thumbWrapper;
        };

        // Render regular photos, with the first one marked as 'Time In'
        state.darPhotos.forEach((photo, index) => {
            const type = index === 0 ? 'in' : 'regular';
            const thumbWrapper = createThumbnail(photo, index, type);
            container.appendChild(thumbWrapper);
        });

        // Render 'Time Out' photo if it exists
        if (state.darPhotoOut) {
            const thumbWrapper = createThumbnail(state.darPhotoOut, -1, 'out');
            container.appendChild(thumbWrapper);
        }

        // Show/hide the 'Mark as Time Out' button
        const btnMarkLogout = document.getElementById('btn-mark-logout');
        if (btnMarkLogout) {
            if (state.darPhotoOut) {
                btnMarkLogout.style.display = 'inline-flex';
                btnMarkLogout.innerHTML = '<i class="fa-solid fa-undo"></i> Un-mark \'Time Out\'';
            } else if (state.darPhotos.length > 0) { // Can only mark if there are photos
                btnMarkLogout.style.display = 'inline-flex';
                btnMarkLogout.innerHTML = '<i class="fa-solid fa-flag-checkered"></i> Mark Last as \'Time Out\'';
            } else {
                btnMarkLogout.style.display = 'none';
            }
        }
    }

    function updateSnapButtonState() {
        snapCountEl.textContent = state.darPhotos.length;
        btnSnap.disabled = false;
        btnSnap.style.cursor = 'pointer';
        btnSnap.style.opacity = '1';
    }

    function resetAllPhotos() {
        stopCameras();
        state.darPhotos = [];
        state.darPhotoLocations = [];
        state.darPhotoOut = null;
        state.darLocationOut = null;
        renderPhotoPreviews();
        updateSnapButtonState();
    }

    function stopCameras() {
        if (state.stream) {
            state.stream.getTracks().forEach(t => t.stop());
            state.stream = null;
            if (feed) feed.srcObject = null;
        }
        // Always reset the UI to the initial state when the camera is stopped.
        // This prevents the UI from getting stuck if the stream is closed by the browser.
        if (placeholder) placeholder.style.display = "flex";
        if (feed) feed.style.display = "none";
        if (btnCam) btnCam.style.display = "inline-flex";
        if (btnSnap) btnSnap.style.display = "none";
    }

    async function handleSubmitDayReport() {
        const { user } = getSessionContext();
        const todayStr = new Date().toISOString().split('T')[0];
    
        const allActivities = window.EduLearnDB.getActivities();
        const draftActivitiesToday = allActivities.filter(act =>
            act.ssId === user.id &&
            act.date === todayStr &&
            (act.status === 'Draft' || !act.status) // Include legacy activities without a status
        );
    
        if (draftActivitiesToday.length === 0) {
            showToast("No Drafts Found", "You have no draft activities for today to submit.", "info");
            return;
        }
    
        if (!confirm(`Are you sure you want to submit ${draftActivitiesToday.length} draft activities for today? This will upload all photos and lock the reports.`)) {
            return;
        }

        showToast("Submission Started", `Uploading photos for ${draftActivitiesToday.length} activities. Please wait...`, "info");
        btnSubmitDayReport.disabled = true;
        btnSubmitDayReport.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';

        try {
            for (const activity of draftActivitiesToday) {
                const activityIndex = allActivities.findIndex(a => a.id === activity.id);
                if (activityIndex === -1) continue;

                // Create upload promises for the main photos array
                const photoUploadPromises = (activity.photos || []).map(async (photoData, index) => {
                    if (photoData.startsWith('http')) return photoData; // Already uploaded
                    if (photoData.startsWith('data:image/')) {
                        const photoBlob = dataURLtoBlob(photoData);
                        if (!photoBlob) return null;
                        const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
                        const randomSuffix = Math.random().toString(36).substring(2, 8);
                        const fileName = `dars/${user.id || 'unknown'}/${timestamp}_${randomSuffix}_${index}.jpg`;
                        return await uploadToCloudflareR2(photoBlob, fileName);
                    }
                    return null;
                });

                // Create a separate promise for the 'Time Out' photo
                let photoOutUploadPromise = Promise.resolve(activity.photoOut); // Pass through if already a URL or null
                if (activity.photoOut && activity.photoOut.startsWith('data:image/')) {
                    const photoBlob = dataURLtoBlob(activity.photoOut);
                    if (photoBlob) {
                        const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
                        const randomSuffix = Math.random().toString(36).substring(2, 8);
                        const fileName = `dars/${user.id || 'unknown'}/${timestamp}_${randomSuffix}_out.jpg`;
                        photoOutUploadPromise = uploadToCloudflareR2(photoBlob, fileName);
                    } else {
                        photoOutUploadPromise = Promise.resolve(null); // Failed to create blob
                    }
                }

                // Await all uploads in parallel
                const [uploadedPhotoUrls, uploadedPhotoOutUrl] = await Promise.all([
                    Promise.all(photoUploadPromises),
                    photoOutUploadPromise
                ]);

                const validPhotoUrls = uploadedPhotoUrls.filter(url => url !== null);

                // Check if all photos were uploaded successfully
                if (validPhotoUrls.length !== (activity.photos || []).length || (activity.photoOut && !uploadedPhotoOutUrl)) {
                    throw new Error(`Failed to upload some photos for activity ${activity.id}.`);
                }

                allActivities[activityIndex].photos = validPhotoUrls;
                allActivities[activityIndex].photoOut = uploadedPhotoOutUrl;
                
                allActivities[activityIndex].status = 'Submitted';
            }

            await window.EduLearnDB.saveActivities(allActivities);
            showToast("Report Submitted", `${draftActivitiesToday.length} activities and all photos have been submitted.`, "success");
        } catch (error) {
            console.error("Error during day report submission:", error);
            showToast("Submission Failed", "An error occurred while uploading photos. Please try again.", "danger");
        } finally {
            btnSubmitDayReport.disabled = false;
            btnSubmitDayReport.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Day\'s Report';
            await renderActivitiesList();
        }
    }

    function createVirtualActivityFromGroup(group) {
        const firstAct = group[0];
        const allPhotos = group.flatMap(a => [...(a.photos || []), a.photoOut]).filter(Boolean);
        const allLocations = group.flatMap(a => [...(a.locations || []), a.locationOut]).filter(Boolean);
    
        return {
            ssName: firstAct.ssName,
            schoolName: firstAct.schoolName,
            date: firstAct.date,
            photos: allPhotos,
            locations: allLocations,
            photoOut: null,
            locationOut: null,
        };
    }

    async function renderActivitiesList() {
        await refreshData();
        const tableBody = document.getElementById("activities-table-body");
        if (!tableBody) return;

        const startDateInput = document.getElementById("activity-start-date");
        const endDateInput = document.getElementById("activity-end-date");

        // Set default date range if not set
        if (startDateInput && !state.activityStartDate) {
            const today = new Date();
            const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            startDateInput.value = firstDayOfMonth.toISOString().split('T')[0];
            state.activityStartDate = startDateInput.value;
        }
        if (endDateInput && !state.activityEndDate) {
            endDateInput.value = new Date().toISOString().split('T')[0];
            state.activityEndDate = endDateInput.value;
        }

        const employeeFilter = document.getElementById("activity-employee-filter");
        if (employeeFilter) {
            const { role } = getSessionContext();
            // Show filter for roles that can see other people's activities
            if (canViewSalesCompliance(role)) {
                employeeFilter.style.display = 'inline-block';
                const visibleUsers = getVisibleSpecialistsForCurrentUser();
                const currentSelection = employeeFilter.value;
                employeeFilter.innerHTML = '<option value="all">All Employees</option>';
                visibleUsers.forEach(user => {
                    const option = document.createElement('option');
                    option.value = user.id;
                    option.textContent = user.name;
                    employeeFilter.appendChild(option);
                });
                // Try to preserve selection
                if (Array.from(employeeFilter.options).find(o => o.value === currentSelection)) {
                    employeeFilter.value = currentSelection;
                } else {
                    employeeFilter.value = 'all';
                }
            } else {
                employeeFilter.style.display = 'none';
            }
        }

        let visibleActivities = filterByRoleVisibility(state.activities, "ssId");

        // Apply employee filter
        if (state.activityEmployee !== "all") {
            visibleActivities = visibleActivities.filter(act => act.ssId === state.activityEmployee);
        }

        // Apply date filter
        if (state.activityStartDate) {
            visibleActivities = visibleActivities.filter(act => act.date >= state.activityStartDate);
        }
        if (state.activityEndDate) {
            visibleActivities = visibleActivities.filter(act => act.date <= state.activityEndDate);
        }

        const query = state.activityQuery;
        if (query) {
            visibleActivities = visibleActivities.filter(act => {
                return [
                    act.id,
                    act.ssName,
                    act.schoolName,
                    act.date,
                    act.type,
                    act.personMet,
                    act.result,
                    act.nextAction,
                    act.remarks
                ].filter(Boolean).join(" ").toLowerCase().includes(query);
            });
        }

        tableBody.innerHTML = "";

        // Group activities by school and date
        const groupedActivities = new Map();
        visibleActivities.forEach(act => {
            const key = `${act.schoolId}|${act.date}`;
            if (!groupedActivities.has(key)) {
                groupedActivities.set(key, []);
            }
            groupedActivities.get(key).push(act);
        });

        if (groupedActivities.size === 0) {
            const message = state.activityQuery ? "No activities found matching your search." : "No fieldwork activities logged in the database.";
            tableBody.innerHTML = `
                <tr>
                    <td colspan="10" style="text-align: center; color: var(--text-muted); padding: 40px;">
                        <i class="fa-solid fa-clipboard-list" style="font-size: 32px; margin-bottom: 12px;"></i>
                        <p>${message}</p>
                    </td>
                </tr>
            `;
            return;
        }

        // Create a sorted array of groups to render in order
        const sortedGroups = Array.from(groupedActivities.values()).sort((groupA, groupB) => {
            const dateA = groupA[0].date;
            const dateB = groupB[0].date;
            if (dateA !== dateB) return dateB.localeCompare(dateA);
            const timeA = groupA[0].time || '00:00';
            const timeB = groupB[0].time || '00:00';
            return timeB.localeCompare(timeA);
        });

        sortedGroups.forEach(group => {
            const tr = document.createElement("tr");
            tr.classList.add('clickable-row');

            if (group.length === 1) {
                // RENDER SINGLE ACTIVITY ROW
                const act = group[0];
                const { user, role } = getSessionContext();
                tr.setAttribute('data-id', act.id);
                const personMetDisplay = (act.personsMet || (act.personMet ? [act.personMet] : [])).filter(Boolean).join(', ');

                const photos = act.photos || [];
                const hasPhotoOut = !!act.photoOut;
                const totalPhotos = photos.length + (hasPhotoOut ? 1 : 0);

                let photosHtml = '<span style="color: var(--text-muted); font-size: 12px;">-</span>';
                if (totalPhotos > 0) {
                    const firstPhoto = photos[0] || act.photoOut;
                    photosHtml = `
                        <button class="photo-thumbnail-btn btn-view-photos" data-id="${act.id}" title="View Photos">
                            <img src="${firstPhoto}" alt="photo">
                            ${totalPhotos > 1 ? `<span class="badge" style="position: absolute; bottom: -5px; right: -5px; padding: 2px 5px; font-size: 9px;">+${totalPhotos - 1}</span>` : ''}
                        </button>
                    `;
                }

                const isOwner = act.ssId === user.id;
                const isApprover = isApproverRole(role);
                const status = act.status || 'Draft';

                let statusBadgeClass = 'badge-late'; // Draft
                if (status === 'Submitted') statusBadgeClass = 'badge-info';
                if (status === 'Approved') statusBadgeClass = 'badge-present';
                const statusCellHTML = `<span class="badge ${statusBadgeClass}">${status}</span>`;

                let actionButtons = `<span style="font-size: 11px; color: var(--text-muted);">Locked</span>`;
                if (status === 'Draft' && isOwner) {
                    actionButtons = `
                        <button class="action-icon-btn delete delete-act-btn" data-id="${act.id}" title="Delete Draft">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    `;
                } else if (status === 'Submitted' && isApprover) {
                    actionButtons = `
                        <button class="action-icon-btn approve-act-btn" data-id="${act.id}" title="Approve Activity">
                            <i class="fa-solid fa-check-circle" style="color: var(--success);"></i>
                        </button>
                        <button class="action-icon-btn reject-act-btn" data-id="${act.id}" title="Reject Activity">
                            <i class="fa-solid fa-times-circle" style="color: var(--danger);"></i>
                        </button>
                    <button class="action-icon-btn delete delete-act-btn" data-id="${act.id}" title="Delete Submission">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                    `;
                }

                tr.innerHTML = `
                    <td data-label="Activity ID" style="font-family: monospace; font-weight: 700; color: var(--text-muted);">${act.id}</td>
                    <td data-label="Specialist" style="font-weight: 600;">${act.ssName}</td>
                    <td data-label="School Visited"><div style="font-weight: 600;">${act.schoolName || 'Unknown School'}</div></td>
                    <td data-label="Date & Time"><div>${act.date}</div><div style="font-size: 11px; color: var(--text-muted);">${act.time || ''}</div></td>
                    <td data-label="Activity Type"><span class="badge badge-info">${act.type || 'N/A'}</span></td>
                    <td data-label="Person Met" style="font-weight: 500;">${personMetDisplay || '-'}</td>
                    <td data-label="Status">${statusCellHTML}</td>
                    <td data-label="Result / Purpose"><div style="white-space: normal; overflow-wrap: anywhere;" title="${act.result || ''}"><strong>Res:</strong> ${act.result || '-'}</div><div style="font-size: 11px; color: var(--text-muted); white-space: normal; overflow-wrap: anywhere;" title="${act.nextAction || ''}"><strong>Next:</strong> ${act.nextAction || '-'}</div></td>
                    <td data-label="Photos">${photosHtml}</td>
                    <td data-label="Action"><div class="actions-cell" style="display: flex; gap: 4px;">${actionButtons}</div></td>
                `;
            } else {
                // RENDER GROUPED ACTIVITY ROW
                const key = `${group[0].schoolId}|${group[0].date}`;
                tr.setAttribute('data-group-key', key);

                const firstAct = group[0];
                const allPhotosInGroup = group.flatMap(a => [...(a.photos || []), a.photoOut]).filter(Boolean);
                const totalPhotos = allPhotosInGroup.length;

                const ssName = firstAct.ssName;
                const schoolName = firstAct.schoolName;
                const date = firstAct.date;
                
                const times = group.map(a => a.time).filter(Boolean).sort();
                const timeDisplay = times.length > 1 ? `${times[0]} - ${times[times.length - 1]}` : (times[0] || '');

                const activityTypes = [...new Set(group.map(a => a.type))].join(', ');
                const peopleMet = [...new Set(group.flatMap(a => a.personsMet || (a.personMet ? [a.personMet] : [])))].filter(Boolean).join(', ');

                const resultsSummary = group.map(a => a.result || '').filter(Boolean).join('; ');
                const nextActionsSummary = group.map(a => a.nextAction || '').filter(Boolean).join('; ');
                let resultCellHTML = 'Multiple entries';
                if (resultsSummary || nextActionsSummary) {
                    resultCellHTML = `
                        <div style="white-space: normal; overflow-wrap: anywhere;" title="${resultsSummary}">
                            <strong>Res:</strong> ${resultsSummary || '-'}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted); white-space: normal; overflow-wrap: anywhere;" title="${nextActionsSummary}">
                            <strong>Next:</strong> ${nextActionsSummary || '-'}
                        </div>
                    `;
                }

                let groupStatus = 'Approved';
                if (group.some(a => (a.status || 'Draft') === 'Draft')) groupStatus = 'Draft';
                else if (group.some(a => a.status === 'Submitted')) groupStatus = 'Submitted';
                
                let statusBadgeClass = 'badge-late';
                if (groupStatus === 'Submitted') statusBadgeClass = 'badge-info';
                if (groupStatus === 'Approved') statusBadgeClass = 'badge-present';
                const statusCellHTML = `<span class="badge ${statusBadgeClass}">${groupStatus}</span>`;

                let photosHtml = '<span style="color: var(--text-muted); font-size: 12px;">-</span>';
                if (totalPhotos > 0) {
                    photosHtml = `
                        <button class="photo-thumbnail-btn btn-view-photos" data-group-key="${key}" title="View All Photos">
                            <img src="${allPhotosInGroup[0]}" alt="photo">
                            ${totalPhotos > 1 ? `<span class="badge" style="position: absolute; bottom: -5px; right: -5px; padding: 2px 5px; font-size: 9px;">+${totalPhotos - 1}</span>` : ''}
                        </button>
                    `;
                }

                tr.innerHTML = `
                    <td data-label="Activity ID" style="font-weight: 600;">Grouped (${group.length})</td>
                    <td data-label="Specialist" style="font-weight: 600;">${ssName}</td>
                    <td data-label="School Visited"><div style="font-weight: 600;">${schoolName}</div></td>
                    <td data-label="Date & Time"><div>${date}</div><div style="font-size: 11px; color: var(--text-muted);">${timeDisplay}</div></td>
                    <td data-label="Activity Type"><span class="badge badge-info">${activityTypes}</span></td>
                    <td data-label="Person Met" style="font-weight: 500;">${peopleMet}</td>
                    <td data-label="Status">${statusCellHTML}</td>
                    <td data-label="Result / Purpose">${resultCellHTML}</td>
                    <td data-label="Photos">${photosHtml}</td>
                    <td data-label="Action">
                        <div class="actions-cell">
                            <button class="action-icon-btn btn-view-group" data-group-key="${key}" title="View All Photos">
                                <i class="fa-solid fa-eye"></i>
                            </button>
                        </div>
                    </td>
                `;
            }
            tableBody.appendChild(tr);
        });

        // Add event listeners
        tableBody.querySelectorAll(".clickable-row").forEach(row => {
            row.addEventListener("click", (e) => {
                if (e.target.closest('.actions-cell') || e.target.closest('.btn-view-photos')) {
                    return;
                }

                const activityId = row.getAttribute('data-id');
                const groupKey = row.getAttribute('data-group-key');

                if (groupKey) {
                    const group = groupedActivities.get(groupKey);
                    if (group) await openDarGroupViewModal(group);
                } else if (activityId) {
                    const actObj = state.activities.find(s => s.id === activityId);
                    if (actObj) openDarViewModal(actObj);
                }
            });
        });

        tableBody.querySelectorAll(".btn-view-photos").forEach(btn => {
            btn.addEventListener("click", () => {
                const groupKey = btn.getAttribute('data-group-key');
                const activityId = btn.getAttribute('data-id');

                if (groupKey) {
                    const group = groupedActivities.get(groupKey);
                    if (group) {
                        const virtualActObj = createVirtualActivityFromGroup(group);
                        openLightbox(virtualActObj, 0);
                    }
                } else if (activityId) {
                    const actObj = state.activities.find(a => a.id === activityId);
                    if (actObj) openLightbox(actObj, 0);
                }
            });
        });

        tableBody.querySelectorAll(".btn-view-group").forEach(btn => {
            btn.addEventListener("click", () => {
                const groupKey = btn.getAttribute('data-group-key');
                const group = groupedActivities.get(groupKey);
                if (group) openDarGroupViewModal(group); // This will be async
            });
        });

        tableBody.querySelectorAll(".delete-act-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                if (id && confirm("Are you sure you want to delete this Daily Activity Report log?")) {
                    let acts = await window.EduLearnDB.getActivities();
                    acts = acts.filter(a => a.id !== id);
                    await window.EduLearnDB.saveActivities(acts);
                    showToast("Activity Removed", "Daily fieldwork report has been deleted.", "danger");
                    await renderActivitiesList();
                }
            });
        });

        tableBody.querySelectorAll(".approve-act-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                const activities = await window.EduLearnDB.getActivities(); // Re-fetch for safety
                const index = activities.findIndex(a => a.id === id);
                if (index !== -1) {
                    activities[index].status = 'Approved';
                    await window.EduLearnDB.saveActivities(activities);
                    showToast("Activity Approved", `Activity ${id} has been approved.`, "success");
                    await renderActivitiesList();
                }
            });
        });

        tableBody.querySelectorAll(".reject-act-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.getAttribute("data-id");
                const reason = prompt("Please provide a reason for rejection (this will be added to the remarks).");
                if (reason === null) return; // User cancelled prompt

                const activities = await window.EduLearnDB.getActivities(); // Re-fetch for safety
                const index = activities.findIndex(a => a.id === id);
                if (index !== -1) {
                    activities[index].status = 'Draft';
                    const rejectionRemark = `\n[REJECTED on ${new Date().toISOString().split('T')[0]} by ${state.session.user.name}]: ${reason}`;
                    activities[index].result = rejectionRemark + "\n---\n" + (activities[index].result || '');
                    await window.EduLearnDB.saveActivities(activities);
                    showToast("Activity Rejected", `Activity ${id} has been returned to draft.`, "warning");
                    await renderActivitiesList();
                }
            });
        });
    }

    // ================= DAR DETAILS VIEW MODAL =================

    const darViewModal = document.getElementById("dar-view-modal");
    const btnDarViewClose = document.getElementById("btn-dar-view-close");
    const btnDarViewCancel = document.getElementById("btn-dar-view-cancel");
    const btnDarViewEdit = document.getElementById("btn-dar-view-edit");
    const darGroupViewModal = document.getElementById("dar-group-view-modal");
    const btnDarGroupViewClose = document.getElementById("btn-dar-group-view-close");
    const btnDarGroupViewCancel = document.getElementById("btn-dar-group-view-cancel");

    if (btnDarViewClose) btnDarViewClose.addEventListener("click", closeDarViewModal);
    if (btnDarViewCancel) btnDarViewCancel.addEventListener("click", closeDarViewModal);
    if (btnDarGroupViewClose) btnDarGroupViewClose.addEventListener("click", closeDarViewModal);
    if (btnDarGroupViewCancel) btnDarGroupViewCancel.addEventListener("click", closeDarViewModal);

    function closeDarViewModal() {
        darViewModal?.classList.remove("active");
        darGroupViewModal?.classList.remove("active");
    }

    async function openDarGroupViewModal(group) {
        if (!group || group.length === 0 || !darGroupViewModal) return;
        darGroupViewModal.classList.add("active");

        const firstAct = group[0];
        const content = document.getElementById("dar-group-view-content");
        document.getElementById("dar-group-view-title").textContent = `Grouped Activities for ${firstAct.schoolName}`;
        document.getElementById("dar-group-view-subtitle").textContent = `All entries for ${firstAct.date}`;

        const renderItem = (label, value) => `
            <div class="school-view-item">
                <label>${label}</label>
                <span>${value || '<span style="color: var(--text-muted);">-</span>'}</span>
            </div>
        `;

        let individualActivitiesHtml = '';
        group.forEach((act, index) => {
            const personMetDisplay = (act.personsMet || (act.personMet ? [act.personMet] : [])).filter(Boolean).join(', ');
            individualActivitiesHtml += `
                <div class="school-view-section">
                    <div class="school-view-section-title">Visit #${index + 1} (at ${act.time || 'N/A'})</div>
                    <div class="school-view-grid" style="grid-template-columns: 1fr 1fr;">
                        ${renderItem("Activity Type", act.type)}
                        ${renderItem("Person(s) Met", personMetDisplay)}
                    </div>
                    <div class="school-view-grid" style="grid-template-columns: 1fr; margin-top: 16px;">
                         ${renderItem("Activity Title / Purpose", act.result)}
                         ${renderItem("Description / Remarks", act.nextAction)}
                    </div>
                </div>
            `;
        });

        const virtualActObj = createVirtualActivityFromGroup(group);
        const photosHtml = await createPhotoSection('All Photo Verifications', virtualActObj.photos, virtualActObj.locations, virtualActObj.date);

        content.innerHTML = individualActivitiesHtml + photosHtml;
    }

    const createPhotoSection = (title, photos, locations, baseDate) => {
        if (!photos || photos.length === 0) {
            return `<div class="school-view-section">
                <div class="school-view-section-title">${title}</div>
                <p style="font-size: 13px; color: var(--text-muted);">No photos attached to this activity.</p>
            </div>`;
        }

        const renderItem = (label, value) => `
            <div class="school-view-item">
                <label>${label}</label>
                <span>${value || '<span style="color: var(--text-muted);">-</span>'}</span>
            </div>
        `;

        let photosHtml = `<div class="school-view-section"><div class="school-view-section-title">${title}</div>`;

        photos.forEach((photoUrl, index) => {
            const location = locations[index] || {};
            const timestamp = new Date(location.timestamp || baseDate);
            const mapsLink = (location.latitude && location.longitude)
                ? `https://www.google.com/maps?q=${location.latitude},${location.longitude}`
                : '#';

            photosHtml += `
                <div class="school-view-grid" style="grid-template-columns: 100px 1fr; gap: 24px; align-items: flex-start; ${index > 0 ? 'border-top: 1px solid var(--border-color); padding-top: 16px; margin-top: 16px;' : ''}">
                    <div>
                        <a href="${photoUrl}" target="_blank" title="View full image">
                            <img src="${photoUrl}" style="width: 100px; height: 100px; object-fit: cover; border-radius: var(--border-radius-sm);">
                        </a>
                    </div>
                    <div class="school-view-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
                        ${renderItem("Time Captured", timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}
                        ${renderItem("Date Captured", timestamp.toISOString().split('T')[0])}
                        ${renderItem("Location Address", location.address || 'N/A')}
                        <div class="school-view-item">
                            <label>GPS Coordinates</label>
                            <span>
                                ${(location.latitude && location.longitude)
                                    ? `<a href="${mapsLink}" target="_blank" title="View on Google Maps">${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)} <i class="fa-solid fa-external-link-alt" style="font-size: 10px;"></i></a>`
                                    : 'N/A'
                                }
                            </span>
                        </div>
                    </div>
                </div>
            `;
        });

        photosHtml += '</div>';
        return photosHtml;
    }

    async function openDarViewModal(actObj) {
        if (!actObj || !darViewModal) return;
        darViewModal.classList.add("active");

        const content = document.getElementById("dar-view-content");
        document.getElementById("dar-view-title").textContent = `Activity: ${actObj.id}`;
        document.getElementById("dar-view-subtitle").textContent = `${actObj.schoolName} on ${actObj.date}`;

        const personMetDisplay = (actObj.personsMet || (actObj.personMet ? [actObj.personMet] : [])).filter(Boolean).join(', ');
        const status = actObj.status || 'Draft';
        const statusBadgeClass = status === 'Approved' ? 'badge-present' : (status === 'Submitted' ? 'badge-info' : 'badge-late');

        const renderItem = (label, value) => `
            <div class="school-view-item">
                <label>${label}</label>
                <span>${value || '<span style="color: var(--text-muted);">-</span>'}</span>
            </div>
        `;

        const timeInPhoto = actObj.photos?.[0];
        const timeInLocation = actObj.locations?.[0];
        const visitPhotos = actObj.photos?.slice(1) || [];
        const visitLocations = actObj.locations?.slice(1) || [];
        const timeOutPhoto = actObj.photoOut;
        const timeOutLocation = actObj.locationOut;

        let photosHtml = await createPhotoSection('Time In Verification', timeInPhoto ? [timeInPhoto] : [], timeInLocation ? [timeInLocation] : [], actObj.date);
        if (visitPhotos.length > 0) {
            photosHtml += await createPhotoSection('Visit Photos', visitPhotos, visitLocations, actObj.date);
        }
        photosHtml += await createPhotoSection('Time Out Verification', timeOutPhoto ? [timeOutPhoto] : [], timeOutLocation ? [timeOutLocation] : [], actObj.date);

        content.innerHTML = `
            <div class="school-view-section">
                <div class="school-view-section-title">Activity Information</div>
                <div class="school-view-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));">
                    ${renderItem("Status", `<span class="badge ${statusBadgeClass}">${status}</span>`)}
                    ${renderItem("Specialist", actObj.ssName)}
                    ${renderItem("Activity Type", actObj.type)}
                    ${renderItem("Person Met", personMetDisplay)}
                    ${renderItem("Product Discussed", actObj.productDiscussed)}
                    ${renderItem("Next Follow-Up", actObj.nextFollowUp)}
                </div>
                <div class="school-view-grid" style="grid-template-columns: 1fr; margin-top: 16px;">
                    ${renderItem("Purpose / Result", actObj.result)}
                    ${renderItem("Next Action", actObj.nextAction)}
                </div>
            </div>
            ${photosHtml}
        `;

        if (btnDarViewEdit) {
            const canEdit = (status === 'Draft' && actObj.ssId === state.session.user.id);
            btnDarViewEdit.style.display = canEdit ? 'inline-flex' : 'none';
            if (canEdit) {
                btnDarViewEdit.onclick = () => {
                    closeDarViewModal();
                    openDarModal(actObj);
                };
            }
        }
    }

    // ================= PHOTO LIGHTBOX CONTROLLER =================

    const lightbox = document.getElementById("photo-lightbox");
    const btnLightboxClose = document.getElementById("btn-lightbox-close");

    if (btnLightboxClose) btnLightboxClose.addEventListener("click", () => lightbox.classList.remove("active"));

    function openLightbox(actObj, startIndex = 0) {
        if (!actObj) return;
    
        // Compile all photos into one array
        const allPhotos = [...(actObj.photos || [])];
        if (actObj.photoOut) {
            allPhotos.push(actObj.photoOut);
        }
    
        // Compile all locations
        const allLocations = [...(actObj.locations || [])];
        if (actObj.locationOut) {
            allLocations.push(actObj.locationOut);
        }
    
        if (allPhotos.length === 0) return;

        lightbox.classList.add("active");
        
        let currentIndex = startIndex;
        const navContainer = document.getElementById('lightbox-nav-container');
        const prevBtn = document.getElementById('lightbox-prev');
        const nextBtn = document.getElementById('lightbox-next');
    
        const updateLightboxContent = () => {
            document.getElementById("lightbox-title").textContent = `Verification Photo (${currentIndex + 1} of ${allPhotos.length})`;
            document.getElementById("lightbox-subtitle").textContent = `${actObj.ssName || ''} - ${actObj.schoolName || ''}`;
            document.getElementById("lightbox-img").src = allPhotos[currentIndex];
            
            const location = allLocations[currentIndex] || { address: "Location unavailable", latitude: null, longitude: null, timestamp: actObj.date };
            const photoTimestamp = new Date(location.timestamp || actObj.date);
    
            let typeLabel = "Visit Photo";
            if (currentIndex === 0 && (actObj.photos || []).length > 0) {
                typeLabel = "Time In";
            } else if (actObj.photoOut && allPhotos[currentIndex] === actObj.photoOut) {
                typeLabel = "Time Out";
            }
    
            document.getElementById("lightbox-label-type").textContent = `${typeLabel}:`;
            document.getElementById("lightbox-time").textContent = photoTimestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            document.getElementById("lightbox-date").textContent = photoTimestamp.toISOString().split('T')[0];
            document.getElementById("lightbox-location").textContent = location.address;
            const coordsText = (location.latitude && location.longitude) ? `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}` : "N/A";
            document.getElementById("lightbox-coordinates").textContent = coordsText;
    
            if (navContainer) {
                navContainer.style.display = allPhotos.length > 1 ? 'flex' : 'none';
            }
        };
    
        // Use cloneNode to remove previous listeners before adding new ones
        const newPrevBtn = prevBtn.cloneNode(true);
        prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
        newPrevBtn.addEventListener('click', () => {
            currentIndex = (currentIndex - 1 + allPhotos.length) % allPhotos.length;
            updateLightboxContent();
        });
    
        const newNextBtn = nextBtn.cloneNode(true);
        nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
        newNextBtn.addEventListener('click', () => {
            currentIndex = (currentIndex + 1) % allPhotos.length;
            updateLightboxContent();
        });
    
        updateLightboxContent();
    }

    function getSchoolIdFromName(name, datalistId) {
        const datalist = document.getElementById(datalistId);
        if (!datalist) return null;
        for (let i = 0; i < datalist.options.length; i++) {
            const option = datalist.options[i];
            if (option.value === name) {
                return option.getAttribute("data-id");
            }
        }
        return null; // Return null if it's a new school name not in the list
    }

    darForm?.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (state.darPhotos.length === 0 && !state.darPhotoOut) {
            showToast("Field Validation Blocked", "Please attach at least one verification photo.", "warning");
            return;
        }

        const schoolName = document.getElementById("dar-school").value;
        const schoolId = getSchoolIdFromName(schoolName, 'dar-school-list');

        if (!schoolId) {
            showToast("Invalid School", "Please select a valid school from the list.", "warning");
            return;
        }

        const personsMet = Array.from(document.querySelectorAll('.dar-contact-input'))
            .map(input => input.value.trim())
            .filter(Boolean);

        if (personsMet.length === 0) {
            showToast("Invalid Input", "Please enter at least one person met.", "warning");
            return;
        }
        const activities = await window.EduLearnDB.getActivities();
        const activityId = document.getElementById("dar-form-id").value;
        const now = new Date();

        const activityData = {
            ssId: state.session.user.id,
            ssName: state.session.user.name,
            schoolId,
            schoolName: schoolName,
            type: document.getElementById("dar-type").value,
            personsMet: personsMet,
            personMet: personsMet[0], // For backward compatibility
            productDiscussed: document.getElementById("dar-product").value,
            result: document.getElementById("dar-result").value,
            nextAction: document.getElementById("dar-next-action").value,
            nextFollowUp: document.getElementById("dar-followup-date").value,
            remarks: "", // Remarks field not in form, keeping it
            photos: state.darPhotos,
            locations: state.darPhotoLocations,
            photoOut: state.darPhotoOut,
            locationOut: state.darLocationOut,
        };

        if (activityId) {
            // Update existing activity
            const index = activities.findIndex(a => a.id === activityId);
            if (index !== -1) {
                if (activities[index].status && activities[index].status !== 'Draft') {
                    showToast("Edit Locked", "This activity has been submitted and can no longer be edited.", "danger");
                    closeDarModal();
                    return;
                }
                activities[index] = {
                    ...activities[index], // Preserve original date/time and status
                    ...activityData
                };
                await window.EduLearnDB.saveActivities(activities);
                showToast("Draft Updated", `Visit to ${schoolName} has been updated.`, "success");
            }
        } else {
            // Create new activity
            const nextId = `ACT-${Math.floor(Math.random() * 9000) + 1000}`;
            activities.push({
                id: nextId,
                ...activityData,
                date: now.toISOString().split('T')[0],
                time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                status: 'Draft'
            });
            await window.EduLearnDB.saveActivities(activities);
            showToast("Activity Draft Saved", `Visit to ${schoolName} has been saved as a draft.`, "success");
        }

        closeDarModal();
        await navigateTo('activities');
    });

    const btnMarkLogout = document.getElementById('btn-mark-logout');
    if (btnMarkLogout) {
        btnMarkLogout.addEventListener('click', () => {
            if (state.darPhotoOut) {
                // Un-mark: move it back to the main array
                state.darPhotos.push(state.darPhotoOut);
                state.darPhotoLocations.push(state.darLocationOut);
                state.darPhotoOut = null;
                state.darLocationOut = null;
            } else if (state.darPhotos.length > 0) {
                // Mark: pop the last one
                state.darPhotoOut = state.darPhotos.pop();
                state.darLocationOut = state.darPhotoLocations.pop();
            }
            renderPhotoPreviews();
            updateSnapButtonState();
        });
    }

    async function renderPayroll() {
        await refreshData();
        const tableBody = document.getElementById("payroll-table-body");
        if (!tableBody) return;

        const { role } = getSessionContext();
        const allowedRoles = ["System Administrator", "President / CEO", "Finance / Collections", "Human Resource"];
        if (!allowedRoles.includes(role)) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 40px;">
                        <i class="fa-solid fa-lock" style="font-size: 32px; margin-bottom: 12px;"></i>
                        <p>You do not have access to payroll records.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = "";
        state.payroll.forEach(item => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="font-family: monospace; font-weight: 700; color: var(--text-muted);">${item.id}</td>
                <td>${item.employeeName}</td>
                <td>${item.role}</td>
                <td>${item.payPeriod}</td>
                <td>₱${(item.monthlySalary || 0).toLocaleString()}</td>
                <td>₱${(item.allowance || 0).toLocaleString()}</td>
                <td>₱${(item.netPay || 0).toLocaleString()}</td>
                <td><span class="badge ${item.status === 'Processed' ? 'badge-present' : 'badge-warning'}">${item.status}</span></td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // ================= CONFIGURATION PORTALS =================

    const btnResetDB = document.getElementById("btn-reset-db");
    const btnClearDB = document.getElementById("btn-clear-db");

    async function loadSettingsView() {
        await renderUserAccounts();
    }

    if (btnResetDB) {
        btnResetDB.addEventListener("click", async () => {
            if (confirm("Reset current CRM records back to default initial demo database? All current deals and activities will be overwritten.")) {
                stopCameras();
                localStorage.removeItem("edu_users");
                localStorage.removeItem("edu_schools");
                localStorage.removeItem("edu_deals");
                localStorage.removeItem("edu_activities");

                await window.EduLearnDB.init();
                await refreshData();
                showToast("System Re-seeded", "Database restored to baseline credentials.", "success");

                await refreshActiveView();
            }
        });
    }

    if (btnClearDB) {
        btnClearDB.addEventListener("click", async () => {
            if (confirm("Wipe all local storage cache records? Warning: This removes active portal profiles.")) {
                stopCameras();
                localStorage.clear();
                await window.EduLearnDB.init();
                await refreshData();
                showToast("Wiped Complete", "Cache database format complete.", "danger");

                btnLogout.click();
            }
        });
    }
})();
