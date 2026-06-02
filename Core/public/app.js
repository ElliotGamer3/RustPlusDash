// ─── App state ────────────────────────────────────────────────────────────────
const app = {
    snapshot: null,
    activeTab: 'overview',
    selectedStorageGroupId: null,
    groupEditorModes: new Set()
};

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(path, method = 'GET', body) {
    const opts = { method };
    if (body !== undefined) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
}

function toast(msg, isError = true) {
    const el = document.createElement('div');
    el.style.cssText = `
        position:fixed;bottom:20px;right:20px;z-index:9999;max-width:360px;
        padding:10px 16px;border-radius:8px;font-size:0.86rem;font-weight:600;
        box-shadow:0 4px 14px rgba(0,0,0,0.22);
        background:${isError ? '#9e1d20' : '#2d6b55'};color:#fff;
    `;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}

function guard(fn) {
    return async (...args) => {
        try { await fn(...args); }
        catch (err) { toast(err.message); }
    };
}

function esc(str) {
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtTime(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleTimeString(); } catch { return iso; }
}

// ─── Accessors ────────────────────────────────────────────────────────────────
const sid  = () => app.snapshot?.settings?.activeServerId;
const devs = (type) => (app.snapshot?.devices  || []).filter(d => d.serverId === sid() && (!type || d.type === type));
const grps = (type) => (app.snapshot?.groups   || []).filter(g => g.serverId === sid() && (!type || g.type === type));
const conn = (id)   => (app.snapshot?.connectionStates || []).find(c => c.serverId === (id ?? sid()));

// ─── Tab switching ────────────────────────────────────────────────────────────
document.addEventListener('click', (event) => {
    const tabButton = event.target.closest('.tab-btn');
    if (!tabButton) {
        return;
    }

    event.preventDefault();
    document.querySelectorAll('.tab-btn').forEach((button) => button.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((pane) => pane.classList.remove('active'));
    tabButton.classList.add('active');

    const tabPane = document.getElementById(`tab-${tabButton.dataset.tab}`);
    if (!tabPane) {
        return;
    }

    tabPane.classList.add('active');
    app.activeTab = tabButton.dataset.tab;
    if (tabButton.dataset.tab === 'storage' && app.selectedStorageGroupId) {
        loadStorageMetrics(app.selectedStorageGroupId);
    }
});

// ─── Main render ──────────────────────────────────────────────────────────────
function render(snapshot) {
    app.snapshot = snapshot;
    renderTopbar();
    renderOverview();
    renderSwitches();
    renderCameras();
    renderAlarms();
    renderAutomation();
    renderSettings();
    renderGroupEditors(); // Selects driven by state
    refreshStorageGroupSelect();
    refreshRotationGroupSelect();
    refreshAlarmGroupSelect();
    refreshReqGroupSelect();
    refreshGroupDeviceChecklist();
}

// ─── Topbar ───────────────────────────────────────────────────────────────────
function renderTopbar() {
    const sel = document.getElementById('server-select');
    const cur = sel.value || sid();
    sel.innerHTML = '';
    (app.snapshot?.servers || []).forEach(s => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.name;
        o.selected = s.id === cur;
        sel.appendChild(o);
    });
    if (!sel.value) sel.value = sid() ?? '';

    const c = conn();
    const dot = document.getElementById('conn-dot');
    dot.className = `status-dot ${c?.status || ''}`;
    dot.title = `${c?.status || 'idle'}${c?.lastError ? ' — ' + c.lastError : ''}`;
}

// ─── Overview ─────────────────────────────────────────────────────────────────
function renderOverview() {
    const switches = devs('switch');
    const onCt  = switches.filter(d => d.lastKnownState === true).length;
    const offCt = switches.filter(d => d.lastKnownState === false).length;
    document.getElementById('ov-switch-count').textContent = switches.length;
    document.getElementById('ov-switch-detail').innerHTML =
        `<span style="color:var(--green)">&#9679; ${onCt} on</span>` +
        `<span>&#9679; ${offCt} off</span>`;

    const allDevs = devs();
    document.getElementById('ov-device-count').textContent = allDevs.length;
    const byType = {};
    allDevs.forEach(d => { byType[d.type] = (byType[d.type] || 0) + 1; });
    document.getElementById('ov-device-detail').innerHTML =
        Object.entries(byType).map(([t,n]) => `<span>${n} ${esc(t)}</span>`).join('') || '<span>None</span>';

    const allGrps = grps();
    document.getElementById('ov-group-count').textContent = allGrps.length;
    const byGtype = {};
    allGrps.forEach(g => { byGtype[g.type] = (byGtype[g.type] || 0) + 1; });
    document.getElementById('ov-group-detail').innerHTML =
        Object.entries(byGtype).map(([t,n]) => `<span>${n} ${esc(t)}</span>`).join('') || '<span>None</span>';

    // Notifications
    const notifs = (app.snapshot?.notifications || []).slice(-60).reverse();
    document.getElementById('ov-notif-count').textContent = notifs.length;
    const feed = document.getElementById('ov-notif-feed');
    if (!notifs.length) {
        feed.innerHTML = '<div class="empty">No notifications yet</div>';
    } else {
        feed.innerHTML = notifs.map(n => `
            <div class="notif-item ${esc(n.category || '')}">
                <div style="display:flex;justify-content:space-between;gap:8px;">
                    <strong>${esc(n.message || n.category)}</strong>
                    <span style="color:var(--muted);font-size:0.74rem;white-space:nowrap;">${fmtTime(n.timestamp)}</span>
                </div>
            </div>`).join('');
    }

    // Request queue
    const requests = app.snapshot?.requestStates || [];
    const qEl = document.getElementById('ov-queue');
    qEl.innerHTML = requests.length
        ? requests.map(r => `<span>${esc(String(r.serverId ?? ''))}: ${r.queued ?? 0} queued</span>`).join('')
        : '<span>No requests queued</span>';
}

