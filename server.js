/* =========================================================
   خادم تشغيل محلي بسيط — بدون أي مكتبات خارجية
   الطريقة: افتحي مجلد teacher-notebook في الطرفية واكتبي
             node server.js
   ثم افتحي المتصفح على:  http://localhost:8080
   للإيقاف: اضغطي Ctrl + C داخل الطرفية
   ========================================================= */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8080;
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8"
};

const server = http.createServer((req, res) => {
  try {
    // تحويل المسار إلى داخل المجلد فقط (حماية بسيطة)
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    let filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("ممنوع الوصول");
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 — لم يتم العثور على الصفحة");
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("حدث خطأ في الخادم: " + err.message);
  }
});

server.listen(PORT, () => {
  console.log("✅ يعمل الآن! افتحي المتصفح على هذا الرابط:");
  console.log("   http://localhost:" + PORT);
  console.log("   للإيقاف اضغطي Ctrl + C");
});
