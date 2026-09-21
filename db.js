const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// MySQL Credentials from Environment Variables
const DB_HOST = process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost';
const DB_USER = process.env.DB_USER || process.env.MYSQL_USER || '';
const DB_PASS = process.env.DB_PASS || process.env.MYSQL_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'number_track';
const DB_PORT = parseInt(process.env.DB_PORT || process.env.MYSQL_PORT || '3306');

let pool = null;
let isMysqlActive = false;

// Initialize MySQL Connection Pool & Auto-Create Tables
async function initMysql() {
  if (pool) return isMysqlActive;
  if (!DB_USER) {
    // If no MySQL user configured yet, use local JSON fallback
    isMysqlActive = false;
    return false;
  }

  try {
    pool = mysql.createPool({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      port: DB_PORT,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Test connection
    const connection = await pool.getConnection();
    connection.release();

    // Auto-create Links Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS links (
        id INT AUTO_INCREMENT PRIMARY KEY,
        short_code VARCHAR(100) UNIQUE NOT NULL,
        title VARCHAR(255) NOT NULL,
        destination_url TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Auto-create Click Logs Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS click_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        link_id INT NOT NULL,
        ip_address VARCHAR(100) NOT NULL,
        reverse_dns VARCHAR(255) DEFAULT 'N/A',
        country VARCHAR(100) DEFAULT 'Unknown',
        country_code VARCHAR(20) DEFAULT '',
        region VARCHAR(100) DEFAULT 'Unknown',
        city VARCHAR(100) DEFAULT 'Unknown',
        isp VARCHAR(150) DEFAULT 'Unknown',
        org VARCHAR(150) DEFAULT 'Unknown',
        lat DOUBLE DEFAULT 0,
        lon DOUBLE DEFAULT 0,
        is_proxy TINYINT(1) DEFAULT 0,
        is_mobile_net TINYINT(1) DEFAULT 0,
        is_hosting TINYINT(1) DEFAULT 0,
        user_agent TEXT,
        browser VARCHAR(100) DEFAULT 'Unknown',
        os VARCHAR(100) DEFAULT 'Unknown',
        device VARCHAR(50) DEFAULT 'Desktop',
        device_model VARCHAR(150) DEFAULT 'Generic Device',
        screen_res VARCHAR(50) DEFAULT 'N/A',
        timezone VARCHAR(100) DEFAULT 'N/A',
        gpu TEXT,
        cpu_cores VARCHAR(20) DEFAULT 'N/A',
        connection_type VARCHAR(50) DEFAULT 'N/A',
        language VARCHAR(50) DEFAULT 'N/A',
        battery VARCHAR(50) DEFAULT 'N/A',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    isMysqlActive = true;
    console.log(`[MySQL Database Connected Successfully] Host: ${DB_HOST}, Database: ${DB_NAME}`);
    return true;
  } catch (err) {
    console.log(`[MySQL Connection Note]: ${err.message}. Using high-speed persistent storage fallback.`);
    isMysqlActive = false;
    return false;
  }
}

// --- FALLBACK LOCAL JSON DATABASE ENGINE ---
let localDbPath = path.join(__dirname, 'data.json');
const defaultData = { links: [], click_logs: [], nextLinkId: 1, nextLogId: 1 };

function loadLocalData() {
  try {
    if (fs.existsSync(localDbPath)) {
      return JSON.parse(fs.readFileSync(localDbPath, 'utf8'));
    }
  } catch (e) {}
  return defaultData;
}

function saveLocalData(data) {
  try {
    fs.writeFileSync(localDbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

module.exports = {
  initSync: async () => {
    await initMysql();
  },

  // Create Link
  createLink: async (shortCode, title, destinationUrl) => {
    await initMysql();
    if (isMysqlActive) {
      const [result] = await pool.query(
        `INSERT INTO links (short_code, title, destination_url) VALUES (?, ?, ?)`,
        [shortCode, title, destinationUrl]
      );
      return {
        id: result.insertId,
        short_code: shortCode,
        title: title,
        destination_url: destinationUrl,
        created_at: new Date().toISOString()
      };
    } else {
      const data = loadLocalData();
      const newId = data.links.reduce((max, l) => Math.max(max, parseInt(l.id) || 0), 0) + 1;
      const newLink = {
        id: newId,
        short_code: String(shortCode),
        title: String(title),
        destination_url: String(destinationUrl),
        created_at: new Date().toISOString()
      };
      data.links.push(newLink);
      saveLocalData(data);
      return newLink;
    }
  },

  // Get All Links
  getAllLinks: async () => {
    await initMysql();
    if (isMysqlActive) {
      const [rows] = await pool.query(`
        SELECT 
          l.id, 
          l.short_code, 
          l.title, 
          l.destination_url, 
          l.created_at,
          COUNT(c.id) AS total_clicks
        FROM links l
        LEFT JOIN click_logs c ON l.id = c.link_id
        GROUP BY l.id
        ORDER BY l.created_at DESC
      `);
      return rows;
    } else {
      const data = loadLocalData();
      return data.links.map(l => {
        const clickCount = data.click_logs.filter(c => String(c.link_id) === String(l.id)).length;
        return {
          ...l,
          total_clicks: clickCount
        };
      }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Get Link By Short Code (Case-Insensitive Exact Match)
  getLinkByShortCode: async (shortCode) => {
    await initMysql();
    if (!shortCode) return null;
    const searchCode = String(shortCode).trim();

    if (isMysqlActive) {
      const [rows] = await pool.query(
        `SELECT * FROM links WHERE LOWER(short_code) = LOWER(?) LIMIT 1`,
        [searchCode]
      );
      return rows.length > 0 ? rows[0] : null;
    } else {
      const data = loadLocalData();
      return data.links.find(l => String(l.short_code).toLowerCase() === searchCode.toLowerCase()) || null;
    }
  },

  // Delete Link
  deleteLink: async (id) => {
    await initMysql();
    if (isMysqlActive) {
      await pool.query(`DELETE FROM links WHERE id = ?`, [id]);
    } else {
      const data = loadLocalData();
      const strId = String(id);
      data.links = data.links.filter(l => String(l.id) !== strId);
      data.click_logs = data.click_logs.filter(c => String(c.link_id) !== strId);
      saveLocalData(data);
    }
    return true;
  },

  // Log Click
  logClick: async (logData) => {
    await initMysql();
    if (isMysqlActive) {
      const [result] = await pool.query(`
        INSERT INTO click_logs 
        (link_id, ip_address, reverse_dns, country, country_code, region, city, isp, org, lat, lon, is_proxy, is_mobile_net, is_hosting, user_agent, browser, os, device, device_model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        logData.linkId,
        logData.ipAddress,
        logData.reverseDns || 'N/A',
        logData.country || 'Unknown',
        logData.countryCode || '',
        logData.region || 'Unknown',
        logData.city || 'Unknown',
        logData.isp || 'Unknown',
        logData.org || 'Unknown',
        logData.lat || 0,
        logData.lon || 0,
        logData.isProxy ? 1 : 0,
        logData.isMobileNet ? 1 : 0,
        logData.isHosting ? 1 : 0,
        logData.userAgent || '',
        logData.browser || 'Unknown',
        logData.os || 'Unknown',
        logData.device || 'Desktop',
        logData.deviceModel || 'Generic Device'
      ]);
      return { id: result.insertId, ...logData };
    } else {
      const data = loadLocalData();
      const newId = data.click_logs.reduce((max, c) => Math.max(max, parseInt(c.id) || 0), 0) + 1;
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
        created_at: new Date().toISOString()
      };
      data.click_logs.push(newLog);
      saveLocalData(data);
      return newLog;
    }
  },

  // Update Client Hardware Data
  updateLogClientData: async (logId, clientData) => {
    await initMysql();
    if (isMysqlActive) {
      await pool.query(`
        UPDATE click_logs SET 
          screen_res = COALESCE(?, screen_res),
          timezone = COALESCE(?, timezone),
          gpu = COALESCE(?, gpu),
          cpu_cores = COALESCE(?, cpu_cores),
          connection_type = COALESCE(?, connection_type),
          language = COALESCE(?, language),
          battery = COALESCE(?, battery),
          device_model = IF(? != 'N/A', ?, device_model)
        WHERE id = ?
      `, [
        clientData.screenRes || null,
        clientData.timezone || null,
        clientData.gpu || null,
        clientData.cpuCores || null,
        clientData.connectionType || null,
        clientData.language || null,
        clientData.battery || null,
        clientData.deviceModel || 'N/A',
        clientData.deviceModel || 'N/A',
        logId
      ]);
    } else {
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
        saveLocalData(data);
      }
    }
  },

  // Get Logs By Link ID
  getLogsByLinkId: async (linkId) => {
    await initMysql();
    if (isMysqlActive) {
      const [rows] = await pool.query(`
        SELECT * FROM click_logs WHERE link_id = ? ORDER BY created_at DESC
      `, [linkId]);
      return rows;
    } else {
      const data = loadLocalData();
      return data.click_logs
        .filter(c => String(c.link_id) === String(linkId))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  // Get All Logs
  getAllLogs: async (limit = 100) => {
    await initMysql();
    if (isMysqlActive) {
      const [rows] = await pool.query(`
        SELECT 
          c.*, 
          l.title AS link_title, 
          l.short_code 
        FROM click_logs c
        JOIN links l ON c.link_id = l.id
        ORDER BY c.created_at DESC
        LIMIT ?
      `, [limit]);
      return rows;
    } else {
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
    }
  },

  // Get Stats
  getStats: async () => {
    await initMysql();
    if (isMysqlActive) {
      const [[{ totalLinks }]] = await pool.query(`SELECT COUNT(*) AS totalLinks FROM links`);
      const [[{ totalClicks }]] = await pool.query(`SELECT COUNT(*) AS totalClicks FROM click_logs`);
      const [[{ uniqueIPs }]] = await pool.query(`SELECT COUNT(DISTINCT ip_address) AS uniqueIPs FROM click_logs`);
      const [[{ vpnCount }]] = await pool.query(`SELECT COUNT(*) AS vpnCount FROM click_logs WHERE is_proxy = 1`);

      const [topLocations] = await pool.query(`
        SELECT CONCAT(city, ', ', country) AS location, COUNT(*) AS count 
        FROM click_logs 
        WHERE country IS NOT NULL AND country != 'Unknown'
        GROUP BY country, city 
        ORDER BY count DESC 
        LIMIT 5
      `);

      return { totalLinks, totalClicks, uniqueIPs, vpnCount, topLocations };
    } else {
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
  }
};