// ─── Switches ─────────────────────────────────────────────────────────────────
function statePill(d) {
    if (d.lastKnownState === true)  return '<span class="pill on">On</span>';
    if (d.lastKnownState === false) return '<span class="pill off">Off</span>';
    return '<span class="pill unknown">?</span>';
}

function renderSwitches() {
    const switches = devs('switch');
    const switchGroups = grps('switch-group');
    const sc = document.getElementById('switch-cards');
    sc.innerHTML = switches.length ? switches.map(d => `
        <div class="dcard">
            <div class="dcard-head">
                <span class="dcard-name" id="dname-${esc(d.id)}">${esc(d.name || d.type)}</span>
                ${statePill(d)}
                <button class="icon-btn" data-action="device-rename" data-device-id="${esc(d.id)}" title="Rename">&#9998;</button>
            </div>
            <div class="toggle-wrap">
                <label class="toggle">
                    <input type="checkbox" data-action="switch-toggle" data-device-id="${esc(d.id)}"
                        ${d.lastKnownState === true ? 'checked' : ''} />
                    <span class="toggle-track"></span>
                </label>
                <span class="dcard-sub">entity ${esc(d.entityId || '—')}</span>
            </div>
            <div class="check-list group-device-list switch-group-memberships">
                ${switchGroups.length ? switchGroups.map((group) => {
                    const isMember = (group.deviceIds || []).includes(d.id);
                    return `
                        <label>
                            <input type="checkbox" data-action="switch-group-toggle" data-group-id="${esc(group.id)}" data-device-id="${esc(d.id)}" ${isMember ? 'checked' : ''} />
                            ${esc(group.name)}
                            <span class="hint">switch group</span>
                        </label>`;
                }).join('') : '<span class="hint">No switch groups created yet</span>'}
            </div>
            <div class="dcard-actions">
                <button class="danger" data-action="device-delete" data-device-id="${esc(d.id)}">Remove</button>
            </div>
        </div>`).join('')
        : '<div class="empty">No switches registered. Add one in Settings.</div>';

    const sgc = document.getElementById('switch-group-cards');
    sgc.innerHTML = switchGroups.length ? switchGroups.map(g => `
        <div class="dcard">
            <div class="dcard-head">
                <span class="dcard-name">${esc(g.name)}</span>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <span class="pill on">${g.onCount || 0} on</span>
                <span class="pill off">${g.offCount || 0} off</span>
                ${g.unknownCount ? `<span class="pill unknown">${g.unknownCount} ?</span>` : ''}
            </div>
            <div class="dcard-sub">${g.deviceIds.length} device${g.deviceIds.length !== 1 ? 's' : ''}</div>
            <div class="dcard-actions">
                <button class="primary" data-action="group-on"     data-group-id="${esc(g.id)}">All On</button>
                <button                 data-action="group-off"    data-group-id="${esc(g.id)}">All Off</button>
                <button class="danger"  data-action="group-delete" data-group-id="${esc(g.id)}">Remove</button>
            </div>
        </div>`).join('')
        : '<div class="empty">No switch groups. Create one in Settings.</div>';
}

// ─── Cameras ──────────────────────────────────────────────────────────────────
function renderCameras() {
    const cameras = [...devs('camera'), ...devs('turret')];
    const cc = document.getElementById('camera-cards');
    cc.innerHTML = cameras.length ? cameras.map(d => {
        const subscribed = d.metadata?.subscribed;
        const subscribeError = d.metadata?.subscribeError;
        const statusClass = subscribed ? 'live' : subscribeError ? 'alert' : 'off';
        const statusText = subscribed ? 'Live' : subscribeError ? 'Error' : 'Idle';
        return `
        <div class="dcard">
            <div class="dcard-head">
                <span class="dcard-name" id="dname-${esc(d.id)}">${esc(d.name || d.type)}</span>
                <span class="pill ${statusClass}">${statusText}</span>
                <button class="icon-btn" data-action="device-rename" data-device-id="${esc(d.id)}" title="Rename">&#9998;</button>
            </div>
            <div class="dcard-sub">${esc(d.type)} &middot; cam id: ${esc(d.cameraId || '—')}${subscribeError ? ` &middot; ${esc(subscribeError)}` : ''}</div>
            <div class="dcard-actions">
                <button data-action="camera-subscribe" data-device-id="${esc(d.id)}">
                    ${subscribed ? 'Re-subscribe' : subscribeError ? 'Retry Subscribe' : 'Subscribe'}
                </button>
                ${subscribed ? `
                <button data-action="camera-shoot"  data-device-id="${esc(d.id)}" title="Shoot">&#127919;</button>
                <button data-action="camera-reload" data-device-id="${esc(d.id)}" title="Reload">&#8635;</button>
                <button data-action="camera-zoom"   data-device-id="${esc(d.id)}" title="Zoom">&#128269;</button>
                ` : ''}
                <button class="danger" data-action="device-delete" data-device-id="${esc(d.id)}">Remove</button>
            </div>
        </div>`;
    }).join('')
        : '<div class="empty">No cameras or turrets registered. Add one in Settings.</div>';
}

