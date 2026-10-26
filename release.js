const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    neonGreen: '\x1b[38;2;57;255;20m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m',
    white: '\x1b[97m'
};

const repoDir = __dirname;
const extDir = 'G:\\Dev\\Extension-Premiere-Pro';
const vJsonPath = path.join(repoDir, 'version.json');
const winExePath = path.join(extDir, 'AutoLab', 'Output', 'AutoLab_Setup.exe');
const macZipPath = path.join(extDir, 'AutoLab_Mac_Beta.zip');
const REPO_OWNER = 'Babydunx1';
const REPO_NAME = 'AutoLab-Release';

console.log(`${ANSI.cyan}${ANSI.bold}╔══════════════════════════════════════════════════════════════════════╗${ANSI.reset}`);
console.log(`${ANSI.cyan}${ANSI.bold}║           🚀 AutoLab Official Release Dispatcher Suite               ║${ANSI.reset}`);
console.log(`${ANSI.cyan}${ANSI.bold}╚══════════════════════════════════════════════════════════════════════╝${ANSI.reset}\n`);

// 1. Get GitHub Token from Git Credential Manager
function getGitHubToken() {
    try {
        const out = execSync('git credential fill', {
            input: 'protocol=https\nhost=github.com\n',
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
        });
        const m = out.match(/password=(.+)/);
        return m ? m[1].trim() : null;
    } catch (e) {
        return null;
    }
}

// 2. HTTP Helper for GitHub API
function githubApiRequest(method, endpoint, body = null, token) {
    return new Promise((resolve, reject) => {
        const isUpload = endpoint.startsWith('https://uploads.github.com');
        const urlObj = new URL(isUpload ? endpoint : `https://api.github.com${endpoint}`);

        const headers = {
            'User-Agent': 'AutoLab-Release-Dispatcher',
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        };

        if (body && !Buffer.isBuffer(body)) {
            headers['Content-Type'] = 'application/json';
        }

        const req = https.request(urlObj, { method, headers }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`GitHub API HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', reject);
        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

// 3. Upload File Asset with Real-time Progress Bar
function uploadAsset(uploadUrlTemplate, filePath, token) {
    return new Promise((resolve, reject) => {
        const fileName = path.basename(filePath);
        const fileStats = fs.statSync(filePath);
        const totalBytes = fileStats.size;
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);

        // Clean upload url template: remove {?name,label}
        const cleanUploadUrl = uploadUrlTemplate.replace(/\{.*?\}$/, '');
        const targetUrl = new URL(`${cleanUploadUrl}?name=${encodeURIComponent(fileName)}`);

        const headers = {
            'User-Agent': 'AutoLab-Release-Dispatcher',
            'Authorization': `token ${token}`,
            'Content-Type': 'application/octet-stream',
            'Content-Length': totalBytes
        };

        const startTime = Date.now();
        let uploadedBytes = 0;

        const req = https.request(targetUrl, { method: 'POST', headers }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                process.stdout.write('\r' + ' '.repeat(95) + '\r');
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`   ${ANSI.green}✅ Upload Complete: ${ANSI.white}${fileName} ${ANSI.yellow}(${totalMb} MB)${ANSI.reset}`);
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`Upload failed HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', (err) => {
            process.stdout.write('\r' + ' '.repeat(95) + '\r');
            reject(err);
        });

        const fileStream = fs.createReadStream(filePath, { highWaterMark: 1024 * 512 });

        fileStream.on('data', (chunk) => {
            uploadedBytes += chunk.length;
            const pct = Math.min(100, Math.round((uploadedBytes / totalBytes) * 100));
            const filled = Math.min(20, Math.floor(pct / 5));
            const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
            const elapsed = Math.max(1, Math.floor((Date.now() - startTime) / 1000));
            const speed = (uploadedBytes / (1024 * 1024) / elapsed).toFixed(1);
            const upMb = (uploadedBytes / (1024 * 1024)).toFixed(1);

            process.stdout.write(`\r   ${ANSI.yellow}⏳ [${ANSI.neonGreen}${bar}${ANSI.yellow}] ${ANSI.white}${pct}%${ANSI.yellow} (${upMb}/${totalMb} MB) | ${ANSI.cyan}${speed} MB/s${ANSI.gray} [${elapsed}s]${ANSI.reset} `);
        });

        fileStream.pipe(req);
    });
}

