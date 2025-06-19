// =================================================================
// Panzlync - Server Utama (Gaya URL Catbox)
// Dibuat oleh: Panz
// =================================================================

// ---------------------------------
// 1. IMPORT MODUL YANG DIBUTUHKAN
// ---------------------------------
const express = require('express');
const multer = require('multer');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ---------------------------------
// 2. KONFIGURASI UTAMA APLIKASI
// ---------------------------------
const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7';

// Kredensial & Path
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'password123';
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'data.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ---------------------------------
// 3. MIDDLEWARE
// ---------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 3600000 }
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const randomName = crypto.randomBytes(3).toString('hex');
        const extension = path.extname(file.originalname);
        cb(null, randomName + extension);
    }
});
const upload = multer({ storage: storage });

// ---------------------------------
// 4. HELPER FUNCTIONS (FUNGSI BANTU)
// ---------------------------------
const readData = () => {
    try {
        if (!fs.existsSync(DATA_FILE)) return {};
        const fileContent = fs.readFileSync(DATA_FILE, 'utf8');
        return fileContent.trim() ? JSON.parse(fileContent) : {};
    } catch (error) { console.error("Error reading data file:", error); return {}; }
};

const writeData = (data) => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) { console.error("Error writing data file:", error); }
};

const checkAuth = (req, res, next) => {
    if (req.session.loggedin) next();
    else res.redirect('/login');
};

// =================================================================
// 5. RUTE APLIKASI
// =================================================================

// --- Rute Publik ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'landing.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/success', (req, res) => res.sendFile(path.join(__dirname, 'views', 'success.html')));

// Rute upload file
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).send('<h1>Gagal!</h1><p>Tidak ada file yang diupload.</p><a href="/app">Kembali</a>');
    
    const data = readData();
    const newFileName = req.file.filename;
    const { expire_value, expire_unit } = req.body;
    let expiration = null;
    let maxDownloads = null;

    if (expire_unit !== 'unlimited') {
        expiration = new Date();
        const value = parseInt(expire_value, 10) || 1;
        if (expire_unit === 'minutes') expiration.setMinutes(expiration.getMinutes() + value);
        else if (expire_unit === 'hours') expiration.setHours(expiration.getHours() + value);
        else if (expire_unit === 'days') expiration.setDate(expiration.getDate() + value);
    }
    if (req.body.max_downloads_option === 'unlimited' || req.body.max_downloads === 'unlimited') {
        maxDownloads = null;
    } else {
       maxDownloads = parseInt(req.body.max_downloads, 10) || 1;
    }

    data[newFileName] = {
        originalName: req.file.originalname,
        path: req.file.path,
        mimetype: req.file.mimetype,
        uploadDate: new Date().toISOString(),
        expires_at: expiration ? expiration.toISOString() : null,
        maxDownloads: maxDownloads,
        downloadCount: 0
    };
    writeData(data);
    res.redirect(`/success?file=${newFileName}`);
});

// ROUTE BARU DAN UTAMA untuk menyajikan file (menggantikan /get dan /dl)
app.get('/f/:filename', (req, res) => {
    let data = readData();
    const filename = req.params.filename;
    const fileData = data[filename];

    if (!fileData || !fs.existsSync(fileData.path)) {
        return res.status(404).send('File tidak ditemukan atau tautan tidak valid.');
    }
    
    const isExpired = fileData.expires_at && new Date() > new Date(fileData.expires_at);
    const isLimitReached = fileData.maxDownloads !== null && fileData.downloadCount >= fileData.maxDownloads;
    if (isExpired || isLimitReached) {
        let message = isExpired ? "Tautan ini telah kedaluwarsa." : "Batas maksimal unduhan telah tercapai.";
        fs.unlink(fileData.path, (err) => { if(err) console.error("Gagal menghapus file:", err) });
        delete data[filename];
        writeData(data);
        return res.status(403).send(message);
    }

    fileData.downloadCount++;
    writeData(data);
    
    // --- KUNCI PERBAIKAN ---
    // Tambahkan kembali logika untuk menentukan cara browser menangani file
    const isPreviewable = ['image/', 'video/', 'application/pdf', 'text/'].some(type => 
        fileData.mimetype.startsWith(type)
    );
    // Jika bisa di-preview, tampilkan 'inline'. Jika tidak, paksa unduh dengan 'attachment'.
    const disposition = isPreviewable ? 'inline' : 'attachment';

    // Setel header dan kirimkan file
    res.setHeader('Content-Type', fileData.mimetype);
    // DITAMBAHKAN: Header Content-Disposition yang sangat penting
    res.setHeader('Content-Disposition', `${disposition}; filename="${fileData.originalName}"`);
    res.sendFile(fileData.path);
});

// --- Rute Admin (Dilindungi) ---
app.get('/login', (req, res) => { if (req.session.loggedin) res.redirect('/admin'); else res.sendFile(path.join(__dirname, 'views', 'login.html')); });
app.post('/auth', (req, res) => { const { username, password } = req.body; if (username === ADMIN_USER && password === ADMIN_PASS) { req.session.loggedin = true; req.session.username = username; res.redirect('/admin'); } else { res.send('<script>alert("Username atau Password Salah!"); window.location.href="/login";</script>'); } });
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/login')); });

app.get('/admin', checkAuth, (req, res) => {
    const data = readData();
    const now = new Date();
    let tableRows = '', totalFiles = Object.keys(data).length, totalDownloads = 0, activeLinks = 0;
    const files = Object.entries(data).reverse();
    files.forEach(([filename, file]) => {
        totalDownloads += file.downloadCount;
        const isExpired = file.expires_at && new Date(file.expires_at) < now;
        const isLimitReached = file.maxDownloads !== null && file.downloadCount >= file.maxDownloads;
        let status = '<span class="status-active">Aktif</span>';
        if (isExpired) status = '<span class="status-expired">Kedaluwarsa</span>';
        else if (isLimitReached) status = '<span class="status-limit">Habis</span>';
        else activeLinks++;
        const uploadDate = new Date(file.uploadDate).toLocaleDateString('id-ID');
        tableRows += `<tr><td>${file.originalName}<br><small><a href="/f/${filename}" target="_blank">${filename}</a></small></td><td>${file.downloadCount} / ${file.maxDownloads || '∞'}</td><td>${status}</td><td><a href="/delete/${filename}" class="button-delete" onclick="return confirm('Anda yakin?')">Hapus</a></td></tr>`;
    });
    fs.readFile(path.join(__dirname, 'views', 'admin.html'), 'utf8', (err, html) => {
        if (err) return res.status(500).send('Error memuat halaman admin.');
        const finalHtml = html.replace('{{USERNAME}}', req.session.username).replace('{{TOTAL_FILES}}', totalFiles).replace('{{TOTAL_DOWNLOADS}}', totalDownloads).replace('{{ACTIVE_LINKS}}', activeLinks).replace('<!-- FILE_TABLE_ROWS -->', tableRows);
        res.send(finalHtml);
    });
});

app.get('/delete/:filename', checkAuth, (req, res) => { 
    let data = readData(); 
    const filename = req.params.filename;
    const fileData = data[filename]; 
    if (fileData) { 
        fs.unlink(fileData.path, (err) => { if(err) console.error(err) }); 
        delete data[filename]; 
        writeData(data); 
    } 
    res.redirect('/admin'); 
});

// ---------------------------------
// 6. MENJALANKAN SERVER
// ---------------------------------
app.listen(PORT, () => {
    console.log(`Server Panzlync berjalan di port ${PORT}`);
});