function refreshRotationGroupSelect() {
    const sel = document.getElementById('rotation-group-select');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— No camera/turret groups yet —</option>';
    [...grps('camera-group'), ...grps('turret-group')].forEach(g => {
        const o = document.createElement('option');
        o.value = g.id;
        o.textContent = `${g.name} (${g.type.replace('-group', '')})`;
        o.selected = g.id === cur;
        sel.appendChild(o);
    });
    updateRotationDeviceSelect();
}

function updateRotationDeviceSelect() {
    const groupId = document.getElementById('rotation-group-select').value;
    const dsel    = document.getElementById('rotation-device-select');
    if (!groupId) {
        dsel.innerHTML = '<option value="">— Pick a group first —</option>';
        return;
    }
    const group = (app.snapshot?.groups || []).find(g => g.id === groupId);
    const members = group
        ? (app.snapshot?.devices || []).filter(d => group.deviceIds.includes(d.id))
        : [];
    dsel.innerHTML = '<option value="">— Select camera —</option>';
    members.forEach(d => {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = d.name || d.type;
        dsel.appendChild(o);
    });
}

// ─── Storage ──────────────────────────────────────────────────────────────────
function refreshStorageGroupSelect() {
    const sel = document.getElementById('storage-group-select');
    const cur = sel.value || app.selectedStorageGroupId;
    sel.innerHTML = '<option value="">— Select a group —</option>';
    grps('storage-group').forEach(g => {
        const o = document.createElement('option');
        o.value = g.id;
        o.textContent = g.name;
        o.selected = g.id === cur;
        sel.appendChild(o);
    });
}

async function loadStorageMetrics(groupId) {
    const el = document.getElementById('storage-content');
    if (!groupId) {
        el.innerHTML = '<div class="empty" style="grid-column:1/-1;">Select a storage group above to view metrics</div>';
        return;
    }
    try {
        const m = await api(`/api/groups/${groupId}/storage/metrics`);
        renderStorageMetrics(m);
    } catch (err) {
        el.innerHTML = `<div class="empty" style="grid-column:1/-1;color:var(--red);">${esc(err.message)}</div>`;
    }
}