async function main() {
    const isUploadRequested = process.argv.includes('--upload') || process.argv.includes('--apply');
    const isPrerelease = process.argv.includes('--prerelease') || process.argv.includes('--pre');
    const verArgIdx = process.argv.indexOf('--version');
    const cliVersion = (verArgIdx !== -1 && process.argv[verArgIdx + 1]) ? process.argv[verArgIdx + 1] : null;

    // Load version info
    if (!fs.existsSync(vJsonPath)) {
        console.error(`${ANSI.red}❌ version.json not found in ${repoDir}${ANSI.reset}`);
        process.exit(1);
    }
    const vData = JSON.parse(fs.readFileSync(vJsonPath, 'utf8'));
    const version = cliVersion || vData.version;
    const tagName = `updateAL${version}`;
    const releaseTitle = `update${version}`;

    console.log(`📦 Release Version : ${ANSI.green}${ANSI.bold}v${version}${ANSI.reset} ${isPrerelease ? `${ANSI.yellow}[PRE-RELEASE / NOT LATEST]${ANSI.reset}` : `${ANSI.neonGreen}[LATEST]${ANSI.reset}`}`);
    console.log(`🏷️  Target Tag Name : ${ANSI.cyan}${ANSI.bold}${tagName}${ANSI.reset}`);
    console.log(`📋 Release Title   : ${ANSI.white}${ANSI.bold}${releaseTitle}${ANSI.reset}\n`);

    // Verify binary assets
    console.log(`🔍 Checking Binary Assets:`);
    if (!fs.existsSync(winExePath)) {
        console.error(`   ${ANSI.red}❌ Missing Windows Setup: ${winExePath}${ANSI.reset}`);
        console.error(`   โปรดรัน 'node build_dist.js' ก่อนเพื่อสร้างตัวติดตั้ง`);
        process.exit(1);
    }
    const winMb = (fs.statSync(winExePath).size / (1024 * 1024)).toFixed(1);
    console.log(`   ${ANSI.green}✅ Windows Setup : ${ANSI.white}${winExePath} ${ANSI.yellow}(${winMb} MB)${ANSI.reset}`);

    let hasMac = false;
    if (fs.existsSync(macZipPath)) {
        const macMb = (fs.statSync(macZipPath).size / (1024 * 1024)).toFixed(1);
        console.log(`   ${ANSI.green}✅ macOS Bundle  : ${ANSI.white}${macZipPath} ${ANSI.yellow}(${macMb} MB)${ANSI.reset}`);
        hasMac = true;
    } else {
        console.log(`   ${ANSI.yellow}⚠️ macOS Bundle  : ${macZipPath} (Not Found, Skipping)${ANSI.reset}`);
    }

    // Acquire GitHub Token
    const token = getGitHubToken();
    if (!token) {
        console.error(`\n${ANSI.red}❌ ไม่พบคีย์ GitHub Token ใน Windows Git Credential Manager${ANSI.reset}`);
        console.error(`โปรดล็อกอิน Git หรือ GitHub CLI ก่อนครับ`);
        process.exit(1);
    }
    console.log(`\n🔑 GitHub Auth     : ${ANSI.green}Authenticated (Token auto-acquired from Git Credential Manager)${ANSI.reset}`);

    // 1. Prepare Notes in beautiful GitHub Markdown
    function buildReleaseMarkdown(data, targetVer, withMac) {
        const rawNotes = Array.isArray(data.notes) ? data.notes : [];
        const curNotes = [];
        let started = false;
        for (const line of rawNotes) {
            if (line.includes(`(${targetVer})`) || line.includes(`(v${targetVer})`)) {
                started = true;
                curNotes.push(line);
                continue;
            }
            if (started) {
                if (line.startsWith('★')) break;
                curNotes.push(line);
            }
        }

        const linesToFormat = curNotes.length > 0 ? curNotes : rawNotes;
        const bodyLines = linesToFormat.map(line => {
            if (line.startsWith('★')) return `# 🚀 ${line.replace(/^★\s*/, '')}`;
            if (line.startsWith('◆')) return `\n### ${line.replace(/^◆\s*/, '')}`;
            if (line.trim().startsWith('•')) {
                let item = line.trim().replace(/^•\s*/, '');
                item = item.replace(/\[NEW\]/g, '🟢 **[NEW]**');
                item = item.replace(/\[FIX\]/g, '🛠️ **[FIX]**');
                item = item.replace(/\[IMPROVE\]/g, '🔵 **[IMPROVE]**');
                item = item.replace(/\[PERF\]/g, '⚡ **[PERF]**');
                item = item.replace(/\[GUARD\]/g, '🛡️ **[GUARD]**');
                return `- ${item}`;
            }
            return line;
        }).join('\n').trim();

        return `${bodyLines}\n\n---\n### 📦 Attached Assets\n- **Windows:** \`AutoLab_Setup.exe\`\n${withMac ? '- **macOS:** `AutoLab_Mac_Beta.zip`\n' : ''}`;
    }

    const notesText = buildReleaseMarkdown(vData, version, hasMac);

    if (!isUploadRequested) {
        console.log(`\n${ANSI.yellow}📝 ตัวอย่างข้อความที่จะถูกเขียนลง GitHub Release "Describe this release" ให้อัตโนมัติ:${ANSI.reset}`);
        console.log(`${ANSI.gray}──────────────────────────────────────────────────────────────────────${ANSI.reset}`);
        console.log(notesText);
        console.log(`${ANSI.gray}──────────────────────────────────────────────────────────────────────${ANSI.reset}`);
        console.log(`\n${ANSI.yellow}ℹ️ Mode: PREVIEW / READY (ยังไม่ได้อัปโหลด)${ANSI.reset}`);
        console.log(`หากต้องการให้อัปโหลดขึ้น GitHub Releases ทันที ให้สั่ง:`);
        console.log(`\n   ${ANSI.neonGreen}${ANSI.bold}node release.js --upload${ANSI.reset}\n`);
        return;
    }

    // --- UPLOAD FLOW ---
    console.log(`\n${ANSI.cyan}🚀 เริ่มต้นกระบวนการสร้าง Release และอัปโหลดไฟล์...${ANSI.reset}`);

    // 2. Check if release already exists
    let existingRelease = null;
    try {
        existingRelease = await githubApiRequest('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${tagName}`, null, token);
    } catch (e) {
        // Tag doesn't exist yet, which is expected
    }

    let releaseObj = null;
    if (existingRelease) {
        console.log(`   ${ANSI.yellow}ℹ️ Release tag '${tagName}' มีอยู่แล้ว (ID: ${existingRelease.id})${ANSI.reset}`);
        console.log(`   📝 อัปเดตเนื้อหา Release Notes ให้เป็นเวอร์ชันล่าสุด...`);
        releaseObj = await githubApiRequest('PATCH', `/repos/${REPO_OWNER}/${REPO_NAME}/releases/${existingRelease.id}`, {
            name: releaseTitle,
            body: notesText,
            draft: false,
            prerelease: isPrerelease,
            make_latest: isPrerelease ? "false" : "true"
        }, token);
    } else {
        console.log(`   ✨ กำลังสร้าง Release '${releaseTitle}' บน GitHub (${isPrerelease ? 'Pre-release' : 'Latest'})...`);
        const payload = {
            tag_name: tagName,
            target_commitish: 'main',
            name: releaseTitle,
            body: notesText,
            draft: false,
            prerelease: isPrerelease,
            make_latest: isPrerelease ? "false" : "true"
        };
        releaseObj = await githubApiRequest('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/releases`, payload, token);
        console.log(`   ${ANSI.green}✅ สร้าง Release สำเร็จ! (ID: ${releaseObj.id})${ANSI.reset}`);
    }

    // 3. Upload Assets
    const uploadUrl = releaseObj.upload_url;
    console.log(`\n📤 กำลังอัปโหลดไฟล์ติดตั้งขึ้น GitHub Releases:`);

    // Delete existing assets with same name if any
    if (releaseObj.assets && releaseObj.assets.length > 0) {
        for (const asset of releaseObj.assets) {
            if (asset.name === 'AutoLab_Setup.exe' || asset.name === 'AutoLab_Mac_Beta.zip') {
                console.log(`   🗑️ ลบไฟล์เก่า '${asset.name}' ออกจาก Release ก่อน...`);
                try {
                    await githubApiRequest('DELETE', `/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${asset.id}`, null, token);
                } catch (delErr) {
                    console.warn(`   ⚠️ ไม่สามารถลบ asset เก่า: ${delErr.message}`);
                }
            }
        }
    }

    // Upload Windows Setup
    console.log(`   📦 Uploading AutoLab_Setup.exe...`);
    await uploadAsset(uploadUrl, winExePath, token);

    // Upload Mac Bundle
    if (hasMac) {
        console.log(`   📦 Uploading AutoLab_Mac_Beta.zip...`);
        await uploadAsset(uploadUrl, macZipPath, token);
    }

    console.log(`\n${ANSI.neonGreen}╔══════════════════════════════════════════════════════════════════════╗${ANSI.reset}`);
    console.log(`${ANSI.neonGreen}║  🎉 RELEASE v${version} PUBLISHED SUCCESSFULLY TO GITHUB RELEASES!     ║${ANSI.reset}`);
    console.log(`${ANSI.neonGreen}╚══════════════════════════════════════════════════════════════════════╝${ANSI.reset}`);
    console.log(`  🌐 Public URL : ${ANSI.cyan}${releaseObj.html_url}${ANSI.reset}`);
    console.log(`  🪟 Windows    : ${ANSI.white}https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/AutoLab_Setup.exe${ANSI.reset}`);
    if (hasMac) {
        console.log(`  🍏 macOS      : ${ANSI.white}https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/AutoLab_Mac_Beta.zip${ANSI.reset}`);
    }
    console.log(`\n${ANSI.green}✨ ทุกไฟล์พร้อมดาวน์โหลดสดๆ ทั่วโลกแล้วครับ!${ANSI.reset}`);
}

main().catch(err => {
    console.error(`\n${ANSI.red}❌ Release Error:${ANSI.reset}`, err);
    process.exit(1);
});