function renderStorageMetrics(m) {
    const el = document.getElementById('storage-content');
    const items = m.grandTotal || [];
    const rows = items.length
        ? items.map(i => `<tr>
            <td>${esc(i.itemId)}</td>
            <td>${esc(i.category)}</td>
            <td class="num">${Number(i.quantity).toLocaleString()}</td>
          </tr>`).join('')
        : '<tr><td colspan="3" style="text-align:center;color:var(--muted);padding:18px;">No items tracked</td></tr>';

    const subtotalsHtml = (m.subtotals || []).length
        ? (m.subtotals || []).map(s => `
            <div style="margin-bottom:12px;">
                <strong style="font-size:0.88rem;">${esc(s.name)}</strong>
                <table class="data-table" style="margin-top:6px;">
                    <tbody>
                        ${(s.total || []).slice(0, 8).map(i => `
                        <tr>
                            <td>${esc(i.itemId)}</td>
                            <td class="num">${Number(i.quantity).toLocaleString()}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`).join('')
        : '<div class="empty">No subtotals configured</div>';

    el.innerHTML = `
        <div class="card">
            <h2 style="margin-bottom:12px;">Grand Total</h2>
            <table class="data-table">
                <thead><tr><th>Item</th><th>Category</th><th class="num">Qty</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <div class="card">
            <h2 style="margin-bottom:12px;">Subtotals</h2>
            ${subtotalsHtml}
        </div>`;
}

// ─── Alarms ───────────────────────────────────────────────────────────────────
function renderAlarms() {
    const alarms = devs('alarm');
    const ac = document.getElementById('alarm-cards');
    ac.innerHTML = alarms.length ? alarms.map(d => `
        <div class="dcard">
            <div class="dcard-head">
                <span class="dcard-name" id="dname-${esc(d.id)}">${esc(d.name || d.type)}</span>
                ${d.lastKnownState
                    ? '<span class="pill alert">&#9888; Triggered</span>'
                    : '<span class="pill off">Quiet</span>'}
                <button class="icon-btn" data-action="device-rename" data-device-id="${esc(d.id)}" title="Rename">&#9998;</button>
            </div>
            <div class="dcard-sub">entity ${esc(d.entityId || '—')}</div>
            <div class="dcard-actions">
                <button class="danger" data-action="device-delete" data-device-id="${esc(d.id)}">Remove</button>
            </div>
        </div>`).join('')
        : '<div class="empty">No alarm devices registered. Add one in Settings.</div>';
}

function renderGroupEditors() {
    const configs = [
        {
            containerId: 'switch-group-cards',
            emptyText: 'No switch groups. Create one in Settings.',
            groupType: 'switch-group',
            deviceTypes: ['switch']
        },
        {
            containerId: 'camera-group-cards',
            emptyText: 'No camera groups yet. Create one in Settings.',
            groupType: 'camera-group',
            deviceTypes: ['camera']
        },
        {
            containerId: 'turret-group-cards',
            emptyText: 'No turret groups yet. Create one in Settings.',
            groupType: 'turret-group',
            deviceTypes: ['turret']
        },
        {
            containerId: 'storage-group-cards',
            emptyText: 'No storage groups yet. Create one in Settings.',
            groupType: 'storage-group',
            deviceTypes: ['storage-monitor']
        },
        {
            containerId: 'alarm-group-cards',
            emptyText: 'No alarm groups yet. Create one in Settings.',
            groupType: 'alarm-group',
            deviceTypes: ['alarm']
        }
    ];

    configs.forEach((config) => {
        const el = document.getElementById(config.containerId);
        if (!el) {
            return;
        }

        const groups = grps(config.groupType);
        if (!groups.length) {
            el.innerHTML = `<div class="empty">${esc(config.emptyText)}</div>`;
            return;
        }

        el.innerHTML = groups.map((group) => renderGroupEditorCard(group, config.deviceTypes)).join('');
    });
}

function renderGroupEditorCard(group, deviceTypes) {
    const availableDevices = group.type === 'switch-group'
        ? []
        : deviceTypes.flatMap((type) => devs(type));
    const selected = new Set(group.deviceIds || []);
    const selectedCount = group.type === 'switch-group'
        ? devs('switch').filter((device) => selected.has(device.id)).length
        : availableDevices.filter((device) => selected.has(device.id)).length;
    const deviceCount = group.type === 'switch-group'
        ? devs('switch').length
        : availableDevices.length;
    const isEditing = app.groupEditorModes.has(group.id);

    return `
        <div class="dcard group-editor ${isEditing ? 'is-editing' : ''}" data-group-id="${esc(group.id)}">
            <div class="dcard-head group-editor-head">
                <div class="group-editor-summary">
                    <span class="dcard-name">${esc(group.name)}</span>
                    <span class="pill ${selectedCount ? 'on' : 'off'}">${selectedCount}/${deviceCount} selected</span>
                </div>
                <div class="dcard-actions group-editor-header-actions">
                    ${group.type === 'switch-group' ? `
                    <button type="button" data-action="group-on" data-group-id="${esc(group.id)}">All On</button>
                    <button type="button" data-action="group-off" data-group-id="${esc(group.id)}">All Off</button>
                    ` : ''}
                    <button type="button" data-action="group-edit" data-group-id="${esc(group.id)}" ${isEditing ? 'disabled' : ''}>Edit Group</button>
                    <button type="button" class="danger" data-action="group-delete" data-group-id="${esc(group.id)}">Remove</button>
                </div>
            </div>
            <div class="dcard-sub">${group.type === 'switch-group' ? 'Rename the group here. Switch membership is edited from each switch card.' : 'Pick the devices that belong to this group. Changes persist when saved.'}</div>
            <div class="group-editor-body">
                <label class="field group-name-field">
                    Group name
                    <input type="text" name="groupName" value="${esc(group.name)}" data-group-name="${esc(group.id)}" ${isEditing ? '' : 'disabled'} />
                </label>
                ${group.type === 'switch-group' ? '' : `
                <div class="check-list group-device-list">
                ${availableDevices.length ? availableDevices.map((device) => `
                    <label>
                        <input type="checkbox" name="groupDevice" value="${esc(device.id)}" ${selected.has(device.id) ? 'checked' : ''} ${isEditing ? '' : 'disabled'} />
                        ${esc(device.name || device.type)}
                        <span class="hint">${esc(device.entityId || device.cameraId || '')}</span>
                    </label>
                `).join('') : '<span class="hint">No matching devices registered</span>'}
                </div>`}
                <div class="dcard-actions group-editor-edit-actions">
                    <button class="primary" type="button" data-action="group-save" data-group-id="${esc(group.id)}" ${isEditing ? '' : 'disabled'}>Save Group</button>
                    <button type="button" data-action="group-cancel" data-group-id="${esc(group.id)}" ${isEditing ? '' : 'disabled'}>Cancel</button>
                </div>
            </div>
        </div>`;
}

function refreshAlarmGroupSelect() {
    const sel = document.getElementById('alarm-group-select');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— No alarm groups yet —</option>';
    grps('alarm-group').forEach(g => {
        const o = document.createElement('option');
        o.value = g.id;
        o.textContent = g.name;
        o.selected = g.id === cur;
        sel.appendChild(o);
    });
    updateAlarmExclusionList();
}

function updateAlarmExclusionList() {
    const groupId = document.getElementById('alarm-group-select').value;
    const list    = document.getElementById('alarm-exclusion-list');
    if (!groupId) {
        list.innerHTML = '<span class="hint">Select a group first</span>';
        return;
    }
    const group   = (app.snapshot?.groups  || []).find(g => g.id === groupId);
    const members = (app.snapshot?.devices || []).filter(d =>
        group?.deviceIds.includes(d.id) && d.type === 'alarm'
    );
    const excluded = new Set(group?.config?.consolidation?.excludedDeviceIds || []);
    list.innerHTML = members.length
        ? members.map(d => `
            <label>
                <input type="checkbox" name="excludedDevice" value="${esc(d.id)}"
                    ${excluded.has(d.id) ? 'checked' : ''} />
                ${esc(d.name)}
            </label>`).join('')
        : '<span class="hint">No alarm devices in this group</span>';
}

// ─── Automation ───────────────────────────────────────────────────────────────
function renderAutomation() {
    const reqs = app.snapshot?.requirements || [];
    const el   = document.getElementById('requirement-cards');
    if (!reqs.length) {
        el.innerHTML = '<div class="empty">No requirements configured</div>';
        return;
    }
    const allGroups = app.snapshot?.groups || [];
    el.innerHTML = reqs.map(r => {
        const g = allGroups.find(x => x.id === r.groupId);
        const gName = g ? g.name : (r.groupId || '?');
        const t = r.target || {};
        const c = r.condition || {};
        const scope = t.scope === 'item'
            ? esc(t.itemId)
            : t.scope === 'category'
                ? `${esc(t.category)} (cat)`
                : 'total';
        const actionList = (r.actions || []).map(a => esc(a.type)).join(', ') || 'none';
        return `
        <div class="dcard">
            <div class="dcard-head">
                <span class="dcard-name">${esc(gName)}: ${scope} ${esc(c.operator || '')} ${c.value ?? ''}</span>
                <span class="pill ${r.enabled === false ? 'off' : 'on'}">${r.enabled === false ? 'Off' : 'On'}</span>
            </div>
            <div class="dcard-sub">Actions: ${actionList}</div>
            <div class="dcard-actions">
                <button class="danger" data-action="requirement-delete" data-requirement-id="${esc(r.id)}">Delete</button>
            </div>
        </div>`;
    }).join('');
}

function refreshReqGroupSelect() {
    const sel = document.getElementById('req-group-select');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Select group —</option>';
    grps('storage-group').forEach(g => {
        const o = document.createElement('option');
        o.value = g.id;
        o.textContent = g.name;
        o.selected = g.id === cur;
        sel.appendChild(o);
    });
}

async function saveGroupEditor(groupId, triggerBtn) {
    const card = triggerBtn.closest('.group-editor');
    if (!card) {
        return;
    }

    const nameInput = card.querySelector('[data-group-name]');
    const name = String(nameInput?.value || '').trim();
    if (!name) {
        throw new Error('Group name is required');
    }
    const deviceIds = Array.from(card.querySelectorAll('input[name="groupDevice"]:checked')).map((cb) => cb.value);

    await api(`/api/groups/${groupId}`, 'PATCH', {
        name,
        deviceIds
    });
}

async function toggleSwitchGroupMembership(groupId, deviceId, checked) {
    const group = (app.snapshot?.groups || []).find((item) => item.id === groupId);
    if (!group) {
        throw new Error(`Unknown group: ${groupId}`);
    }

    const nextDeviceIds = new Set(group.deviceIds || []);
    if (checked) {
        nextDeviceIds.add(deviceId);
    } else {
        nextDeviceIds.delete(deviceId);
    }

    await api(`/api/groups/${groupId}`, 'PATCH', {
        deviceIds: Array.from(nextDeviceIds)
    });
}

function setGroupEditorMode(groupId, editing) {
    const card = document.querySelector(`.group-editor[data-group-id="${CSS.escape(groupId)}"]`);
    if (!card) {
        if (editing) {
            app.groupEditorModes.add(groupId);
        } else {
            app.groupEditorModes.delete(groupId);
        }
        return;
    }

    if (editing) {
        app.groupEditorModes.add(groupId);
        card.classList.add('is-editing');
    } else {
        app.groupEditorModes.delete(groupId);
        card.classList.remove('is-editing');
    }

    card.querySelectorAll('input[name="groupName"], input[name="groupDevice"]').forEach((input) => {
        input.disabled = !editing;
    });

    const editBtn = card.querySelector('[data-action="group-edit"]');
    const saveBtn = card.querySelector('[data-action="group-save"]');
    const cancelBtn = card.querySelector('[data-action="group-cancel"]');
    if (editBtn) editBtn.disabled = editing;
    if (saveBtn) saveBtn.disabled = !editing;
    if (cancelBtn) cancelBtn.disabled = !editing;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function renderSettings() {
    const list = document.getElementById('settings-server-list');
    list.innerHTML = (app.snapshot?.servers || []).map(s => {
        const c = conn(s.id);
        const isActive = s.id === sid();
        return `
        <div class="dcard">
            <div class="dcard-head">
                <span class="dcard-name">${esc(s.name)}</span>
                <span class="pill ${c?.status === 'connected' ? 'on' : 'off'}">${esc(c?.status || 'idle')}</span>
            </div>
            <div class="dcard-sub">${esc(s.host)}:${esc(String(s.port))}</div>
            <div class="dcard-actions">
                ${isActive
                    ? '<span class="pill on">Active</span>'
                    : `<button class="primary" data-action="server-active" data-server-id="${esc(s.id)}">Set Active</button>`}
                <button data-action="server-default" data-server-id="${esc(s.id)}">Default</button>
                <button class="danger" data-action="server-delete" data-server-id="${esc(s.id)}">Delete</button>
            </div>
        </div>`;
    }).join('');

    renderPairingListenerStatus(app.snapshot?.pairingListener || null);
}

function renderPairingListenerStatus(status) {
    const pill = document.getElementById('pairing-listener-pill');
    const meta = document.getElementById('pairing-listener-meta');

    if (!pill || !meta) {
        return;
    }

    const normalizedStatus = String(status?.status || 'stopped').toLowerCase();
    const isRunning = normalizedStatus === 'running';
    const isError = normalizedStatus === 'error';
    const isStarting = normalizedStatus === 'starting';

    pill.className = `pill ${isRunning ? 'on' : isError ? 'alert' : isStarting ? 'unknown' : 'off'}`;
    pill.textContent = isRunning
        ? 'Running'
        : isError
            ? 'Error'
            : isStarting
                ? 'Starting'
                : 'Stopped';

    const parts = [];
    parts.push(`Auto-pair: ${status?.autoPair === false ? 'off' : 'on'}`);

    if (status?.configPath) {
        parts.push(`Config: ${status.configPath}`);
    }

    if (status?.lastNotificationAt) {
        parts.push(`Last notification: ${fmtTime(status.lastNotificationAt)}`);
    }

    if (status?.lastError) {
        parts.push(`Error: ${status.lastError}`);
    }

    meta.textContent = parts.join(' · ') || 'No listener activity yet.';
}

// Map group type → device type for checklist filtering
const GROUP_TYPE_MAP = {
    'switch-group':  'switch',
    'alarm-group':   'alarm',
    'camera-group':  'camera',
    'turret-group':  'turret',
    'storage-group': 'storage-monitor'
};

function refreshGroupDeviceChecklist() {
    const groupType  = document.getElementById('group-type-select').value;
    const deviceType = GROUP_TYPE_MAP[groupType];
    const list       = document.getElementById('group-device-checklist');
    const matching   = deviceType ? devs(deviceType) : [];
    list.innerHTML = matching.length
        ? matching.map(d => `
            <label>
                <input type="checkbox" name="groupDevice" value="${esc(d.id)}" />
                ${esc(d.name || d.type)}
                <span class="hint">${esc(d.entityId || d.cameraId || '')}</span>
            </label>`).join('')
        : '<span class="hint">No matching devices registered</span>';
}

// ─── Device form: show/hide entity vs camera ID ───────────────────────────────
const deviceTypeSelect = document.getElementById('device-type-select');
const entityField      = document.getElementById('entity-id-field');
const cameraField      = document.getElementById('camera-id-field');

function syncDeviceFields() {
    const isCam = ['camera', 'turret'].includes(deviceTypeSelect.value);
    entityField.style.display = isCam ? 'none' : '';
    cameraField.style.display = isCam ? '' : 'none';
}

deviceTypeSelect.addEventListener('change', syncDeviceFields);
syncDeviceFields(); // initial state

// ─── Requirement: show/hide target value field ────────────────────────────────
const reqScope      = document.getElementById('req-scope');
const reqTargetWrap = document.getElementById('req-target-wrap');

function syncReqFields() {
    reqTargetWrap.style.display = reqScope.value === 'group' ? 'none' : '';
}

reqScope.addEventListener('change', syncReqFields);
syncReqFields();

// ─── Group type change → refresh checklist ────────────────────────────────────
document.getElementById('group-type-select').addEventListener('change', refreshGroupDeviceChecklist);

// ─── Rotation group change → refresh device list ──────────────────────────────
document.getElementById('rotation-group-select').addEventListener('change', updateRotationDeviceSelect);

// ─── Rotation interval slider ─────────────────────────────────────────────────
const rotSlider = document.getElementById('rotation-interval');
const rotLabel  = document.getElementById('rotation-interval-label');
rotSlider.addEventListener('input', () => {
    rotLabel.textContent = (rotSlider.value / 1000).toFixed(1) + 's';
});

// ─── Rotation buttons ─────────────────────────────────────────────────────────
document.getElementById('rotation-start-btn').addEventListener('click', guard(async () => {
    const groupId = document.getElementById('rotation-group-select').value;
    if (!groupId) { toast('Select a rotation group first'); return; }
    await api(`/api/groups/${groupId}/rotation/start`, 'POST', { intervalMs: Number(rotSlider.value) });
    toast('Rotation started', false);
}));

document.getElementById('rotation-pause-btn').addEventListener('click', guard(async () => {
    const groupId = document.getElementById('rotation-group-select').value;
    if (!groupId) { toast('Select a rotation group first'); return; }
    await api(`/api/groups/${groupId}/rotation/pause`, 'POST', {});
}));

document.getElementById('rotation-resume-btn').addEventListener('click', guard(async () => {
    const groupId = document.getElementById('rotation-group-select').value;
    if (!groupId) { toast('Select a rotation group first'); return; }
    await api(`/api/groups/${groupId}/rotation/resume`, 'POST', {});
}));

document.getElementById('rotation-select-btn').addEventListener('click', guard(async () => {
    const groupId  = document.getElementById('rotation-group-select').value;
    const deviceId = document.getElementById('rotation-device-select').value;
    if (!groupId || !deviceId) { toast('Select both a group and a camera'); return; }
    await api(`/api/groups/${groupId}/rotation/select`, 'POST', { deviceId });
    toast('Camera selected', false);
}));

// ─── Pairing listener controls ───────────────────────────────────────────────
const pairingStartBtn = document.getElementById('pairing-start-btn');
const pairingStopBtn = document.getElementById('pairing-stop-btn');
const pairingRefreshBtn = document.getElementById('pairing-refresh-btn');
const pairingTestServerBtn = document.getElementById('pairing-test-server-btn');
const pairingTestEntityBtn = document.getElementById('pairing-test-entity-btn');

async function refreshPairingListenerStatus() {
    const status = await api('/api/pairing/listener/status');
    renderPairingListenerStatus(status);
    return status;
}

pairingStartBtn.addEventListener('click', guard(async () => {
    const configPath = document.getElementById('pairing-config-path').value.trim();
    const autoPair = document.getElementById('pairing-auto-pair').checked;
    const status = await api('/api/pairing/listener/start', 'POST', {
        configPath: configPath || undefined,
        autoPair
    });
    renderPairingListenerStatus(status);
    toast('Pairing listener started', false);
}));

pairingStopBtn.addEventListener('click', guard(async () => {
    const status = await api('/api/pairing/listener/stop', 'POST', {});
    renderPairingListenerStatus(status);
    toast('Pairing listener stopped', false);
}));

pairingRefreshBtn.addEventListener('click', guard(async () => {
    await refreshPairingListenerStatus();
    toast('Pairing listener status refreshed', false);
}));

pairingTestServerBtn.addEventListener('click', guard(async () => {
    const activeServer = (app.snapshot?.servers || []).find((s) => s.id === sid());
    const host = activeServer?.host || '127.0.0.1';
    const port = activeServer?.port || '28083';
    const playerId = activeServer?.playerId || '123456';
    const playerToken = activeServer?.playerToken || '123456';

    await api('/api/pairing/listener/ingest', 'POST', {
        payload: {
            data: {
                type: 'server',
                name: `Ingest Pair ${activeServer?.name || 'Server'}`,
                ip: host,
                port,
                playerId,
                playerToken
            }
        }
    });

    toast('Test server pairing ingested', false);
}));

pairingTestEntityBtn.addEventListener('click', guard(async () => {
    const activeServer = (app.snapshot?.servers || []).find((s) => s.id === sid());
    const host = activeServer?.host || '127.0.0.1';
    const port = activeServer?.port || '28083';
    const playerId = activeServer?.playerId || '123456';
    const playerToken = activeServer?.playerToken || '123456';
    const entityId = String(Math.floor(100000 + Math.random() * 899999));

    await api('/api/pairing/listener/ingest', 'POST', {
        payload: {
            data: {
                type: 'entity',
                name: `Ingest Pair ${activeServer?.name || 'Server'}`,
                ip: host,
                port,
                playerId,
                playerToken,
                entityId,
                entityType: 'SmartSwitch',
                entityName: `Ingest Switch ${entityId}`
            }
        }
    });

    toast('Test entity pairing ingested', false);
}));

// ─── Storage group select ─────────────────────────────────────────────────────
document.getElementById('storage-group-select').addEventListener('change', async e => {
    app.selectedStorageGroupId = e.target.value || null;
    await loadStorageMetrics(app.selectedStorageGroupId);
});

// ─── Alarm group select ───────────────────────────────────────────────────────
document.getElementById('alarm-group-select').addEventListener('change', updateAlarmExclusionList);

// ─── Topbar server select ─────────────────────────────────────────────────────
document.getElementById('server-select').addEventListener('change', guard(async e => {
    await api('/api/servers/active', 'POST', { serverId: e.target.value });
}));

// ─── Forms ────────────────────────────────────────────────────────────────────
document.getElementById('team-message-form').addEventListener('submit', guard(async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api('/api/team/messages', 'POST', { serverId: sid(), message: fd.get('message') });
    e.target.reset();
    toast('Message sent', false);
}));

document.getElementById('pair-server-form').addEventListener('submit', guard(async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api('/api/pairing/server', 'POST', {
        name: fd.get('name'), host: fd.get('host'), port: fd.get('port'),
        playerId: fd.get('playerId'), playerToken: fd.get('playerToken'),
        isDefault: fd.get('isDefault') === 'on'
    });
    e.target.reset();
    toast('Server added', false);
}));

document.getElementById('import-config-form').addEventListener('submit', guard(async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api('/api/pairing/import-config', 'POST', { configPath: fd.get('configPath') || undefined });
    e.target.reset();
    toast('Config imported', false);
}));

document.getElementById('device-form').addEventListener('submit', guard(async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api('/api/devices', 'POST', {
        serverId: sid(),
        type:     fd.get('type'),
        name:     fd.get('name'),
        entityId: fd.get('entityId') || null,
        cameraId: fd.get('cameraId') || null
    });
    e.target.reset();
    syncDeviceFields();
    toast('Device registered', false);
}));

document.getElementById('group-form').addEventListener('submit', guard(async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const deviceIds = Array.from(
        e.target.querySelectorAll('input[name="groupDevice"]:checked')
    ).map(cb => cb.value);
    await api('/api/groups', 'POST', {
        serverId: sid(),
        type:     fd.get('type'),
        name:     fd.get('name'),
        deviceIds
    });
    e.target.reset();
    refreshGroupDeviceChecklist();
    toast('Group created', false);
}));

document.getElementById('alarm-config-form').addEventListener('submit', guard(async e => {
    e.preventDefault();
    const groupId = document.getElementById('alarm-group-select').value;
    if (!groupId) { toast('Select an alarm group first'); return; }
    const fd = new FormData(e.target);
    const excludedDeviceIds = Array.from(
        e.target.querySelectorAll('input[name="excludedDevice"]:checked')
    ).map(cb => cb.value);
    await api(`/api/groups/${groupId}/alarm-consolidation`, 'POST', {
        enabled:          fd.get('enabled') === 'true',
        windowMs:         Number(fd.get('windowMs') || 2000),
        excludedDeviceIds
    });
    toast('Consolidation settings saved', false);
}));

document.getElementById('requirement-form').addEventListener('submit', guard(async e => {
    e.preventDefault();
    const fd    = new FormData(e.target);
    const scope = fd.get('targetScope');
    const val   = String(fd.get('targetValue') || '').trim();
    const target = scope === 'item'     ? { scope, itemId: val }
                 : scope === 'category' ? { scope, category: val }
                 : { scope: 'group' };

    const msg     = String(fd.get('notifyMessage') || '').trim();
    const actions = msg ? [{ type: 'notify', message: msg }] : [];

    await api('/api/requirements', 'POST', {
        groupId:   fd.get('groupId'),
        target,
        condition: { operator: fd.get('operator'), value: Number(fd.get('threshold')) },
        actions,
        enabled:   true
    });
    e.target.reset();
    syncReqFields();
    toast('Requirement created', false);
}));

// ─── Inline device rename ─────────────────────────────────────────────────────
function startRenameDevice(deviceId, triggerBtn) {
    const nameEl = document.getElementById(`dname-${deviceId}`);
    if (!nameEl || nameEl.querySelector('input')) return; // already editing

    const current = nameEl.textContent.trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.className = 'inline-rename-input';
    input.style.cssText = 'font:inherit;border:1px solid var(--accent);border-radius:4px;padding:1px 5px;width:11rem;';

    nameEl.textContent = '';
    nameEl.appendChild(input);
    input.focus();
    input.select();

    const commit = async () => {
        const newName = input.value.trim();
        if (newName && newName !== current) {
            try {
                await api(`/api/devices/${deviceId}`, 'PATCH', { name: newName });
            } catch (err) {
                toast(err.message, true);
                nameEl.textContent = current;
                return;
            }
        } else {
            nameEl.textContent = newName || current;
        }
    };

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { input.blur(); }
        if (e.key === 'Escape') { nameEl.textContent = current; }
    });
    input.addEventListener('blur', commit, { once: true });
}

// ─── Event delegation (click) ─────────────────────────────────────────────────
document.addEventListener('click', guard(async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, serverId, deviceId, groupId, requirementId } = btn.dataset;

    // Navigate to Settings with the right pre-selection
    if (action === 'goto-add-device') {
        document.getElementById('device-type-select').value = btn.dataset.type || 'switch';
        syncDeviceFields();
        document.querySelector('[data-tab="settings"]').click();
        return;
    }

    if (action === 'goto-add-group') {
        document.getElementById('group-type-select').value = btn.dataset.type || 'switch-group';
        refreshGroupDeviceChecklist();
        document.querySelector('[data-tab="settings"]').click();
        return;
    }

    if (action === 'server-active')    { await api('/api/servers/active',         'POST',   { serverId }); }
    if (action === 'server-default')   { await api('/api/servers/default',        'POST',   { serverId }); }
    if (action === 'server-delete')    { await api(`/api/servers/${serverId}`,    'DELETE'); }
    if (action === 'device-delete')    { await api(`/api/devices/${deviceId}`,    'DELETE'); }
    if (action === 'device-rename')    { startRenameDevice(deviceId, btn); return; }
    if (action === 'switch-group-toggle') {
        await toggleSwitchGroupMembership(btn.dataset.groupId, deviceId, btn.checked);
        toast('Switch group updated', false);
        return;
    }
    if (action === 'group-edit')       { setGroupEditorMode(groupId, true); return; }
    if (action === 'group-cancel')     { setGroupEditorMode(groupId, false); render(app.snapshot); return; }
    if (action === 'group-save')       { await saveGroupEditor(groupId, btn); setGroupEditorMode(groupId, false); toast('Group saved', false); return; }
    if (action === 'group-on')         { await api(`/api/groups/${groupId}/on`,   'POST', {}); }
    if (action === 'group-off')        { await api(`/api/groups/${groupId}/off`,  'POST', {}); }
    if (action === 'group-delete')     { await api(`/api/groups/${groupId}`,      'DELETE'); }
    if (action === 'requirement-delete') { await api(`/api/requirements/${requirementId}`, 'DELETE'); }

    if (action === 'camera-subscribe') {
        const result = await api(`/api/cameras/${deviceId}/subscribe`, 'POST', {});
        if (result?.subscribed) {
            toast('Subscribed to camera', false);
        } else {
            toast(result?.error || 'Camera subscribe failed', true);
        }
    }
    if (action === 'camera-shoot')  { await api(`/api/cameras/${deviceId}/control`, 'POST', { command: 'shoot',  payload: {} }); }
    if (action === 'camera-reload') { await api(`/api/cameras/${deviceId}/control`, 'POST', { command: 'reload', payload: {} }); }
    if (action === 'camera-zoom')   { await api(`/api/cameras/${deviceId}/control`, 'POST', { command: 'zoom',   payload: {} }); }
}));

// ─── Event delegation (change — switch toggles) ───────────────────────────────
document.addEventListener('change', guard(async e => {
    const cb = e.target.closest('input[data-action="switch-toggle"]');
    if (!cb) return;
    await api(`/api/switches/${cb.dataset.deviceId}/${cb.checked ? 'on' : 'off'}`, 'POST', {});
}));

// ─── SSE ──────────────────────────────────────────────────────────────────────
function connectSSE() {
    const es = new EventSource('/api/events');

    es.addEventListener('state', e => render(JSON.parse(e.data)));

    es.addEventListener('notification', e => {
        const payload = JSON.parse(e.data);
        const feed = document.getElementById('ov-notif-feed');
        const placeholder = feed.querySelector('.empty');
        if (placeholder) placeholder.remove();
        const item = document.createElement('div');
        item.className = `notif-item ${payload.category || ''}`;
        item.innerHTML = `
            <div style="display:flex;justify-content:space-between;gap:8px;">
                <strong>${esc(payload.message || payload.category)}</strong>
                <span style="color:var(--muted);font-size:0.74rem;">${fmtTime(new Date().toISOString())}</span>
            </div>`;
        feed.prepend(item);
    });

    es.addEventListener('storage-group-updated', e => {
        const payload = JSON.parse(e.data);
        if (payload.groupId === app.selectedStorageGroupId && app.activeTab === 'storage') {
            renderStorageMetrics(payload.metrics);
        }
    });

    es.addEventListener('pairing-listener-status', e => {
        const payload = JSON.parse(e.data);
        renderPairingListenerStatus(payload);
    });

    es.onerror = () => {
        // EventSource auto-reconnects; just update dot
        const dot = document.getElementById('conn-dot');
        dot.className = 'status-dot disconnected';
        dot.title = 'SSE disconnected — reconnecting…';
    };
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
    try {
        const snapshot = await api('/api/state');
        render(snapshot);
        connectSSE();
        // Non-fatal — older server builds may not have this route yet
        refreshPairingListenerStatus().catch(() => {});
    } catch (err) {
        document.body.innerHTML = `
            <div style="padding:60px 40px;font-family:sans-serif;color:#9e1d20;">
                <h2 style="margin-bottom:12px;">Cannot reach backend</h2>
                <p>${esc(err.message)}</p>
                <p style="margin-top:12px;color:#666;">Start the server with <code>npm start</code>, then refresh.</p>
            </div>`;
    }
})();
